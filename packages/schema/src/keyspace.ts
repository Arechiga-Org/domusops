import type { JsonObject } from "./format.js";

/** Registry fields of an entity are prefixed in the flat key space of an entity record. */
export const REG_PREFIX = "reg.";
/** State-object fields other than `state` and `attributes` (only present in `full`). */
export const STATE_PREFIX = "st.";
const ESCAPE = "~";
/** Marks a reference whose target is absent from the snapshot (data-model §3.4). */
export const ORPHAN = "!";

const RESERVED = new Set(["entity_id", "state", "device", "alias", "id"]);

/**
 * Attribute and unknown record keys share a namespace with prefixed and reserved keys. A key that
 * could collide is escaped with a leading "~"; decoding strips one.
 */
export function escapeKey(key: string): string {
  return key.startsWith(REG_PREFIX) ||
    key.startsWith(STATE_PREFIX) ||
    key.startsWith(ESCAPE) ||
    RESERVED.has(key)
    ? ESCAPE + key
    : key;
}

export function unescapeKey(key: string): string {
  return key.startsWith(ESCAPE) ? key.slice(1) : key;
}

export type RefKind = "device" | "entry" | "area" | "entity";

/** Reference fields of registry records (data-model §3.4). */
const REFERENCE_FIELDS: Readonly<
  Record<string, Readonly<Record<string, RefKind>>>
> = {
  device_registry: {
    area_id: "area",
    via_device_id: "device",
    parent_device_id: "device",
    config_entries: "entry",
    primary_config_entry: "entry",
    config_entry_id: "entry",
  },
  area_registry: {
    humidity_entity_id: "entity",
    temperature_entity_id: "entity",
  },
};

/**
 * Returns a copy of `record` with every reference field passed through `fn`. Arrays are mapped
 * element by element, and the keys of `config_entries_subentries` are entry references.
 */
export function mapReferences(
  kind: "device_registry" | "area_registry",
  record: JsonObject,
  fn: (ref: RefKind, value: string) => string,
): JsonObject {
  const fields = REFERENCE_FIELDS[kind] ?? {};
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    const ref = fields[key];
    if (ref !== undefined) {
      if (typeof value === "string") out[key] = fn(ref, value);
      else if (Array.isArray(value)) {
        out[key] = value.map((v) => (typeof v === "string" ? fn(ref, v) : v));
      } else out[key] = value;
    } else if (
      kind === "device_registry" &&
      key === "config_entries_subentries" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const mapped: JsonObject = {};
      for (const [entry, subs] of Object.entries(value))
        mapped[fn("entry", entry)] = subs;
      out[key] = mapped;
    } else out[key] = value;
  }
  return out;
}
