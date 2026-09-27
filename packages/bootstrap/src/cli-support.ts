import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isNativeWindows,
  nativeWindowsStop,
  type RunStop,
} from "./env/platform.js";
import {
  checkPrerequisites,
  missingPrerequisiteStop,
  type PrereqName,
} from "./env/prereqs.js";

/**
 * Helpers shared by `cli.ts` and every `commands/*.ts` handler, kept out of `cli.ts` itself so
 * importing them from a command module never creates an import cycle with `cli.ts`.
 */

/** The package's own version, read from `package.json` next to `dist/`, for `--version`. */
export function packageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * The run-scope stop checks every command runs first, in order: native Windows (research R14),
 * then the prerequisites the command needs (spec FR-004). Returns `null` when the command may
 * proceed.
 */
export function runScopeGuard(needs: readonly PrereqName[]): RunStop | null {
  if (isNativeWindows()) return nativeWindowsStop();
  const missing = checkPrerequisites(needs);
  if (missing.length > 0) return missingPrerequisiteStop(missing);
  return null;
}

/** True when `dir` has the instance's main configuration file (spec FR-002, FR-004). */
export function isConfigDir(dir: string): boolean {
  return existsSync(join(dir, "configuration.yaml"));
}

export function notConfigDirStop(): RunStop {
  return {
    reason: "not_config_dir",
    message:
      "No configuration.yaml was found in this directory. Point --dir at your Home Assistant " +
      "configuration directory.",
  };
}
