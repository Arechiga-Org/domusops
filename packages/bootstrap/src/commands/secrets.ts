import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliArgs } from "../cli-args.js";
import {
  EXIT_OK,
  EXIT_PROBLEMS,
  EXIT_STOPPED,
  EXIT_USAGE,
} from "../exit-codes.js";
import { packageVersion, runScopeGuard } from "../cli-support.js";
import {
  decryptToPlaintext,
  encryptWithRoundtrip,
} from "../baseline/secrets.js";
import { isValidPublicKey } from "../env/age.js";
import { updateKeys } from "../env/sops.js";
import {
  readRecipients,
  writeSopsConfig,
  SOPS_CONFIG_FILE,
} from "../baseline/sops-config.js";
import { renderSopsConfig, sha256 } from "../baseline/templates.js";
import { readRecord, writeRecord } from "../baseline/record.js";

/**
 * `secrets decrypt|encrypt|add-key|remove-key`
 * ([cli.md](../../../../specs/004-ha-bootstrap/contracts/cli.md)).
 */
export function runSecrets(
  sub: string | undefined,
  rest: readonly string[],
  args: CliArgs,
): number {
  // Unlike `init` and `validate`, the secrets subcommands work on secrets.yaml / .sops.yaml
  // directly and do not require a full Home Assistant configuration directory.
  const stop = runScopeGuard(["git", "sops"]);
  if (stop !== null) {
    console.error(`Stopped: ${stop.reason}\n${stop.message}`);
    for (const detail of stop.details ?? []) console.error(`  - ${detail}`);
    return EXIT_STOPPED;
  }

  switch (sub) {
    case "decrypt":
      return runDecrypt(args);
    case "encrypt":
      return runEncrypt(args);
    case "add-key":
      return runAddKey(rest[0], args);
    case "remove-key":
      return runRemoveKey(rest[0], args);
    default:
      console.error(`Unknown secrets subcommand: ${sub ?? "(none)"}`);
      return EXIT_USAGE;
  }
}

function runDecrypt(args: CliArgs): number {
  const result = decryptToPlaintext(args.dir, args.force);
  if (!result.ok) {
    console.error(result.message);
    return EXIT_PROBLEMS;
  }
  console.log("secrets.yaml written from secrets.sops.yaml.");
  return EXIT_OK;
}

function runEncrypt(args: CliArgs): number {
  const result = encryptWithRoundtrip(args.dir);
  if (!result.ok) {
    console.error(result.stop?.message ?? "encryption failed");
    return EXIT_PROBLEMS;
  }
  console.log("secrets.sops.yaml written from secrets.yaml.");
  return EXIT_OK;
}

function updateSopsRecordEntry(dir: string): void {
  const record = readRecord(dir);
  const recipients = readRecipients(dir);
  const content = renderSopsConfig(recipients);
  const entries = { ...(record?.elements ?? {}) };
  entries["sops-config"] = {
    path: SOPS_CONFIG_FILE,
    sha256: sha256(content),
    release: packageVersion(),
  };
  writeRecord(dir, {
    format: "domusops.bootstrap/0.1",
    release: record?.release ?? packageVersion(),
    elements: entries,
  });
}

/**
 * Writes the new recipient list and re-wraps `secrets.sops.yaml` for it. When sops fails, the
 * previous `.sops.yaml` is put back, so the configuration and the encrypted file stay in step;
 * returns the failure message, or `null` on success.
 */
function rewrapKeys(dir: string, recipients: readonly string[]): string | null {
  const configPath = join(dir, SOPS_CONFIG_FILE);
  const previous = existsSync(configPath) ? readFileSync(configPath) : null;
  writeSopsConfig(dir, recipients);
  try {
    updateKeys(dir, "secrets.sops.yaml");
  } catch (error) {
    if (previous === null) rmSync(configPath, { force: true });
    else writeFileSync(configPath, previous);
    return `${error instanceof Error ? error.message : "sops failed"}. ${SOPS_CONFIG_FILE} was left as it was.`;
  }
  return null;
}

function runAddKey(key: string | undefined, args: CliArgs): number {
  if (key === undefined || !isValidPublicKey(key)) {
    console.error(
      "secrets add-key needs one argument: an age public key (age1... plus 58 characters).",
    );
    return EXIT_USAGE;
  }
  const recipients = readRecipients(args.dir);
  if (recipients.includes(key)) {
    console.log("That key is already a recipient; nothing to do.");
    return EXIT_OK;
  }
  const failed = rewrapKeys(args.dir, [...recipients, key]);
  if (failed !== null) {
    console.error(failed);
    return EXIT_PROBLEMS;
  }
  updateSopsRecordEntry(args.dir);
  console.log(
    "Key added. secrets.sops.yaml re-encrypted for the new recipient list.",
  );
  return EXIT_OK;
}

function runRemoveKey(key: string | undefined, args: CliArgs): number {
  if (key === undefined || !isValidPublicKey(key)) {
    console.error(
      "secrets remove-key needs one argument: an age public key (age1... plus 58 characters).",
    );
    return EXIT_USAGE;
  }
  const recipients = readRecipients(args.dir);
  if (!recipients.includes(key)) {
    console.error("That key is not a current recipient.");
    return EXIT_PROBLEMS;
  }
  const remaining = recipients.filter((r) => r !== key);
  if (remaining.length === 0) {
    console.error(
      "Refusing to remove the last recipient: nobody would be able to decrypt the secrets.",
    );
    return EXIT_PROBLEMS;
  }
  const failed = rewrapKeys(args.dir, remaining);
  if (failed !== null) {
    console.error(failed);
    return EXIT_PROBLEMS;
  }
  updateSopsRecordEntry(args.dir);
  console.log(
    "Key removed. secrets.sops.yaml re-encrypted for the remaining recipients.",
  );
  console.log(
    "The removed key can still decrypt every earlier version of the file in git history, and " +
      "the values themselves did not change. If that person should no longer know these " +
      "secrets, rotate the secrets themselves.",
  );
  return EXIT_OK;
}
