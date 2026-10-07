import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isScalar, isSeq, parse } from "../yaml/ha-yaml.js";
import { isEncryptedValue } from "../env/sops.js";
import type { CheckHit } from "../report/summary.js";

/**
 * The five pre-commit rules (research R8). Each takes one staged (or, for `--all`, tracked) file
 * and its content, and returns the hits it finds — never the secret value or key material
 * itself, only the file, line where there is one, and the rule id.
 */

const PRIVATE_KEY_PATTERN =
  /AGE-SECRET-KEY-1|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const MIN_SECRET_VALUE_LENGTH = 8;

export function ruleYamlSyntax(path: string, content: string): CheckHit[] {
  if (!/\.ya?ml$/.test(path)) return [];
  const { errors } = parse(content);
  return errors.map((err) => ({
    path,
    line: err.line || null,
    rule: "yaml-syntax",
    message: err.message.split("\n")[0] ?? "invalid YAML",
  }));
}

export function rulePlaintextSecrets(path: string): CheckHit[] {
  const base = path.split("/").pop();
  if (base !== "secrets.yaml") return [];
  return [
    {
      path,
      line: null,
      rule: "plaintext-secrets",
      message:
        "secrets.yaml must never be committed; it is encrypted into secrets.sops.yaml",
    },
  ];
}

function walkScalars(
  node: unknown,
  skipKey: string | null,
  visit: (value: string) => void,
): void {
  if (isMap(node)) {
    for (const item of node.items) {
      if (skipKey !== null && isScalar(item.key) && item.key.value === skipKey)
        continue;
      walkScalars(item.value, null, visit);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) walkScalars(item, null, visit);
    return;
  }
  if (isScalar(node) && typeof node.value === "string") visit(node.value);
}

/** Like `walkScalars`, but every leaf value (any type) — used only to spot an unencrypted one. */
function walkAllScalars(
  node: unknown,
  skipKey: string | null,
  visit: (value: unknown) => void,
): void {
  if (isMap(node)) {
    for (const item of node.items) {
      if (skipKey !== null && isScalar(item.key) && item.key.value === skipKey)
        continue;
      walkAllScalars(item.value, null, visit);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) walkAllScalars(item, null, visit);
    return;
  }
  if (isScalar(node)) visit(node.value);
}

export function ruleUnencryptedSops(path: string, content: string): CheckHit[] {
  const base = path.split("/").pop() ?? path;
  // `.sops.yaml` is the plain-text encryption *config* (creation_rules, public keys only) — it
  // also ends with ".sops.yaml" but is never itself an encrypted data file, so it is excluded.
  if (!base.endsWith(".sops.yaml") || base === ".sops.yaml") return [];
  const { doc, errors } = parse(content);
  if (errors.length > 0) {
    return [
      { path, line: null, rule: "unencrypted-sops", message: "not valid YAML" },
    ];
  }
  const root = doc.contents;
  const hasSopsMetadata =
    isMap(root) &&
    root.items.some((item) => isScalar(item.key) && item.key.value === "sops");
  if (!hasSopsMetadata) {
    return [
      {
        path,
        line: null,
        rule: "unencrypted-sops",
        message:
          "missing the sops: metadata section; this file was never encrypted",
      },
    ];
  }
  let hasPlainValue = false;
  walkAllScalars(root, "sops", (value) => {
    if (typeof value !== "string" || !isEncryptedValue(value))
      hasPlainValue = true;
  });
  if (hasPlainValue) {
    return [
      {
        path,
        line: null,
        rule: "unencrypted-sops",
        message:
          "contains a value that is not ENC[...]; it was edited after encryption",
      },
    ];
  }
  return [];
}

/** Values (8+ characters, trimmed) of the working-tree `secrets.yaml`, if any. */
export function localSecretValues(dir: string): string[] {
  const path = join(dir, "secrets.yaml");
  if (!existsSync(path)) return [];
  const { doc, errors } = parse(readFileSync(path, "utf8"));
  if (errors.length > 0) return [];
  const values: string[] = [];
  walkScalars(doc.contents, null, (value) => {
    const trimmed = value.trim();
    if (trimmed.length >= MIN_SECRET_VALUE_LENGTH) values.push(trimmed);
  });
  return values;
}

export function ruleSecretValue(
  path: string,
  content: string,
  secretValues: readonly string[],
): CheckHit[] {
  for (const value of secretValues) {
    if (content.includes(value)) {
      return [
        {
          path,
          line: null,
          rule: "secret-value",
          message: "contains a value from your local secrets.yaml",
        },
      ];
    }
  }
  return [];
}

export function rulePrivateKey(path: string, content: string): CheckHit[] {
  if (PRIVATE_KEY_PATTERN.test(content)) {
    return [
      {
        path,
        line: null,
        rule: "private-key",
        message: "contains what looks like a private key",
      },
    ];
  }
  return [];
}
