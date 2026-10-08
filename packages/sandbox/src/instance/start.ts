import { hostname } from "node:os";
import { SandboxError } from "../errors.js";
import { packConfig } from "../config/pack.js";
import { exactRelease, resolveChannel } from "../release/resolve.js";
import {
  RELEASE_RE,
  isChannel,
  type Channel,
  type ResolvedRelease,
} from "../release/versions.js";
import { IMAGE_PREFIX, type Runtime } from "../runtime/docker.js";
import { guardContainer } from "../runtime/guard.js";
import { reap } from "../runtime/reaper.js";
import {
  buildLabels,
  containerName,
  newSandboxId,
  type SandboxLabels,
} from "../runtime/labels.js";
import type { LifecycleState, SandboxMode } from "../types.js";
import { attachOwner, DETACH } from "./companion.js";
import { SandboxHandle, type Sandbox } from "./handle.js";
import { HaSocket } from "../ha/ws.js";
import { onboard, storeToken } from "./onboard.js";
import {
  DEFAULT_READINESS_SECONDS,
  waitForHttp,
  waitForRunning,
} from "./ready.js";

export const DEFAULT_MAX_LIFETIME_MINUTES = 120;

export interface StartOptions {
  channel?: Channel;
  release?: string;
  mode?: SandboxMode;
  maxLifetimeMinutes?: number;
  readinessTimeoutSeconds?: number;
  onProgress?: (state: LifecycleState, note?: string) => void;
}

/** Test seams; the public API never exposes them. */
export interface StartInternals {
  resolve?: (channel: Channel) => Promise<ResolvedRelease>;
}

interface ValidOptions {
  request: { channel: Channel } | { release: string };
  mode: SandboxMode;
  maxLifetimeMinutes: number;
  readinessTimeoutSeconds: number;
}

/** Programmer errors: thrown before anything is started. */
export function validateOptions(options: StartOptions): ValidOptions {
  if (options.channel !== undefined && options.release !== undefined) {
    throw new TypeError("Give either `channel` or `release`, not both.");
  }
  if (options.channel !== undefined && !isChannel(options.channel)) {
    throw new TypeError(
      `\`channel\` must be stable, previous-stable or beta, not "${String(options.channel)}".`,
    );
  }
  if (options.release !== undefined && !RELEASE_RE.test(options.release)) {
    throw new TypeError(
      `"${options.release}" is not a Home Assistant release such as 2026.10.1 or 2026.11.0b2.`,
    );
  }
  const mode = options.mode ?? "tied";
  if (mode !== "tied" && mode !== "background") {
    throw new TypeError('`mode` must be "tied" or "background".');
  }
  const maxLifetimeMinutes =
    options.maxLifetimeMinutes ?? DEFAULT_MAX_LIFETIME_MINUTES;
  if (
    !Number.isFinite(maxLifetimeMinutes) ||
    maxLifetimeMinutes < 1 ||
    maxLifetimeMinutes > 1440
  ) {
    throw new RangeError("`maxLifetimeMinutes` must be between 1 and 1440.");
  }
  const readinessTimeoutSeconds =
    options.readinessTimeoutSeconds ?? DEFAULT_READINESS_SECONDS;
  if (
    !Number.isFinite(readinessTimeoutSeconds) ||
    readinessTimeoutSeconds <= 0
  ) {
    throw new TypeError("`readinessTimeoutSeconds` must be greater than 0.");
  }
  return {
    request:
      options.release !== undefined
        ? { release: options.release }
        : { channel: options.channel ?? "stable" },
    mode,
    maxLifetimeMinutes,
    readinessTimeoutSeconds,
  };
}

export async function startSandboxWith(
  runtime: Runtime,
  options: StartOptions = {},
  internals: StartInternals = {},
): Promise<Sandbox> {
  const valid = validateOptions(options);
  const progress = (state: LifecycleState, note?: string): void => {
    options.onProgress?.(state, note);
  };

  await runtime.ensureAvailable();

  progress("resolving");
  const release =
    "release" in valid.request
      ? exactRelease(valid.request.release)
      : await (internals.resolve ?? resolveChannel)(valid.request.channel);

  progress("pulling");
  const image = `${IMAGE_PREFIX}:${release.release}`;
  const pulled = await runtime.pull(image);
  if (pulled.status !== 0) {
    if (await runtime.imageExists(image)) {
      progress(
        "pulling",
        `Could not pull ${image}; using the copy already present.`,
      );
    } else {
      throw new SandboxError(
        "image_unavailable",
        `The image ${image} could not be pulled and is not present locally: ${
          pulled.stderr.trim() || "no details"
        }`,
      );
    }
  }

  // Whatever earlier runs left behind goes before a new instance is added to the machine.
  const reaped = await reap(runtime);

  const id = newSandboxId();
  const deadline = new Date(
    Date.now() + valid.maxLifetimeMinutes * 60_000,
  ).toISOString();
  const labels: SandboxLabels = {
    id,
    mode: valid.mode,
    deadline,
    owner:
      valid.mode === "tied" ? { host: hostname(), pid: process.pid } : null,
    release: release.release,
  };

  progress("creating");
  const containerId = await runtime.create({
    name: containerName(id),
    image,
    labels: buildLabels(labels),
    env: {
      DOMUSOPS_SANDBOX_ID: id,
      DOMUSOPS_SANDBOX_MODE: valid.mode,
      DOMUSOPS_SANDBOX_DEADLINE: deadline,
    },
    publish: ["127.0.0.1::8123"],
    entrypoint: "python",
    command: ["-m", "homeassistant", "--config", "/config"],
  });
  const release_guard = guardContainer(runtime, containerId);

  let token = "";
  let owner: HaSocket | null = null;
  try {
    await runtime.copyIn(containerId, await packConfig());

    progress("starting");
    await runtime.start(containerId);
    const port = await runtime.hostPort(containerId, 8123);
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/api/websocket`;
    const context = {
      runtime,
      containerId,
      deadline: Date.now() + valid.readinessTimeoutSeconds * 1000,
    };

    progress("onboarding");
    await waitForHttp(baseUrl, context);
    token = await onboard(baseUrl, wsUrl);
    await storeToken(runtime, containerId, token);

    progress("validating");
    await waitForRunning(baseUrl, wsUrl, token, context);

    const onRelease: (() => void | Promise<void>)[] = [];
    if (valid.mode === "tied") {
      // The owner connection is how the instance notices its owner is gone (research R6).
      owner = await HaSocket.connect(wsUrl, token);
      await attachOwner(owner);
      const held = owner;
      onRelease.push(async () => {
        try {
          await held.command({ type: DETACH }, 5_000);
        } finally {
          held.close();
        }
      });
    }
    if (valid.mode === "tied") onRelease.push(release_guard);
    // A background instance outlives this process: only its deadline and `stop` end it.
    else release_guard();

    const handle = new SandboxHandle({
      id,
      containerId,
      release,
      mode: valid.mode,
      deadline,
      port,
      token,
      config: null,
      runtime,
      reaped,
      onRelease,
    });
    progress("ready");
    return handle;
  } catch (error) {
    progress("failed");
    owner?.close();
    try {
      await runtime.remove(containerId);
    } finally {
      release_guard();
    }
    if (error instanceof SandboxError || token === "") throw error;
    throw new SandboxError(
      "not_ready",
      error instanceof Error ? error.message : String(error),
      { secrets: [token] },
    );
  }
}
