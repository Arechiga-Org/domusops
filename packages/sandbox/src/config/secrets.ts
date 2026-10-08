export type SecretsKind = "placeholders" | "caller-file" | "none-referenced";

export interface GeneratedSecrets {
  kind: SecretsKind;
  /** The `secrets.yaml` to put in the instance; `null` when nothing references a secret. */
  content: string | null;
  /** Keys given a placeholder; empty unless `kind` is `placeholders`. */
  placeholderKeys: string[];
}

const SECRET_REFERENCE = /!secret\s+['"]?([A-Za-z0-9_.-]+)/g;
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const SOPS_ENTRY = /^([A-Za-z0-9_.-]+):\s*['"]?ENC\[[^\]]*\btype:(\w+)/;

/** The text of a YAML line without its trailing comment. */
function withoutComment(line: string): string {
  const match = /(^|\s)#/.exec(line);
  return match === null ? line : line.slice(0, match.index);
}

/** Keys referenced as `!secret <key>` in a YAML document, in order of first appearance. */
export function referencedSecrets(yaml: string): string[] {
  const keys: string[] = [];
  for (const line of yaml.split("\n")) {
    for (const match of withoutComment(line).matchAll(SECRET_REFERENCE)) {
      const key = match[1];
      if (key !== undefined && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * The value type each top-level key of a SOPS file declares in its `ENC[…,type:…]` marker.
 * The marker is readable without the key: nothing is decrypted and no value is kept.
 */
export function sopsTypes(sopsText: string): Map<string, string> {
  const types = new Map<string, string>();
  for (const line of sopsText.split("\n")) {
    const match = SOPS_ENTRY.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      types.set(match[1], match[2]);
    }
  }
  return types;
}

/** A YAML scalar that satisfies an integration expecting `type`, and says it is a placeholder. */
export function placeholderValue(
  key: string,
  type: string | undefined,
): string {
  switch (type) {
    case "int":
      return "0";
    case "float":
      return "0.0";
    case "bool":
      return "false";
    default:
      return `domusops-placeholder-${key}`;
  }
}

function yamlKey(key: string): string {
  return BARE_KEY.test(key) ? key : JSON.stringify(key);
}

/**
 * What the instance's `secrets.yaml` holds. A file the caller names wins and is used as is;
 * otherwise every referenced key gets a placeholder, typed from the SOPS markers when it can be.
 */
export function buildSecrets(input: {
  referenced: readonly string[];
  sopsText?: string;
  callerFile?: string;
}): GeneratedSecrets {
  if (input.callerFile !== undefined) {
    return {
      kind: "caller-file",
      content: input.callerFile,
      placeholderKeys: [],
    };
  }
  if (input.referenced.length === 0) {
    return { kind: "none-referenced", content: null, placeholderKeys: [] };
  }
  const types = sopsTypes(input.sopsText ?? "");
  const lines = input.referenced.map(
    (key) => `${yamlKey(key)}: ${placeholderValue(key, types.get(key))}`,
  );
  return {
    kind: "placeholders",
    content: `${lines.join("\n")}\n`,
    placeholderKeys: [...input.referenced],
  };
}
