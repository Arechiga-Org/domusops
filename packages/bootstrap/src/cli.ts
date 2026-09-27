#!/usr/bin/env node
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
import { runInit } from "./commands/init.js";
import { runCheck } from "./commands/check.js";
import { runValidate } from "./commands/validate.js";
import { runSecrets } from "./commands/secrets.js";
import type { CliArgs } from "./cli-args.js";

export type { CliArgs } from "./cli-args.js";
export {
  EXIT_OK,
  EXIT_PROBLEMS,
  EXIT_STOPPED,
  EXIT_USAGE,
} from "./exit-codes.js";
import { EXIT_OK, EXIT_USAGE } from "./exit-codes.js";

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

function parseFlags(argv: readonly string[]): {
  positional: string[];
  flags: CliArgs;
} {
  const flags: CliArgs = {
    dir: process.cwd(),
    json: false,
    apply: false,
    force: false,
    ci: false,
    staged: false,
    all: false,
    instanceVersion: undefined,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dir":
        flags.dir = argv[++i] ?? flags.dir;
        break;
      case "--json":
        flags.json = true;
        break;
      case "--apply":
        flags.apply = true;
        break;
      case "--force":
        flags.force = true;
        break;
      case "--ci":
        flags.ci = true;
        break;
      case "--staged":
        flags.staged = true;
        break;
      case "--all":
        flags.all = true;
        break;
      case "--instance-version":
        flags.instanceVersion = argv[++i];
        break;
      default:
        if (arg !== undefined) positional.push(arg);
    }
  }
  return { positional, flags };
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

function printHelp(): void {
  console.log(`domusops-bootstrap — bring a Home Assistant configuration to a GitOps baseline

Usage:
  domusops-bootstrap init [--apply] [--instance-version <v>] [--dir <path>] [--json]
  domusops-bootstrap check (--staged | --all) [--ci] [--dir <path>] [--json]
  domusops-bootstrap validate [--ci] [--dir <path>] [--json]
  domusops-bootstrap secrets decrypt [--force] [--dir <path>]
  domusops-bootstrap secrets encrypt [--dir <path>]
  domusops-bootstrap secrets add-key <age-public-key> [--dir <path>]
  domusops-bootstrap secrets remove-key <age-public-key> [--dir <path>]
`);
}

export function main(argv: readonly string[]): number {
  if (argv.includes("--version")) {
    console.log(packageVersion());
    return EXIT_OK;
  }
  if (argv.length === 0 || argv.includes("--help")) {
    printHelp();
    return EXIT_OK;
  }
  const { positional, flags } = parseFlags(argv);
  const [command, ...rest] = positional;
  switch (command) {
    case "init":
      return runInit(flags);
    case "check":
      return runCheck(flags);
    case "validate":
      return runValidate(flags);
    case "secrets":
      return runSecrets(rest[0], rest.slice(1), flags);
    default:
      console.error(`Unknown command: ${command ?? "(none)"}`);
      printHelp();
      return EXIT_USAGE;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(process.argv[1], "file:").href;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
