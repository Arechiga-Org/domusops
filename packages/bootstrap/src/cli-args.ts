/** Parsed CLI flags, shared between `cli.ts` and every `commands/*.ts` handler. */
export interface CliArgs {
  dir: string;
  json: boolean;
  apply: boolean;
  force: boolean;
  ci: boolean;
  staged: boolean;
  all: boolean;
  instanceVersion: string | undefined;
}
