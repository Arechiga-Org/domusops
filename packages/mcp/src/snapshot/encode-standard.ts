import {
  DEFAULTS,
  FORMAT,
  ORPHAN,
  REG_PREFIX,
  STATE_PREFIX,
  defaultsFor,
  escapeKey,
  mapReferences,
  type Groups,
  type JsonObject,
  type RawRecords,
  type RefKind,
  type StandardDocument,
} from "@domusops/schema";
import { TemplateBook, type Item } from "./templates.js";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The registry defaults of an entity, in the flat key space of an entity record. */
const ENTITY_DEFAULTS: JsonObject = Object.fromEntries(
  Object.entries(DEFAULTS.entity_registry).map(([key, value]) => [
    REG_PREFIX + key,
    value,
  ]),
);

/** Implied by an entity's position in the tree, so never emitted as fields. */
const IMPLIED = new Set([
  "entity_id",
  "platform",
  "config_entry_id",
  "device_id",
]);

function escapeFields(record: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(record))
    out[escapeKey(key)] = value;
  return out;
}

/** Orders entry groups: aliases by number, then `_yaml`, then orphans, then anything else. */
function compareGroups(a: string, b: string): number {
  const rank = (key: string): [number, number] => {
    const alias = /^e(\d+)$/.exec(key);
    if (alias) return [0, Number(alias[1])];
    if (key === "_yaml") return [1, 0];
    if (key.startsWith(ORPHAN)) return [2, 0];
    return [3, 0];
  };
  const [ra, na] = rank(a);
  const [rb, nb] = rank(b);
  return ra - rb || na - nb || compare(a, b);
}

/**
 * Encodes projected records as a `standard` (or `full`) document (data-model §3). The output is
 * deterministic: aliases, templates, and object keys depend only on the content, never on the
 * order of the input.
 */
export function encodeStandard(
  projected: RawRecords,
  haVersion: string,
  detail: "standard" | "full" = "standard",
): StandardDocument {
  const { config, states, entity_registry: registry } = projected;

  const deviceIds = projected.device_registry.map((d) => d.id).sort(compare);
  const deviceAlias = new Map(deviceIds.map((id, i) => [id, `d${i + 1}`]));
  const entryIds = projected.config_entries
    .map((e) => e.entry_id)
    .sort(compare);
  const entryAlias = new Map(entryIds.map((id, i) => [id, `e${i + 1}`]));
  const areaIds = new Set(projected.area_registry.map((a) => a.area_id));
  const registryById = new Map(registry.map((r) => [r.entity_id, r]));
  const statesById = new Map(states.map((s) => [s.entity_id, s]));
  const entityIds = new Set([...registryById.keys(), ...statesById.keys()]);

  const ref = (kind: RefKind, value: string): string => {
    const known =
      kind === "device"
        ? deviceAlias.get(value)
        : kind === "entry"
          ? entryAlias.get(value)
          : (kind === "area" ? areaIds : entityIds).has(value)
            ? value
            : undefined;
    return known ?? ORPHAN + value;
  };

  const areas: Record<string, JsonObject> = {};
  for (const area of [...projected.area_registry].sort((a, b) =>
    compare(a.area_id, b.area_id),
  )) {
    const { area_id, ...rest } = area;
    areas[area_id] = mapReferences("area_registry", rest, ref);
  }

  const entries: Record<string, JsonObject> = {};
  for (const entry of [...projected.config_entries].sort((a, b) =>
    compare(a.entry_id, b.entry_id),
  )) {
    const { entry_id, ...rest } = entry;
    entries[entryAlias.get(entry_id) as string] = {
      id: entry_id,
      ...escapeFields(rest),
    };
  }

  const book = new TemplateBook();

  const deviceItems: Item[] = [...projected.device_registry]
    .sort((a, b) => compare(a.id, b.id))
    .map((device) => {
      const { id, ...rest } = device;
      return {
        head: [deviceAlias.get(id), id],
        headKeys: ["alias", "id"],
        fields: escapeFields(mapReferences("device_registry", rest, ref)),
        defaults: escapeFields(
          mapReferences(
            "device_registry",
            defaultsFor("device_registry", rest),
            ref,
          ),
        ),
      };
    });
  const devices: Groups = book.group(deviceItems);

  const tree = new Map<string, Map<string, Map<string, Item[]>>>();
  for (const entityId of [...entityIds].sort(compare)) {
    const reg = registryById.get(entityId);
    const st = statesById.get(entityId);

    const fields: JsonObject = {};
    if (st !== undefined) {
      for (const [key, value] of Object.entries(st.attributes ?? {}))
        fields[escapeKey(key)] = value;
      for (const [key, value] of Object.entries(st)) {
        if (key === "entity_id" || key === "state" || key === "attributes")
          continue;
        fields[STATE_PREFIX + key] = value;
      }
    }
    if (reg !== undefined) {
      for (const [key, value] of Object.entries(reg)) {
        if (IMPLIED.has(key)) continue;
        fields[REG_PREFIX + key] =
          key === "area_id" && typeof value === "string"
            ? ref("area", value)
            : value;
      }
    }

    const integration =
      reg === undefined ? "_unregistered" : (reg.platform ?? "_unknown");
    const group =
      reg === undefined
        ? "_none"
        : typeof reg.config_entry_id === "string"
          ? ref("entry", reg.config_entry_id)
          : "_yaml";
    const domainEnd = entityId.indexOf(".");
    const domain = domainEnd < 0 ? "_nodomain" : entityId.slice(0, domainEnd);
    const stateColumn =
      st === undefined ? null : typeof st.state === "string" ? st.state : "";
    const deviceColumn =
      reg !== undefined && typeof reg.device_id === "string"
        ? ref("device", reg.device_id)
        : null;

    const byGroup =
      tree.get(integration) ?? new Map<string, Map<string, Item[]>>();
    tree.set(integration, byGroup);
    const byDomain = byGroup.get(group) ?? new Map<string, Item[]>();
    byGroup.set(group, byDomain);
    const items = byDomain.get(domain) ?? [];
    byDomain.set(domain, items);
    items.push({
      head: [entityId, stateColumn, deviceColumn],
      headKeys: ["entity_id", "state", "device"],
      fields,
      defaults: reg === undefined ? {} : ENTITY_DEFAULTS,
    });
  }

  const integrations: StandardDocument["integrations"] = {};
  for (const integration of [...tree.keys()].sort(compare)) {
    const byGroup = tree.get(integration) as Map<string, Map<string, Item[]>>;
    const groupsOut: Record<string, Record<string, Groups>> = {};
    for (const group of [...byGroup.keys()].sort(compareGroups)) {
      const byDomain = byGroup.get(group) as Map<string, Item[]>;
      const domainsOut: Record<string, Groups> = {};
      for (const domain of [...byDomain.keys()].sort(compare)) {
        domainsOut[domain] = book.group(byDomain.get(domain) as Item[]);
      }
      groupsOut[group] = domainsOut;
    }
    integrations[integration] = groupsOut;
  }

  return {
    format: FORMAT,
    detail,
    ha_version: haVersion,
    compression_ratio: 0,
    config,
    areas,
    entries,
    templates: book.defs,
    devices,
    integrations,
  };
}
