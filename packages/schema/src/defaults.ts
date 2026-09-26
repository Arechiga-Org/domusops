import type { JsonObject, RecordKind } from "./format.js";

/**
 * Field defaults (data-model §7). In `standard` and `full`, a field equal to its default is
 * omitted; decoding restores it. State attributes have no defaults.
 */
export const DEFAULTS: Readonly<Record<RecordKind, Readonly<JsonObject>>> = {
  entity_registry: {
    area_id: null,
    categories: {},
    config_subentry_id: null,
    disabled_by: null,
    entity_category: null,
    has_entity_name: true,
    hidden_by: null,
    icon: null,
    labels: [],
    name: null,
    options: {},
    original_name: null,
    translation_key: null,
  },
  device_registry: {
    area_id: null,
    configuration_url: null,
    config_entry_id: null,
    config_subentry_id: null,
    disabled_by: null,
    entry_type: null,
    hw_version: null,
    labels: [],
    manufacturer: null,
    model: null,
    model_id: null,
    name_by_user: null,
    parent_device_id: null,
    serial_number: null,
    sw_version: null,
    via_device_id: null,
  },
  area_registry: {
    aliases: [],
    floor_id: null,
    humidity_entity_id: null,
    icon: null,
    labels: [],
    picture: null,
    temperature_entity_id: null,
  },
  config_entries: {
    disabled_by: null,
    error_reason_translation_domain: null,
    error_reason_translation_key: null,
    error_reason_translation_placeholders: null,
    num_subentries: 0,
    pref_disable_new_entities: false,
    pref_disable_polling: false,
    reason: null,
    source: "user",
    state: "loaded",
    supported_subentry_types: {},
    supports_options: false,
    supports_reconfigure: false,
    supports_remove_device: false,
    supports_unload: false,
  },
  config: {
    safe_mode: false,
    recovery_mode: false,
    state: "RUNNING",
  },
  states: {},
};

/**
 * Defaults derived from other fields of the same record. A device with exactly one config entry
 * defaults `primary_config_entry` to it, and every entry defaults to the single main subentry.
 */
export function derivedDefaults(
  kind: RecordKind,
  record: JsonObject,
): JsonObject {
  if (kind !== "device_registry") return {};
  const entries = record["config_entries"];
  if (!Array.isArray(entries)) return {};
  const out: JsonObject = {};
  if (entries.length === 1 && typeof entries[0] === "string") {
    out["primary_config_entry"] = entries[0];
  }
  const subentries: Record<string, unknown[]> = {};
  for (const entry of entries) {
    if (typeof entry === "string") subentries[entry] = [null];
  }
  out["config_entries_subentries"] = subentries;
  return out;
}

/** Static and derived defaults that apply to `record`. */
export function defaultsFor(kind: RecordKind, record: JsonObject): JsonObject {
  return { ...DEFAULTS[kind], ...derivedDefaults(kind, record) };
}
