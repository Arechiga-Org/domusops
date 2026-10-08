import { SandboxError } from "../errors.js";
import { getJson, postJson } from "../ha/rest.js";
import { HaSocket, WsAuthError } from "../ha/ws.js";
import type { LogTail, Runtime } from "../runtime/docker.js";

export const DEFAULT_READINESS_SECONDS = 150;
export const LOG_LINES = 50;

const POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `ms`, cut down to the time left before the readiness limit, and never zero. */
function within(context: ReadyContext, ms: number): number {
  return Math.max(1, Math.min(ms, context.deadline - Date.now()));
}

export interface ReadyContext {
  runtime: Runtime;
  containerId: string;
  /** Epoch milliseconds after which the start has failed. */
  deadline: number;
  secrets?: readonly string[];
  /** Output captured while the container ran; used when `docker logs` can no longer reach it. */
  tail?: LogTail;
}

async function notReady(
  context: ReadyContext,
  reason: string,
): Promise<SandboxError> {
  let logs: string[] = [];
  try {
    const text = await context.runtime.logs(context.containerId, LOG_LINES);
    logs = text.split("\n").filter((line) => line !== "");
  } catch {
    // The container is gone: `--rm` removed it together with its logs.
  }
  if (logs.length === 0) logs = context.tail?.lines() ?? [];
  logs = logs.slice(-LOG_LINES);
  return new SandboxError("not_ready", reason, {
    logs,
    secrets: context.secrets ?? [],
  });
}

/** A failed step reported as `not_ready`, with the output the instance produced meanwhile. */
export async function withLogs(
  context: ReadyContext,
  error: unknown,
): Promise<SandboxError> {
  if (error instanceof SandboxError && error.code !== "not_ready") return error;
  const reason = error instanceof Error ? error.message : String(error);
  return notReady(context, reason);
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
      await getJson(baseUrl, "/api/onboarding", {
        timeoutMs: within(context, 5_000),
      });
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
        socket ??= await HaSocket.connect(wsUrl, token, {
          connectTimeoutMs: within(guarded, 10_000),
        });
        const config = await socket.command<CoreConfig>(
          { type: "get_config" },
          within(guarded, 30_000),
        );
        if (config.recovery_mode === true || config.safe_mode === true) {
          await failIfInvalid(baseUrl, token, guarded, secrets);
          throw await notReady(
            guarded,
            "The instance started in recovery or safe mode, although its configuration passes the check.",
          );
        }
        if (config.state === "RUNNING") break;
      } catch (error) {
        if (error instanceof SandboxError) throw error;
        if (error instanceof WsAuthError) {
          // The token was just issued: waiting longer will not make the instance accept it.
          throw await notReady(
            guarded,
            "The instance rejected the access token it had just issued.",
          );
        }
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

  await failIfInvalid(baseUrl, token, guarded, secrets);
}

/**
 * Runs the instance's own `check_config`; an invalid result ends the start as `config_invalid`.
 * An instance in recovery mode answers it too, which is how a broken configuration is told
 * apart from any other reason for that mode.
 */
async function failIfInvalid(
  baseUrl: string,
  token: string,
  context: ReadyContext,
  secrets: readonly string[],
): Promise<void> {
  let check: CheckConfig;
  try {
    check = (await postJson(
      baseUrl,
      "/api/config/core/check_config",
      {},
      // An instance that reached RUNNING at the last moment still gets a fair chance to answer.
      { token, timeoutMs: Math.max(15_000, within(context, 60_000)) },
    )) as CheckConfig;
  } catch (error) {
    throw await notReady(
      context,
      `The configuration check did not complete before the readiness limit: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
