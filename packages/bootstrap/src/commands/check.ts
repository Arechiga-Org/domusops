import type { CliArgs } from "../cli-args.js";
import { EXIT_USAGE } from "../exit-codes.js";

/** Placeholder wired into `cli.ts` by Foundational (T013); User Story 3 (T034) implements it. */
export function runCheck(args: CliArgs): number {
  console.error(`check: not implemented yet (--dir ${args.dir})`);
  return EXIT_USAGE;
}
