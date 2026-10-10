import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SandboxError } from "../errors.js";
import { postJson } from "../ha/rest.js";
import { HaSocket } from "../ha/ws.js";
import { listSandboxes, startSandbox } from "../index.js";
import { exactRelease, resolveChannel } from "../release/resolve.js";
import type { Channel } from "../release/versions.js";
import {
  RESULT_FORMAT,
  runContext,
  stepMessage,
  type RunResult,
  type StepResult,
} from "../results/result.js";
import {
  SMOKE_STEPS,
  type ConfigCheck,
  TEARDOWN_STEP,
  resolveMcpEntry,
  type SmokeContext,
  type SmokeDeps,
  type SmokeStep,
} from "./steps.js";

export type SmokeTarget =
  | { channel: Channel; release?: undefined }
  | { release: string; channel?: undefined };

/** Errors that mean the machine, not Home Assistant, kept the run from starting. */
const PULL_CODES = new Set(["image_unavailable", "runtime_missing"]);

export function defaultSmokeDeps(
  environment: NodeJS.ProcessEnv = process.env,
): SmokeDeps {
  return {
    resolve: (channel) => resolveChannel(channel),
    start: (options) => startSandbox(options),
    list: () => listSandboxes(),
    connectSocket: (wsUrl, token) => HaSocket.connect(wsUrl, token),
    checkConfig: async ({ url, token }) =>
      (await postJson(
        url,
        "/api/config/core/check_config",
        {},
        { token, timeoutMs: 60_000 },
      )) as ConfigCheck,
    openMcp: (launch) => {
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: launch.env,
        stderr: "ignore",
      });
      return { transport };
    },
    mcpEntry: resolveMcpEntry,
    environment,
  };
}

function instant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface Timed {
  result: StepResult;
  error?: unknown;
}

async function timed(
  step: SmokeStep,
  context: SmokeContext,
  secrets: () => string[],
): Promise<Timed> {
  const began = Date.now();
  try {
    await step.run(context);
    return {
      result: { name: step.name, status: "passed", ms: Date.now() - began },
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      result: {
        name: step.name,
        status: "failed",
        ms: Date.now() - began,
        message: stepMessage(text, secrets()),
      },
      error,
    };
  }
}

/**
 * Runs the smoke check on one release and reports what happened. It never throws for a failed
 * check; a failed step is a result. Teardown runs whatever came before it.
 */
export async function runSmoke(
  target: SmokeTarget,
  deps: SmokeDeps = defaultSmokeDeps(),
  now: () => Date = () => new Date(),
): Promise<RunResult> {
  const startedAt = instant(now());
  const base = runContext(deps.environment);
  const finish = (
    result: Omit<
      RunResult,
      "format" | "startedAt" | "finishedAt" | "runner" | "sandboxVersion"
    >,
  ): RunResult => ({
    format: RESULT_FORMAT,
    ...result,
    startedAt,
    finishedAt: instant(now()),
    runner: base.runner,
    sandboxVersion: base.sandboxVersion,
    ...(base.ciRunUrl === undefined ? {} : { ciRunUrl: base.ciRunUrl }),
  });

  const channel = target.channel ?? "exact";
  let release: string;
  if (target.release !== undefined) {
    release = exactRelease(target.release).release;
  } else {
    try {
      release = (await deps.resolve(target.channel)).release;
    } catch (error) {
      if (
        error instanceof SandboxError &&
        error.code === "no_beta_in_progress"
      ) {
        return finish({ channel, outcome: "no-beta-in-progress", steps: [] });
      }
      // Only a known failure (index unreachable, no such release) says the machine could not
      // resolve; anything else is a bug and must not pass for an infrastructure flake.
      if (!(error instanceof SandboxError)) throw error;
      return finish({
        channel,
        outcome: "could-not-run",
        failedStep: "resolve",
        steps: [],
      });
    }
  }

  const context: SmokeContext = { deps, release, devices: [] };
  // Remembered from the last time the sandbox could tell it: once stopped it throws.
  let known: string[] = [];
  const secrets = (): string[] => {
    try {
      if (context.sandbox !== undefined) {
        known = [context.sandbox.connection().token];
      }
    } catch {
      // keep what was known while the sandbox ran
    }
    return known;
  };

  const steps: StepResult[] = [];
  let failedStep: StepResult | undefined;
  let failure: unknown;
  for (const step of SMOKE_STEPS) {
    if (failedStep !== undefined) {
      steps.push({ name: step.name, status: "skipped" });
      continue;
    }
    const { result, error } = await timed(step, context, secrets);
    steps.push(result);
    if (result.status === "failed") {
      failedStep = result;
      failure = error;
    }
  }

  const { result: teardown } = await timed(TEARDOWN_STEP, context, secrets);

  // The machine could not pull or run the image: nothing about the release was learned.
  if (
    failedStep?.name === "start" &&
    failure instanceof SandboxError &&
    PULL_CODES.has(failure.code)
  ) {
    return finish({
      channel,
      release,
      outcome: "could-not-run",
      failedStep: "pull",
      steps: [],
    });
  }

  steps.push(teardown);
  const broken =
    failedStep ?? (teardown.status === "failed" ? teardown : undefined);
  return finish({
    channel,
    release,
    outcome: broken === undefined ? "passed" : "failed",
    ...(broken === undefined ? {} : { failedStep: broken.name }),
    steps,
  });
}
