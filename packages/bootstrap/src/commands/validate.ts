import type { CliArgs } from "../cli-args.js";
import { EXIT_USAGE } from "../exit-codes.js";

/** Placeholder wired into `cli.ts` by Foundational (T013); User Story 3 (T035) implements it. */
export function runValidate(args: CliArgs): number {
  console.error(`validate: not implemented yet (--dir ${args.dir})`);
  return EXIT_USAGE;
}
