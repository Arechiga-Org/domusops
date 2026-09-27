import type { CliArgs } from "../cli-args.js";
import { EXIT_USAGE } from "../exit-codes.js";

/**
 * Placeholder wired into `cli.ts` by Foundational (T013). User Story 1 (T022) replaces this with
 * the real `init` implementation; User Stories 2 to 4 (T028, T036, T041) extend it further.
 */
export function runInit(args: CliArgs): number {
  console.error(`init: not implemented yet (--dir ${args.dir})`);
  return EXIT_USAGE;
}
