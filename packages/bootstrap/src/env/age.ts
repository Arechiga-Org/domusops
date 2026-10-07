import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./exec.js";

/**
 * age identity resolution (research R6), following the same order SOPS itself uses
 * (`age/keysource.go`): `SOPS_AGE_KEY`, `SOPS_AGE_KEY_FILE`, `SOPS_AGE_KEY_CMD`, then the
 * per-OS default file. Every function that touches identity material is `sensitive`.
 */

export type AgeIdentitySource =
  "SOPS_AGE_KEY" | "SOPS_AGE_KEY_FILE" | "SOPS_AGE_KEY_CMD" | "default";

export interface AgeIdentity {
  source: AgeIdentitySource;
  /** The identity file's path, for file-based sources. */
  path?: string;
  /** The identity text itself, for `SOPS_AGE_KEY` and `SOPS_AGE_KEY_CMD`. */
  content?: string;
}

/** `$XDG_CONFIG_HOME/sops/age/keys.txt`, or the OS default config directory (research R6). */
export function defaultKeyFilePath(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base =
    xdg !== undefined && xdg !== ""
      ? xdg
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : join(homedir(), ".config");
  return join(base, "sops", "age", "keys.txt");
}

export function resolveIdentity(): AgeIdentity | null {
  const envKey = process.env["SOPS_AGE_KEY"];
  if (envKey !== undefined && envKey !== "")
    return { source: "SOPS_AGE_KEY", content: envKey };

  const envFile = process.env["SOPS_AGE_KEY_FILE"];
  if (envFile !== undefined && envFile !== "" && existsSync(envFile)) {
    return { source: "SOPS_AGE_KEY_FILE", path: envFile };
  }

  const envCmd = process.env["SOPS_AGE_KEY_CMD"];
  if (envCmd !== undefined && envCmd !== "") {
    const result = run("sh", ["-c", envCmd], { sensitive: true });
    if (result.code === 0 && result.stdout.trim() !== "") {
      return { source: "SOPS_AGE_KEY_CMD", content: result.stdout };
    }
  }

  const defaultPath = defaultKeyFilePath();
  if (existsSync(defaultPath)) return { source: "default", path: defaultPath };

  return null;
}

/** The public key of a resolved (or freshly created) identity, via `age-keygen -y`. */
export function publicKeyOf(identity: AgeIdentity): string {
  const result =
    identity.path !== undefined
      ? run("age-keygen", ["-y", identity.path], { sensitive: true })
      : run("age-keygen", ["-y"], {
          sensitive: true,
          input: identity.content ?? "",
        });
  if (result.code !== 0) {
    throw new Error(
      "could not derive a public key from the resolved age identity",
    );
  }
  return result.stdout.trim();
}

/**
 * Creates a new identity at `path` (never overwriting an existing file, FR-011), mode 0600, and
 * returns its public key.
 */
export function keygen(path: string): string {
  if (existsSync(path)) {
    throw new Error(`refusing to overwrite an existing key file: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const result = run("age-keygen", ["-o", path], { sensitive: true });
  if (result.code !== 0) {
    throw new Error("age-keygen failed; run it directly to see why");
  }
  chmodSync(path, 0o600);
  return publicKeyOf({ source: "default", path });
}

const PUBLIC_KEY = /^age1[a-z0-9]{58}$/;

/** An age public key is `age1` plus 58 bech32 characters (spec FR-028). */
export function isValidPublicKey(text: string): boolean {
  return PUBLIC_KEY.test(text);
}
