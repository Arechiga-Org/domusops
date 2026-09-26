import { defaultsFor } from "./defaults.js";
import type {
  JsonObject,
  RawArea,
  RawConfigEntry,
  RawDevice,
  RawEntityRegistryEntry,
  RawRecords,
  RawState,
  RecordKind,
  StandardDocument,
  Template,
} from "./format.js";
import {
  ORPHAN,
  REG_PREFIX,
  STATE_PREFIX,
  mapReferences,
  unescapeKey,
  type RefKind,
} from "./keyspace.js";

/**
 * Restores every field that decoding must restore: defaults (data-model §7), the always-present
 * `config_entry_id` and `device_id` of a registry entry, and the `attributes` object of a state.
 * The encoder never emits those, so this is what makes `expand(encode(x))` comparable to `x`.
 */
export function restoreDefaults(records: RawRecords): RawRecords {
  const fill = <T extends JsonObject>(kind: RecordKind, record: T): T => {
    const out: JsonObject = { ...record };
    for (const [key, value] of Object.entries(defaultsFor(kind, record))) {
      if (!(key in out)) out[key] = structuredClone(value);
    }
    return out as T;
  };
  return {
    config: fill("config", records.config),
    states: records.states.map((s) => ({
      ...fill("states", s),
      attributes: s.attributes ?? {},
    })),
    entity_registry: records.entity_registry.map((e) => {
      const filled = fill("entity_registry", e);
      return {
        ...filled,
        config_entry_id: e.config_entry_id ?? null,
        device_id: e.device_id ?? null,
      };
    }),
    device_registry: records.device_registry.map((d) =>
      fill("device_registry", d),
    ),
    area_registry: records.area_registry.map((a) => fill("area_registry", a)),
    config_entries: records.config_entries.map((c) =>
      fill("config_entries", c),
    ),
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sorts every record array by its identity key, so two record sets can be compared. */
export function sortRecords(records: RawRecords): RawRecords {
  return {
    config: records.config,
    states: [...records.states].sort((a, b) =>
      compare(a.entity_id, b.entity_id),
    ),
    entity_registry: [...records.entity_registry].sort((a, b) =>
      compare(a.entity_id, b.entity_id),
    ),
    device_registry: [...records.device_registry].sort((a, b) =>
      compare(a.id, b.id),
    ),
    area_registry: [...records.area_registry].sort((a, b) =>
      compare(a.area_id, b.area_id),
    ),
    config_entries: [...records.config_entries].sort((a, b) =>
      compare(a.entry_id, b.entry_id),
    ),
  };
}

interface DecodedItem {
  head: unknown[];
  fields: JsonObject;
}

/** Decodes the rows and inline objects of one groups object into head values and flat fields. */
function decodeGroups(
  groups: Record<string, unknown[]>,
  templates: Record<string, Template>,
  headKeys: readonly string[],
): DecodedItem[] {
  const out: DecodedItem[] = [];
  for (const [key, items] of Object.entries(groups)) {
    for (const item of items) {
      if (key === "_") {
        const { ...inline } = item as JsonObject;
        const head = headKeys.map((k) => {
          const value = inline[k];
          delete inline[k];
          return value ?? null;
        });
        out.push({ head, fields: inline });
      } else {
        const template = templates[key];
        if (template === undefined)
          throw new Error(`Unknown template "${key}"`);
        const row = item as unknown[];
        const fields: JsonObject = { ...template.const };
        template.cols.forEach((col, i) => {
          fields[col] = row[headKeys.length + i];
        });
        // A row may end with an object of keys that are not part of the template's shape.
        const extras = row[headKeys.length + template.cols.length];
        if (typeof extras === "object" && extras !== null)
          Object.assign(fields, extras);
        out.push({ head: row.slice(0, headKeys.length), fields });
      }
    }
  }
  return out;
}

function unescapeFields(fields: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(fields))
    out[unescapeKey(key)] = value;
  return out;
}

/**
 * The reference decoder for `standard` and `full` documents (data-model §3). It returns the
 * records the document represents, with defaults restored and every array sorted by identity.
 */
export function expand(doc: StandardDocument): RawRecords {
  const entryIdByAlias = new Map<string, string>();
  for (const [alias, entry] of Object.entries(doc.entries)) {
    entryIdByAlias.set(alias, String(entry["id"]));
  }

  const deviceItems = decodeGroups(doc.devices, doc.templates, ["alias", "id"]);
  const deviceIdByAlias = new Map<string, string>();
  for (const item of deviceItems)
    deviceIdByAlias.set(String(item.head[0]), String(item.head[1]));

  const decode = (kind: RefKind, value: string): string => {
    if (value.startsWith(ORPHAN)) return value.slice(ORPHAN.length);
    if (kind === "device") return deviceIdByAlias.get(value) ?? value;
    if (kind === "entry") return entryIdByAlias.get(value) ?? value;
    return value;
  };

  const area_registry: RawArea[] = Object.entries(doc.areas).map(
    ([areaId, record]) => ({
      area_id: areaId,
      ...mapReferences("area_registry", record, decode),
    }),
  );

  const config_entries: RawConfigEntry[] = Object.entries(doc.entries).map(
    ([, record]) => {
      const { id, ...rest } = record;
      return { entry_id: String(id), ...unescapeFields(rest) };
    },
  );

  const device_registry: RawDevice[] = deviceItems.map((item) => ({
    id: String(item.head[1]),
    ...mapReferences("device_registry", unescapeFields(item.fields), decode),
  }));

  const states: RawState[] = [];
  const entity_registry: RawEntityRegistryEntry[] = [];
  for (const [integration, entryGroups] of Object.entries(doc.integrations)) {
    for (const [group, domains] of Object.entries(entryGroups)) {
      for (const groups of Object.values(domains)) {
        for (const item of decodeGroups(groups, doc.templates, [
          "entity_id",
          "state",
          "device",
        ])) {
          const [entityId, state, deviceColumn] = item.head as [
            string,
            string | null,
            string | null,
          ];
          const registry: JsonObject = {};
          const stateExtras: JsonObject = {};
          const attributes: JsonObject = {};
          for (const [key, value] of Object.entries(item.fields)) {
            if (key.startsWith(REG_PREFIX)) {
              const field = key.slice(REG_PREFIX.length);
              registry[field] =
                field === "area_id" && typeof value === "string"
                  ? decode("area", value)
                  : value;
            } else if (key.startsWith(STATE_PREFIX)) {
              stateExtras[key.slice(STATE_PREFIX.length)] = value;
            } else {
              attributes[unescapeKey(key)] = value;
            }
          }
          if (integration !== "_unregistered") {
            const entry: RawEntityRegistryEntry = {
              ...registry,
              entity_id: entityId,
              config_entry_id:
                group === "_yaml" ? null : decode("entry", group),
              device_id:
                deviceColumn === null ? null : decode("device", deviceColumn),
            };
            if (integration !== "_unknown") entry.platform = integration;
            entity_registry.push(entry);
          }
          if (state !== null) {
            states.push({
              ...stateExtras,
              entity_id: entityId,
              state,
              attributes,
            });
          }
        }
      }
    }
  }

  return sortRecords(
    restoreDefaults({
      config: doc.config,
      states,
      entity_registry,
      device_registry,
      area_registry,
      config_entries,
    }),
  );
}
