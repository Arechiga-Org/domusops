#!/usr/bin/env node
import { runInit } from "./commands/init.js";
import { runCheck } from "./commands/check.js";
import { runValidate } from "./commands/validate.js";
import { runSecrets } from "./commands/secrets.js";
import type { CliArgs } from "./cli-args.js";
import { packageVersion } from "./cli-support.js";

export type { CliArgs } from "./cli-args.js";
export {
  EXIT_OK,
  EXIT_PROBLEMS,
  EXIT_STOPPED,
  EXIT_USAGE,
} from "./exit-codes.js";
export {
  packageVersion,
  runScopeGuard,
  isConfigDir,
  notConfigDirStop,
} from "./cli-support.js";
import { EXIT_OK, EXIT_USAGE } from "./exit-codes.js";

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
