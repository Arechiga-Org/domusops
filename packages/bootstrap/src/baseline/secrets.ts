import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { isTracked, logAllTouching } from "../env/git.js";
import { decrypt, encrypt } from "../env/sops.js";
import type { RunStop } from "../env/platform.js";

export const SECRETS_FILE = "secrets.yaml";
export const ENCRYPTED_FILE = "secrets.sops.yaml";

/** spec FR-014: `secrets.yaml` tracked now, or present anywhere in the repository's history. */
export function checkExposure(dir: string): boolean {
  return (
    isTracked(dir, SECRETS_FILE) || logAllTouching(dir, SECRETS_FILE).length > 0
  );
}

export function secretsExposedStop(): RunStop {
  return {
    reason: "secrets_exposed",
    message:
      "secrets.yaml is already tracked by git, or appears in its history. Its values are " +
      "exposed and should be rotated. History is never rewritten automatically; encryption is " +
      "not set up until this is resolved.",
  };
}

function normalize(text: string): string {
  const parsed = parseYaml(text) as unknown;
  return JSON.stringify(sortKeys(parsed));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface EncryptResult {
  ok: boolean;
  stop?: RunStop;
}

/**
 * Encrypts `secrets.yaml` into `secrets.sops.yaml` (or an empty mapping when no plaintext file
 * exists, spec edge case), then decrypts the result back to memory and compares it with the
 * original: a mismatch deletes the new file and returns `roundtrip_mismatch` (FR-012).
 */
export function encryptWithRoundtrip(dir: string): EncryptResult {
  const plainPath = join(dir, SECRETS_FILE);
  const encPath = join(dir, ENCRYPTED_FILE);
  const hadPlainFile = existsSync(plainPath);
  const original = hadPlainFile ? readFileSync(plainPath, "utf8") : "{}\n";

  if (!hadPlainFile) {
    writeFileSync(plainPath, original, { mode: 0o600 });
  }
  try {
    encrypt(dir, SECRETS_FILE, ENCRYPTED_FILE);
  } finally {
    if (!hadPlainFile) unlinkSync(plainPath);
  }

  const roundTripped = decrypt(dir, ENCRYPTED_FILE);
  if (normalize(roundTripped) !== normalize(original)) {
    rmSync(encPath, { force: true });
    return {
      ok: false,
      stop: {
        reason: "roundtrip_mismatch",
        message:
          "The freshly encrypted secrets.sops.yaml did not decrypt back to the original " +
          "secrets.yaml. The encrypted file was removed; nothing else was changed.",
      },
    };
  }
  return { ok: true };
}

/** Writes `secrets.yaml` from the encrypted file, atomically, mode 0600 (FR-013). */
export function decryptToPlaintext(
  dir: string,
  force: boolean,
): { ok: boolean; message?: string } {
  const plainPath = join(dir, SECRETS_FILE);
  const decrypted = decrypt(dir, ENCRYPTED_FILE);
  if (!force && existsSync(plainPath)) {
    const current = readFileSync(plainPath, "utf8");
    if (normalize(current) !== normalize(decrypted)) {
      return {
        ok: false,
        message:
          "secrets.yaml exists and differs from the encrypted copy. Run `secrets encrypt` " +
          "first if you want to keep the local edits, or pass --force to overwrite it.",
      };
    }
  }
  const tmpPath = `${plainPath}.tmp`;
  writeFileSync(tmpPath, decrypted, { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, plainPath);
  return { ok: true };
}
