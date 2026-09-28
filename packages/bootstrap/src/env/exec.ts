import { spawnSync } from "node:child_process";

/**
 * Process wrapper used by every `env/*` module. Synchronous: this CLI runs one short-lived
 * command at a time, and synchronous exec keeps the baseline engine (`baseline/elements.ts`)
 * free of `async`/`await` plumbing throughout.
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  /**
   * When true, a failure never includes `args`, `stdout`, or `stderr` in a thrown error's
   * message, and callers must not log this call's `stdout`/`stderr` themselves. Set for every
   * call that may carry a secret value or private key material (sops, age, git show of a
   * secrets file).
   */
  sensitive?: boolean | undefined;
}

/** Thrown when `cmd` is not on `PATH` (or is not executable). */
export class ExecNotFoundError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`command not found: ${command}`);
    this.name = "ExecNotFoundError";
    this.command = command;
  }
}

/**
 * Runs `cmd` with `args` and returns its exit code and output. Never throws on a non-zero exit
 * code (callers decide what that means); throws `ExecNotFoundError` when the binary itself is
 * missing, so `env/prereqs.ts` can distinguish "not installed" from "installed but failed".
 */
export function run(
  cmd: string,
  args: readonly string[],
  opts: ExecOptions = {},
): ExecResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    const withCode = result.error as NodeJS.ErrnoException;
    if (withCode.code === "ENOENT") {
      throw new ExecNotFoundError(cmd);
    }
    throw result.error;
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** True when `cmd` exists on `PATH` (probed with `--version`, per `env/prereqs.ts`). */
export function isOnPath(cmd: string): boolean {
  try {
    run(cmd, ["--version"]);
    return true;
  } catch (err) {
    if (err instanceof ExecNotFoundError) return false;
    // The binary exists but `--version` itself failed to spawn for another reason: treat it as
    // present, since prereqs.ts only needs to know whether the executable is reachable.
    return true;
  }
}
