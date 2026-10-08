import { SandboxError } from "../errors.js";
import { getJson, postJson } from "../ha/rest.js";
import { HaSocket } from "../ha/ws.js";
import type { Runtime } from "../runtime/docker.js";

export const DEFAULT_READINESS_SECONDS = 150;
export const LOG_LINES = 50;

const POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ReadyContext {
  runtime: Runtime;
  containerId: string;
  /** Epoch milliseconds after which the start has failed. */
  deadline: number;
  secrets?: readonly string[];
}

async function notReady(
  context: ReadyContext,
  reason: string,
): Promise<SandboxError> {
  let logs: string[] = [];
  try {
    const text = await context.runtime.logs(context.containerId, LOG_LINES);
    logs = text
      .split("\n")
      .filter((line) => line !== "")
      .slice(-LOG_LINES);
  } catch {
    // The container may already be gone; the reason stands on its own.
  }
  return new SandboxError("not_ready", reason, {
    logs,
    secrets: context.secrets ?? [],
  });
}

async function containerGone(context: ReadyContext): Promise<boolean> {
  const info = await context.runtime.inspect(context.containerId);
  return info === null || !info.running;
}

/** Waits until the instance answers its onboarding endpoint. */
export async function waitForHttp(
  baseUrl: string,
  context: ReadyContext,
): Promise<void> {
  for (;;) {
    try {
      await getJson(baseUrl, "/api/onboarding", { timeoutMs: 5_000 });
      return;
    } catch {
      // not up yet
    }
    if (await containerGone(context)) {
      throw await notReady(context, "The instance exited before it answered.");
    }
    if (Date.now() >= context.deadline) {
      throw await notReady(
        context,
        "The instance did not answer before the readiness limit.",
      );
    }
    await sleep(POLL_MS);
  }
}

interface CoreConfig {
  state?: unknown;
  recovery_mode?: unknown;
  safe_mode?: unknown;
}

interface CheckConfig {
  result?: unknown;
  errors?: unknown;
}

/**
 * The instance counts as ready when it reports `RUNNING` and its configuration passes
 * `check_config`. An invalid configuration, recovery mode or safe mode fails the start.
 */
export async function waitForRunning(
  baseUrl: string,
  wsUrl: string,
  token: string,
  context: ReadyContext,
): Promise<void> {
  const secrets = [...(context.secrets ?? []), token];
  const guarded: ReadyContext = { ...context, secrets };
  let socket: HaSocket | null = null;
  try {
    for (;;) {
      try {
        socket ??= await HaSocket.connect(wsUrl, token);
        const config = await socket.command<CoreConfig>({ type: "get_config" });
        if (config.recovery_mode === true || config.safe_mode === true) {
          throw await notReady(
            guarded,
            "The instance started in recovery or safe mode: its configuration has errors.",
          );
        }
        if (config.state === "RUNNING") break;
      } catch (error) {
        if (error instanceof SandboxError) throw error;
        socket?.close();
        socket = null;
      }
      if (await containerGone(guarded)) {
        throw await notReady(guarded, "The instance exited while starting.");
      }
      if (Date.now() >= guarded.deadline) {
        throw await notReady(
          guarded,
          "The instance did not reach the running state before the readiness limit.",
        );
      }
      await sleep(POLL_MS);
    }
  } finally {
    socket?.close();
  }

  const check = (await postJson(
    baseUrl,
    "/api/config/core/check_config",
    {},
    { token, timeoutMs: 60_000 },
  )) as CheckConfig;
  if (check.result !== "valid") {
    const errors =
      typeof check.errors === "string" ? check.errors : "no details given";
    throw new SandboxError(
      "config_invalid",
      `The configuration did not pass the instance's own check: ${errors}`,
      { secrets },
    );
  }
}
