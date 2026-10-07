import { run } from "./exec.js";

/**
 * SOPS wrapper (research R6). Every call is `sensitive`: on failure, the thrown error never
 * repeats `stderr` (which could, in principle, echo file content), only a fixed message.
 */

/**
 * Encrypts `srcPath` (relative to `dir`) into `destPath`. `--filename-override` makes sops match
 * `.sops.yaml`'s `creation_rules` against `destPath` (the final, `secrets.sops.yaml` name) while
 * reading from `srcPath`, so the plaintext file's own name never has to match the pattern.
 */
export function encrypt(dir: string, srcPath: string, destPath: string): void {
  const result = run(
    "sops",
    [
      "--encrypt",
      "--filename-override",
      destPath,
      "--output",
      destPath,
      srcPath,
    ],
    { cwd: dir, sensitive: true },
  );
  if (result.code !== 0) {
    throw new Error(
      "sops --encrypt failed; run it directly in the configuration directory to see why",
    );
  }
}

/** Decrypts `path` (relative to `dir`) and returns its plaintext content. */
export function decrypt(dir: string, path: string): string {
  const result = run("sops", ["--decrypt", path], {
    cwd: dir,
    sensitive: true,
  });
  if (result.code !== 0) {
    throw new Error(
      "sops --decrypt failed; run it directly in the configuration directory to see why",
    );
  }
  return result.stdout;
}

/**
 * Re-wraps the data key of `path` for its current `.sops.yaml` recipients (spec FR-028). Needs
 * one identity that could already decrypt the file before this call, exactly as it needs one
 * afterwards; it never needs a private key other than the caller's own.
 */
export function updateKeys(dir: string, path: string): void {
  const result = run("sops", ["updatekeys", "--yes", path], {
    cwd: dir,
    sensitive: true,
  });
  if (result.code !== 0) {
    throw new Error(
      "sops updatekeys failed; run it directly in the configuration directory to see why",
    );
  }
}

const ENC_VALUE = /^ENC\[AES256_GCM,data:.*,iv:.*,tag:.*,type:(\w+)\]$/;

/** True when `value` is one SOPS-encrypted scalar (`ENC[AES256_GCM,...]`, research R6). */
export function isEncryptedValue(value: string): boolean {
  return ENC_VALUE.test(value);
}

/**
 * The SOPS type tag (`str`, `int`, `float`, `bool`, `comment`) of an encrypted scalar, or `null`
 * when `value` is not one (research R6, `aes/cipher.go`). Used to type placeholder values
 * (research R7); never decrypts anything.
 */
export function parseEncType(value: string): string | null {
  return ENC_VALUE.exec(value)?.[1] ?? null;
}
