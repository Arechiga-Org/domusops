import { readFileSync, writeFileSync } from "node:fs";
import { redact } from "../errors.js";
import type { Channel } from "../release/versions.js";

export const RESULT_FORMAT = "domusops.sandbox-result/0.1" as const;

export const STEP_NAMES = [
  "start",
  "load-config",
  "virtual-device",
  "set-state",
  "time",
  "mcp-snapshot",
  "websocket",
  "teardown",
] as const;

export type StepName = (typeof STEP_NAMES)[number];
export type StepStatus = "passed" | "failed" | "skipped";
export type Outcome =
  "passed" | "failed" | "could-not-run" | "no-beta-in-progress";
/** Where a run that never started a step gave up. */
export type EarlyStep = "resolve" | "pull";

export interface StepResult {
  name: StepName;
  status: StepStatus;
  /** Absent for a skipped step. */
  ms?: number;
  message?: string;
}

export interface RunResult {
  format: typeof RESULT_FORMAT;
  channel: Channel | "exact";
  /** Absent for `no-beta-in-progress` and for a run that could not resolve its channel. */
  release?: string;
  outcome: Outcome;
  failedStep?: StepName | EarlyStep;
  steps: StepResult[];
  startedAt: string;
  finishedAt: string;
  runner: string;
  sandboxVersion: string;
  ciRunUrl?: string;
}

export const MAX_MESSAGE = 300;

/** One line of at most 300 characters with every named secret and token-shaped text removed. */
export function stepMessage(
  text: string,
  secrets: readonly string[] = [],
): string {
  const line = redact(text, secrets).replace(/\s+/g, " ").trim();
  return line.length <= MAX_MESSAGE
    ? line
    : `${line.slice(0, MAX_MESSAGE - 1)}…`;
}

export interface RunContext {
  runner: string;
  sandboxVersion: string;
  ciRunUrl?: string;
}

function packageVersion(): string {
  const raw = readFileSync(
    new URL("../../package.json", import.meta.url),
    "utf8",
  );
  return (JSON.parse(raw) as { version: string }).version;
}

/** Facts about where the run happened; the run URL only exists inside GitHub Actions. */
export function runContext(env: NodeJS.ProcessEnv): RunContext {
  const context: RunContext = {
    runner: `${process.platform}-${process.arch}`,
    sandboxVersion: packageVersion(),
  };
  const server = env["GITHUB_SERVER_URL"];
  const repository = env["GITHUB_REPOSITORY"];
  const run = env["GITHUB_RUN_ID"];
  if (
    server !== undefined &&
    server.startsWith("https://") &&
    repository !== undefined &&
    run !== undefined &&
    /^\d+$/.test(run)
  ) {
    context.ciRunUrl = `${server}/${repository}/actions/runs/${run}`;
  }
  return context;
}

export function serializeResult(result: RunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function writeResult(path: string, result: RunResult): void {
  writeFileSync(path, serializeResult(result));
}

export function readResult(path: string): RunResult {
  return JSON.parse(readFileSync(path, "utf8")) as RunResult;
}
