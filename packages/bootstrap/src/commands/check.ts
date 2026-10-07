import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliArgs } from "../cli-args.js";
import {
  EXIT_OK,
  EXIT_PROBLEMS,
  EXIT_STOPPED,
  EXIT_USAGE,
} from "../exit-codes.js";
import { runScopeGuard } from "../cli-support.js";
import { diffCachedNames, lsFilesAll, showStagedBlob } from "../env/git.js";
import {
  localSecretValues,
  rulePlaintextSecrets,
  rulePrivateKey,
  ruleSecretValue,
  ruleUnencryptedSops,
  ruleYamlSyntax,
} from "../baseline/check-rules.js";
import {
  buildCheckResult,
  printCheckResult,
  type CheckHit,
} from "../report/summary.js";

/** `check --staged | --all [--ci]` (research R8, [cli.md](../../../../specs/004-ha-bootstrap/contracts/cli.md)). */
export function runCheck(args: CliArgs): number {
  const stop = runScopeGuard(["git"]);
  if (stop !== null) {
    console.error(`Stopped: ${stop.reason}\n${stop.message}`);
    for (const detail of stop.details ?? []) console.error(`  - ${detail}`);
    return EXIT_STOPPED;
  }
  if (!args.staged && !args.all) {
    console.error("check needs exactly one of --staged or --all.");
    return EXIT_USAGE;
  }

  const paths = args.staged ? diffCachedNames(args.dir) : lsFilesAll(args.dir);
  const secretValues = args.ci ? [] : localSecretValues(args.dir);
  const hits: CheckHit[] = [];

  for (const path of paths) {
    // `--all` lists tracked paths, which include files deleted from the working tree but not yet
    // from the index: there is nothing to check in those.
    if (!args.staged && !existsSync(join(args.dir, path))) continue;
    const content = args.staged
      ? showStagedBlob(args.dir, path)
      : readFile(join(args.dir, path));
    hits.push(...ruleYamlSyntax(path, content));
    hits.push(...rulePlaintextSecrets(path));
    hits.push(...ruleUnencryptedSops(path, content));
    if (!args.ci) hits.push(...ruleSecretValue(path, content, secretValues));
    hits.push(...rulePrivateKey(path, content));
  }

  printCheckResult(buildCheckResult(hits), args.json);
  return hits.length > 0 ? EXIT_PROBLEMS : EXIT_OK;
}

function readFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
