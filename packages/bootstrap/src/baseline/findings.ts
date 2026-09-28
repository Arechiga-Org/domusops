import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { run } from "../env/exec.js";
import { isEncryptedValue } from "../env/sops.js";
import { isMap, isScalar, parse } from "../yaml/ha-yaml.js";

/** Filesystem and repository findings the run summary reports alongside the baseline elements. */

export function findCustomIntegrations(dir: string): string[] {
  const path = join(dir, "custom_components");
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** True when a `.storage/lovelace` file (or a per-dashboard `.storage/lovelace.*`) exists. */
export function hasUiDashboards(dir: string): boolean {
  const path = join(dir, ".storage");
  if (!existsSync(path)) return false;
  return readdirSync(path).some(
    (name) => name === "lovelace" || name.startsWith("lovelace."),
  );
}

/** Every `secrets.yaml` below the configuration root, other than the root one itself. */
export function findNestedSecretsFiles(dir: string): string[] {
  const skip = new Set([
    ".storage",
    "custom_components",
    "deps",
    ".git",
    "node_modules",
  ]);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile() && entry.name === "secrets.yaml") {
        const rel = relative(dir, join(current, entry.name));
        if (rel !== "secrets.yaml") found.push(rel);
      }
    }
  };
  walk(dir);
  return found.sort();
}

export type RemoteKind = "none" | "github" | "other";

export function findRemote(dir: string): RemoteKind {
  const result = run("git", ["remote", "get-url", "origin"], { cwd: dir });
  if (result.code !== 0) return "none";
  const url = result.stdout.trim();
  if (url === "") return "none";
  return /(^|[@/.])github\.com([/:]|$)/.test(url) ? "github" : "other";
}

// A substring match, not exact (spec FR-015): "backup_password" and "api_key_prod" both count.
const SECRET_KEY_PATTERN =
  /password|passwd|token|api_key|apikey|secret|client_secret|private_key/i;

export interface InlineSecretFinding {
  path: string;
  line: number;
  key: string;
}

/**
 * Literal scalar values under a key that looks like a secret, in every `*.yaml` file the
 * instance would load (spec FR-015). A `!secret` reference is never flagged; the value itself is
 * never included in the finding.
 */
export function findInlineSecrets(dir: string): InlineSecretFinding[] {
  const findings: InlineSecretFinding[] = [];
  const skip = new Set([
    ".storage",
    "custom_components",
    "deps",
    ".git",
    "node_modules",
    "www",
  ]);
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(full);
      } else if (
        entry.isFile() &&
        /\.ya?ml$/.test(entry.name) &&
        entry.name !== "secrets.yaml" &&
        entry.name !== "secrets.sops.yaml"
      ) {
        // secrets.yaml (anywhere) legitimately holds secret-named keys, and secrets.sops.yaml's
        // values are already encrypted (`ENC[...]`), not literal — neither is an FR-015 finding.
        scanFile(full, dir, findings);
      }
    }
  };
  walk(dir);
  return findings;
}

function scanFile(
  path: string,
  root: string,
  out: InlineSecretFinding[],
): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const { doc, errors } = parse(text);
  if (errors.length > 0) return;
  const rel = relative(root, path);
  const visit = (node: unknown): void => {
    if (!isMap(node)) return;
    for (const item of node.items) {
      if (
        isScalar(item.key) &&
        SECRET_KEY_PATTERN.test(String(item.key.value))
      ) {
        const value = item.value;
        if (
          isScalar(value) &&
          (value as { tag?: string }).tag === undefined &&
          !isEncryptedValue(String(value.value))
        ) {
          const range = (item.key as { range?: readonly number[] }).range;
          const line = range?.[0] === undefined ? 0 : lineOf(text, range[0]);
          out.push({ path: rel, line, key: String(item.key.value) });
        }
      }
      visit(item.value);
    }
  };
  visit(doc.contents);
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
