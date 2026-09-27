import type { CliArgs } from "../cli-args.js";
import { EXIT_USAGE } from "../exit-codes.js";

/** Placeholder wired into `cli.ts` by Foundational (T013); User Story 2 (T029) implements it. */
export function runSecrets(
  sub: string | undefined,
  rest: readonly string[],
  args: CliArgs,
): number {
  console.error(
    `secrets ${sub ?? "(none)"}: not implemented yet (--dir ${args.dir}, ${rest.length} extra args)`,
  );
  return EXIT_USAGE;
}
