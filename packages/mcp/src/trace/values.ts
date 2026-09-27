import {
  encodeContextId,
  ENCODED_CONTEXT_ID,
  formatMsOffset,
  parseIsoMicros,
  type JsonObject,
} from "@domusops/schema";

/**
 * Value encoding of the trace format (data-model §3.2): the inverse of `decodeValue` in
 * `@domusops/schema`. Stage one (`encodeValue`) rewrites timestamps, context IDs, states, and
 * contexts into their forms and escapes anything that could be misread; stage two (`buildTables`)
 * factors repeated strings and subtrees into the document's tables.
 */

/** The instant a run started. Values of a run are anchored to it; configurations are not. */
export interface EncodeAnchor {
  startMicros: number;
}

const RESERVED = new Set(["$", "S", "D", "C", "v"]);

const STATE_KEYS = [
  "entity_id",
  "state",
  "attributes",
  "last_changed",
  "last_updated",
  "last_reported",
  "context",
];

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A context object: exactly `id`, `parent_id`, and `user_id`. */
export function isContextObject(value: unknown): value is {
  id: string;
  parent_id: string | null;
  user_id: string | null;
} {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    ["id", "parent_id", "user_id"].every((k) => keys.includes(k)) &&
    typeof value["id"] === "string" &&
    (value["parent_id"] === null || typeof value["parent_id"] === "string") &&
    (value["user_id"] === null || typeof value["user_id"] === "string")
  );
}

/** A state object (data-model §3.2). */
export interface StateObject {
  entity_id: string;
  state: string;
  attributes: JsonObject;
  last_changed: string;
  last_updated: string;
  last_reported: string;
  context: JsonObject | null;
}

/** A state object: exactly the seven keys of a state, of the right kinds (data-model §3.2). */
export function isStateObject(value: unknown): value is StateObject {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === STATE_KEYS.length &&
    STATE_KEYS.every((k) => keys.includes(k)) &&
    typeof value["entity_id"] === "string" &&
    typeof value["state"] === "string" &&
    isObject(value["attributes"]) &&
    typeof value["last_changed"] === "string" &&
    typeof value["last_updated"] === "string" &&
    typeof value["last_reported"] === "string" &&
    (value["context"] === null || isContextObject(value["context"]))
  );
}

const reservedOnly = (value: JsonObject): boolean => {
  const keys = Object.keys(value);
  return keys.length === 1 && RESERVED.has(keys[0] as string);
};

function encodeString(text: string, anchor: EncodeAnchor | null): unknown {
  if (anchor !== null) {
    const micros = parseIsoMicros(text);
    if (micros !== null) {
      return `@${formatMsOffset(micros - anchor.startMicros)}`;
    }
    const second = Math.floor(anchor.startMicros / 1_000_000) * 1000;
    const context = encodeContextId(text, second);
    if (typeof context !== "string") return context;
    if (context !== text) return context;
  }
  return text.startsWith("#") ||
    text.startsWith("@") ||
    ENCODED_CONTEXT_ID.test(text)
    ? { v: text }
    : text;
}

/** How a state object relates to a base it is expressed against (data-model §3.2). */
interface Base {
  tag: "this" | "from";
  attributes: JsonObject;
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function encodeState(
  state: StateObject,
  anchor: EncodeAnchor | null,
  base: Base | null,
): unknown {
  const lastUpdated =
    state.last_updated === state.last_changed
      ? 0
      : encodeValue(state.last_updated, anchor);
  const lastReported =
    state.last_reported === state.last_updated
      ? 0
      : encodeValue(state.last_reported, anchor);
  const changed = encodeValue(state.last_changed, anchor);
  const context = encodeValue(state.context, anchor);
  if (base === null) {
    return {
      S: [
        encodeValue(state.entity_id, anchor),
        encodeValue(state.state, anchor),
        encodeValue(state.attributes, anchor),
        changed,
        lastUpdated,
        lastReported,
        context,
      ],
    };
  }
  const set: JsonObject = {};
  for (const [key, value] of Object.entries(state.attributes)) {
    if (!(key in base.attributes) || !sameJson(base.attributes[key], value)) {
      set[key] = value;
    }
  }
  const unset = Object.keys(base.attributes).filter(
    (key) => !(key in state.attributes),
  );
  return {
    D: [
      base.tag,
      encodeValue(state.state, anchor),
      encodeValue(set, anchor),
      unset.map((key) => encodeValue(key, anchor)),
      changed,
      lastUpdated,
      lastReported,
      context,
    ],
  };
}

/** Stage one: rewrites one value into the forms of data-model §3.2. */
export function encodeValue(
  value: unknown,
  anchor: EncodeAnchor | null,
): unknown {
  if (typeof value === "string") return encodeString(value, anchor);
  if (Array.isArray(value))
    return value.map((item) => encodeValue(item, anchor));
  if (!isObject(value)) return value;
  if (isStateObject(value)) return encodeState(value, anchor, null);
  if (isContextObject(value)) {
    return {
      C: [
        encodeValue(value.id, anchor),
        value.parent_id === null ? null : encodeValue(value.parent_id, anchor),
        value.user_id === null ? null : encodeValue(value.user_id, anchor),
      ],
    };
  }
  if (reservedOnly(value)) return { v: value };
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = encodeValue(item, anchor);
  }
  return out;
}

/** The `this` template of an item: its entity and the attributes every `this` state shares. */
export interface ThisTemplate {
  entity_id: string;
  attributes: JsonObject;
}

/**
 * Encodes the changed variables of a step: `this` against the item's template, a trigger's
 * `to_state` against its `from_state`, everything else generically.
 */
export function encodeVariables(
  variables: JsonObject,
  anchor: EncodeAnchor,
  template: ThisTemplate | null,
): unknown {
  if (reservedOnly(variables)) return { v: variables };
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(variables)) {
    if (
      key === "this" &&
      template !== null &&
      isStateObject(value) &&
      value.entity_id === template.entity_id
    ) {
      out[key] = encodeState(value, anchor, {
        tag: "this",
        attributes: template.attributes,
      });
    } else if (key === "trigger" && isObject(value)) {
      out[key] = encodeTrigger(value, anchor);
    } else {
      out[key] = encodeValue(value, anchor);
    }
  }
  return out;
}

function encodeTrigger(trigger: JsonObject, anchor: EncodeAnchor): unknown {
  if (reservedOnly(trigger)) return { v: trigger };
  const from = trigger["from_state"];
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(trigger)) {
    if (
      key === "to_state" &&
      isStateObject(value) &&
      isStateObject(from) &&
      value.entity_id === from.entity_id
    ) {
      out[key] = encodeState(value, anchor, {
        tag: "from",
        attributes: from.attributes,
      });
    } else {
      out[key] = encodeValue(value, anchor);
    }
  }
  return out;
}

const MIN_STRING = 6;
const MIN_SUBTREE = 16;

/** One encoded tree to factor, and whether the tree itself may become a `values` reference. */
export interface Root {
  value: unknown;
  replaceTop: boolean;
}

export interface Tables {
  strings: string[];
  values: unknown[];
  /** The roots, with repeated subtrees and strings replaced, in the order given. */
  roots: unknown[];
}

const isNode = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

/**
 * Applies `fn` to the children of a node that may be replaced by a reference. A `{v: ...}`
 * literal is opaque, and the array inside an `S`, `D`, or `C` form is not itself replaceable (its
 * elements are), so a form always keeps its shape. The base of a delta is never touched.
 */
function mapChildren(node: object, fn: (child: unknown) => unknown): unknown {
  if (Array.isArray(node)) return node.map((child) => fn(child));
  const entries = Object.entries(node as JsonObject);
  if (entries.length === 1) {
    const [key, inner] = entries[0] as [string, unknown];
    if (key === "v") return node;
    if ((key === "S" || key === "D" || key === "C") && Array.isArray(inner)) {
      return {
        [key]: inner.map((child, index) =>
          key === "D" && index === 0 ? child : fn(child),
        ),
      };
    }
  }
  const out: JsonObject = {};
  for (const [key, child] of entries) out[key] = fn(child);
  return out;
}

const eligibleString = (text: string): boolean =>
  text.length >= MIN_STRING &&
  !text.startsWith("@") &&
  !text.startsWith("#") &&
  !ENCODED_CONTEXT_ID.test(text);

/**
 * Stage two: a string of at least 6 characters that occurs at least twice goes into `strings`
 * (sorted by descending count, then code point), and a subtree serialising to at least 16 bytes
 * that occurs at least twice goes into `values`, children before parents, in order of first
 * occurrence (data-model §3.2). A subtree inside a repeated subtree is counted once: it lives in
 * one table entry.
 */
export function buildTables(roots: readonly Root[]): Tables {
  const cache = new WeakMap<object, string>();
  const serialise = (node: unknown): string => {
    if (!isNode(node)) return JSON.stringify(node);
    const hit = cache.get(node);
    if (hit !== undefined) return hit;
    const text = JSON.stringify(node);
    cache.set(node, text);
    return text;
  };

  const counts = new Map<string, number>();
  const tally = (node: unknown): void => {
    if (!isNode(node)) return;
    const key = serialise(node);
    const seen = counts.get(key) ?? 0;
    if (key.length >= MIN_SUBTREE) counts.set(key, seen + 1);
    if (seen > 0 && key.length >= MIN_SUBTREE) return;
    mapChildren(node, (child) => {
      tally(child);
      return child;
    });
  };
  for (const root of roots) tally(root.value);

  const table: unknown[] = [];
  const index = new Map<string, number>();
  const replaceSubtrees = (
    node: unknown,
    top: boolean,
    allowTop: boolean,
  ): unknown => {
    if (!isNode(node)) return node;
    const key = serialise(node);
    const replaced = mapChildren(node, (child) =>
      replaceSubtrees(child, false, true),
    );
    if ((!top || allowTop) && (counts.get(key) ?? 0) >= 2) {
      let at = index.get(key);
      if (at === undefined) {
        at = table.length;
        table.push(replaced);
        index.set(key, at);
      }
      return { $: at };
    }
    return replaced;
  };
  const shrunk = roots.map((root) =>
    replaceSubtrees(root.value, true, root.replaceTop),
  );

  const stringCounts = new Map<string, number>();
  const tallyStrings = (node: unknown): void => {
    if (typeof node === "string") {
      if (eligibleString(node)) {
        stringCounts.set(node, (stringCounts.get(node) ?? 0) + 1);
      }
      return;
    }
    if (!isNode(node)) return;
    mapChildren(node, (child) => {
      tallyStrings(child);
      return child;
    });
  };
  for (const tree of [...shrunk, ...table]) tallyStrings(tree);
  const strings = [...stringCounts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([text]) => text);
  const stringIndex = new Map(strings.map((text, at) => [text, at]));
  const replaceStrings = (node: unknown): unknown => {
    if (typeof node === "string") {
      const at = stringIndex.get(node);
      return at === undefined ? node : `#${at}`;
    }
    if (!isNode(node)) return node;
    return mapChildren(node, replaceStrings);
  };
  return {
    strings,
    values: table.map(replaceStrings),
    roots: shrunk.map(replaceStrings),
  };
}
