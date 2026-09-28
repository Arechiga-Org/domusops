import {
  isMap,
  isScalar,
  parseDocument,
  type Document,
  type Pair,
  type Scalar,
  type YAMLMap,
} from "yaml";

/**
 * A YAML parser aware of the instance's custom tags (research R3), used to locate nodes (the
 * `homeassistant`/`packages` keys, research R5; `!secret` references, spec FR-015) without ever
 * re-serialising the document: every edit `baseline/*.ts` makes is a text-level splice against
 * the original source, using the character offsets this module reports.
 */

const HA_TAGS = [
  "!include",
  "!include_dir_list",
  "!include_dir_named",
  "!include_dir_merge_list",
  "!include_dir_merge_named",
  "!secret",
  "!env_var",
  "!input",
] as const;

const CUSTOM_TAGS = HA_TAGS.map((tag) => ({
  tag,
  resolve: (str: string) => str,
}));

export interface YamlError {
  line: number;
  column: number;
  message: string;
}

export interface ParsedYaml {
  doc: Document;
  /** Source text, kept alongside the document so callers can slice by range without re-reading. */
  text: string;
  errors: YamlError[];
}

/** Parses `text`, resolving the instance's custom tags as opaque scalars (research R3). */
export function parse(text: string): ParsedYaml {
  const doc = parseDocument(text, {
    customTags: CUSTOM_TAGS,
    uniqueKeys: true,
  });
  const errors: YamlError[] = doc.errors.map((err) => ({
    line: err.linePos?.[0]?.line ?? 0,
    column: err.linePos?.[0]?.col ?? 0,
    message: err.message,
  }));
  return { doc, text, errors };
}

export interface FoundKey {
  pair: Pair;
  keyNode: Scalar;
  valueNode: unknown;
}

/** The pair of `map` whose key is exactly `key` (a plain scalar), or `null`. */
export function findChildKey(map: unknown, key: string): FoundKey | null {
  if (!isMap(map)) return null;
  for (const item of (map as YAMLMap).items) {
    if (isScalar(item.key) && item.key.value === key) {
      return { pair: item, keyNode: item.key, valueNode: item.value };
    }
  }
  return null;
}

/** `findChildKey` at the document's top level. */
export function findTopKey(doc: Document, key: string): FoundKey | null {
  return findChildKey(doc.contents, key);
}

/** True when `node` is a block (not flow) mapping — `homeassistant: { a: 1 }` is flow. */
export function isBlockMap(node: unknown): node is YAMLMap {
  return isMap(node) && node.flow !== true;
}

/** The tag a value node was parsed with (`!secret`, `!include`, …), or `undefined` for none. */
export function tagOf(node: unknown): string | undefined {
  return isScalar(node) ? (node as Scalar).tag : undefined;
}

/** The raw source text a node spans (its value range, not including a trailing line break). */
export function sliceOf(
  text: string,
  node: { range?: readonly number[] },
): string {
  const range = node.range;
  if (range === undefined) return "";
  return text.slice(range[0], range[1] ?? range[0]);
}

/** The offset of the start of the line containing `offset`. */
export function lineStartOffset(text: string, offset: number): number {
  const before = text.lastIndexOf("\n", Math.max(offset - 1, 0));
  return before === -1 ? 0 : before + 1;
}

/** The indentation (leading spaces) of the line containing `offset`. */
export function indentAt(text: string, offset: number): string {
  const start = lineStartOffset(text, offset);
  const match = /^[ \t]*/.exec(text.slice(start));
  return match?.[0] ?? "";
}

export { isMap, isScalar };
