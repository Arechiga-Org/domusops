import type { JsonObject } from "../format.js";
import { decodeContextId, ENCODED_CONTEXT_ID } from "../logbook/ulid.js";

/**
 * Value decoding of the trace format (data-model §3.2), and the timestamp arithmetic the encoder
 * and the decoder share. Times inside a run are microseconds since the epoch, kept as integers
 * (about 1.8e15, inside the exact range of a double).
 */

const ISO = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{6}))?\+00:00$/;

/**
 * Parses a canonical UTC timestamp as Python's `isoformat()` writes it (`+00:00`, six fraction
 * digits, or none when the microsecond is zero) into microseconds since the epoch. Anything else,
 * including a string that is not the canonical form of a real instant, returns `null`, so it is
 * left as a literal and decoding stays exact.
 */
export function parseIsoMicros(text: string): number | null {
  const m = ISO.exec(text);
  if (m === null) return null;
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  if (Number.isNaN(ms)) return null;
  const micros = ms * 1000 + Number(m[7] ?? "0");
  return formatIsoMicros(micros) === text ? micros : null;
}

/** The canonical UTC form of an instant given in microseconds since the epoch. */
export function formatIsoMicros(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const fraction = (((ms % 1000) + 1000) % 1000) * 1000 + (micros - ms * 1000);
  const base = new Date(ms - (((ms % 1000) + 1000) % 1000))
    .toISOString()
    .slice(0, 19);
  return `${base}${
    fraction === 0 ? "" : `.${String(fraction).padStart(6, "0")}`
  }+00:00`;
}

/** Microseconds as milliseconds with up to three decimals: `12`, `12.5`, `-0.912`. */
export function formatMsOffset(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1000);
  const fraction = String(abs % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/** Inverse of `formatMsOffset`; `null` when the text is not of that form. */
export function parseMsOffset(text: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (m === null) return null;
  const micros = Number(m[2]) * 1000 + Number((m[3] ?? "").padEnd(3, "0"));
  return m[1] === "-" ? -micros : micros;
}

/** Where the tables of a document are, and the run a value belongs to. */
export interface DecodeTables {
  strings: readonly string[];
  values: readonly unknown[];
}

/** The instant a run started. Values of a run are anchored to it; configurations are not. */
export interface DecodeAnchor {
  startMicros: number;
}

/** A state a delta is expressed against (data-model §3.2). */
export interface StateBase {
  entity_id: unknown;
  attributes: JsonObject;
}

export interface DecodeBases {
  /** The item's `this` template. */
  this?: StateBase;
  /** The `from_state` of the trigger object being decoded. */
  from?: StateBase;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStateBase(value: unknown): value is StateBase {
  return isObject(value) && isObject(value["attributes"]);
}

/**
 * Decodes one encoded value. `anchor` is `null` for unanchored positions (configurations,
 * blueprint inputs, the `this` template), where timestamps and context IDs are never encoded.
 */
export function decodeValue(
  value: unknown,
  anchor: DecodeAnchor | null,
  tables: DecodeTables,
  bases: DecodeBases = {},
): unknown {
  if (typeof value === "string") return decodeString(value, anchor, tables);
  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item, anchor, tables, bases));
  }
  if (!isObject(value)) return value;

  const keys = Object.keys(value);
  const only = keys.length === 1 ? (keys[0] as string) : null;
  if (only === "$") {
    const index = value["$"];
    if (typeof index !== "number" || !(index in tables.values)) {
      throw new Error(`unresolved values reference ${String(index)}`);
    }
    return decodeValue(tables.values[index], anchor, tables, bases);
  }
  if (only === "v") return value["v"];
  const form = only === null ? undefined : value[only];
  if (only === "S" && Array.isArray(form)) {
    return decodeState(form, false, anchor, tables, bases);
  }
  if (only === "D" && Array.isArray(form)) {
    return decodeState(form, true, anchor, tables, bases);
  }
  if (only === "C" && Array.isArray(form)) {
    const [id, parent, user] = form.map((item) =>
      decodeValue(item, anchor, tables, bases),
    );
    return { id, parent_id: parent ?? null, user_id: user ?? null };
  }

  // A plain object. The `from_state` of a trigger is the base of its `to_state`.
  let scope = bases;
  const out: Record<string, unknown> = {};
  const done = new Set<string>();
  if ("from_state" in value) {
    const from = decodeValue(value["from_state"], anchor, tables, bases);
    out["from_state"] = from;
    done.add("from_state");
    if (isStateBase(from)) scope = { ...bases, from };
  }
  for (const key of keys) {
    if (done.has(key)) {
      // Keep the input key order: the key was set first only to be available as a base.
      const held = out[key];
      delete out[key];
      out[key] = held;
    } else {
      out[key] = decodeValue(value[key], anchor, tables, scope);
    }
  }
  return out;
}

function decodeString(
  text: string,
  anchor: DecodeAnchor | null,
  tables: DecodeTables,
): unknown {
  if (text.startsWith("#")) {
    const index = Number(text.slice(1));
    const entry = tables.strings[index];
    if (!Number.isInteger(index) || entry === undefined) {
      throw new Error(`unresolved string reference ${text}`);
    }
    return entry;
  }
  if (anchor !== null) {
    if (text.startsWith("@")) {
      const offset = parseMsOffset(text.slice(1));
      if (offset === null) throw new Error(`invalid timestamp ${text}`);
      return formatIsoMicros(anchor.startMicros + offset);
    }
    if (ENCODED_CONTEXT_ID.test(text)) {
      return decodeContextId(
        text,
        Math.floor(anchor.startMicros / 1_000_000) * 1000,
      );
    }
  }
  return text;
}

function decodeState(
  form: unknown[],
  delta: boolean,
  anchor: DecodeAnchor | null,
  tables: DecodeTables,
  bases: DecodeBases,
): JsonObject {
  const at = (index: number): unknown =>
    decodeValue(form[index], anchor, tables, bases);
  if (!delta) {
    // [entity_id, state, attributes, last_changed, last_updated, last_reported, context]
    const lastChanged = at(3);
    const lastUpdated = form[4] === 0 ? lastChanged : at(4);
    const lastReported = form[5] === 0 ? lastUpdated : at(5);
    return {
      entity_id: at(0),
      state: at(1),
      attributes: at(2),
      last_changed: lastChanged,
      last_reported: lastReported,
      last_updated: lastUpdated,
      context: at(6),
    };
  }
  // [base, state, set, unset, last_changed, last_updated, last_reported, context]
  const base = form[0] === "this" ? bases.this : bases.from;
  if (base === undefined) {
    throw new Error(`a state delta against "${String(form[0])}" has no base`);
  }
  const unset = new Set(Array.isArray(form[3]) ? form[3] : []);
  const attributes: JsonObject = {};
  for (const [key, item] of Object.entries(base.attributes)) {
    if (!unset.has(key)) attributes[key] = item;
  }
  Object.assign(attributes, at(2) as JsonObject);
  const lastChanged = at(4);
  const lastUpdated = form[5] === 0 ? lastChanged : at(5);
  const lastReported = form[6] === 0 ? lastUpdated : at(6);
  return {
    entity_id: base.entity_id,
    state: at(1),
    attributes,
    last_changed: lastChanged,
    last_reported: lastReported,
    last_updated: lastUpdated,
    context: at(7),
  };
}
