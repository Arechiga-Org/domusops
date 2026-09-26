import type { RecordKind } from "./format.js";

/**
 * The closed list of fields `standard` omits (data-model §6). `full` keeps them. Any field not on
 * this list is preserved at every detail level.
 */
export const OMITTED_FIELDS: Readonly<Record<RecordKind, readonly string[]>> = {
  entity_registry: ["id", "unique_id", "created_at", "modified_at"],
  device_registry: ["connections", "identifiers", "created_at", "modified_at"],
  area_registry: ["created_at", "modified_at"],
  config_entries: ["created_at", "modified_at"],
  states: ["last_changed", "last_updated", "last_reported", "context"],
  config: [
    "config_dir",
    "allowlist_external_dirs",
    "allowlist_external_urls",
    "whitelist_external_dirs",
    "components",
    "internal_url",
    "external_url",
  ],
};
