import {
  OMITTED_FIELDS,
  canonicalize,
  deepEqual,
  defaultsFor,
  type JsonObject,
  type RawRecords,
  type RecordKind,
} from "@domusops/schema";

export interface ProjectOptions {
  /** Remove the closed omission list (`standard`); `full` keeps every field. */
  omit: boolean;
}

function projectRecord<T extends JsonObject>(
  kind: RecordKind,
  record: T,
  omit: boolean,
): T {
  const out: JsonObject = {};
  const omitted = omit ? OMITTED_FIELDS[kind] : [];
  for (const [key, value] of Object.entries(record)) {
    if (!omitted.includes(key)) out[key] = canonicalize(value);
  }
  // Defaults are compared after omission: derived defaults only read fields that are never omitted.
  for (const [key, fallback] of Object.entries(defaultsFor(kind, out))) {
    if (key in out && deepEqual(out[key], fallback)) delete out[key];
  }
  return out as T;
}

/**
 * Applies the omission list (when `omit` is set) and elides default-valued fields (data-model §6
 * and §7). Keys are put in sorted order so serialisation is deterministic.
 */
export function project(
  records: RawRecords,
  options: ProjectOptions,
): RawRecords {
  const { omit } = options;
  return {
    config: projectRecord("config", records.config, omit),
    states: records.states.map((r) => projectRecord("states", r, omit)),
    entity_registry: records.entity_registry.map((r) =>
      projectRecord("entity_registry", r, omit),
    ),
    device_registry: records.device_registry.map((r) =>
      projectRecord("device_registry", r, omit),
    ),
    area_registry: records.area_registry.map((r) =>
      projectRecord("area_registry", r, omit),
    ),
    config_entries: records.config_entries.map((r) =>
      projectRecord("config_entries", r, omit),
    ),
  };
}
