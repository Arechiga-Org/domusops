import {
  FORMAT,
  type RawRecords,
  type SummaryDocument,
} from "@domusops/schema";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortedObject<T>(entries: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of [...entries.keys()].sort(compare))
    out[key] = entries.get(key) as T;
  return out;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Counts and topology only (data-model §4): no entity is listed. An entity's effective area is its
 * own area when set, otherwise its device's area; an area that is not in the snapshot counts as no
 * area.
 */
export function encodeSummary(
  projected: RawRecords,
  haVersion: string,
): SummaryDocument {
  const registry = new Map(
    projected.entity_registry.map((e) => [e.entity_id, e]),
  );
  const entityIds = new Set([
    ...registry.keys(),
    ...projected.states.map((s) => s.entity_id),
  ]);
  const devicesById = new Map(projected.device_registry.map((d) => [d.id, d]));
  const areaIds = new Set(projected.area_registry.map((a) => a.area_id));
  const entryDomain = new Map(
    projected.config_entries.map((e) => [e.entry_id, e.domain ?? ""]),
  );

  const byDomain = new Map<string, number>();
  const integrations = new Map<
    string,
    {
      entities: number;
      devices: number;
      entries: number;
      domains: Map<string, number>;
    }
  >();
  const integration = (name: string) => {
    let entry = integrations.get(name);
    if (entry === undefined) {
      entry = { entities: 0, devices: 0, entries: 0, domains: new Map() };
      integrations.set(name, entry);
    }
    return entry;
  };

  const areaEntities = new Map<string, number>();
  const areaDevices = new Map<string, number>();
  let unassignedEntities = 0;
  let unregistered = 0;
  let disabled = 0;

  for (const entityId of entityIds) {
    const domain = entityId.includes(".")
      ? entityId.slice(0, entityId.indexOf("."))
      : "_nodomain";
    bump(byDomain, domain);
    const reg = registry.get(entityId);
    if (reg === undefined) {
      unregistered++;
      unassignedEntities++;
      continue;
    }
    const entry = integration(reg.platform ?? "_unknown");
    entry.entities++;
    bump(entry.domains, domain);
    if (reg.disabled_by != null) disabled++;
    const own = typeof reg.area_id === "string" ? reg.area_id : null;
    const device =
      typeof reg.device_id === "string"
        ? devicesById.get(reg.device_id)
        : undefined;
    const viaDevice =
      typeof device?.["area_id"] === "string"
        ? (device["area_id"] as string)
        : null;
    const effective = own ?? viaDevice;
    if (effective !== null && areaIds.has(effective))
      bump(areaEntities, effective);
    else unassignedEntities++;
  }

  for (const entry of projected.config_entries)
    integration(entry.domain ?? "_unknown").entries++;

  let unassignedDevices = 0;
  for (const device of projected.device_registry) {
    const area =
      typeof device["area_id"] === "string"
        ? (device["area_id"] as string)
        : null;
    if (area !== null && areaIds.has(area)) bump(areaDevices, area);
    else unassignedDevices++;
    const domains = new Set<string>();
    const entryIds = Array.isArray(device["config_entries"])
      ? (device["config_entries"] as unknown[])
      : [];
    for (const entryId of entryIds) {
      const domain =
        typeof entryId === "string" ? entryDomain.get(entryId) : undefined;
      if (domain !== undefined) domains.add(domain);
    }
    for (const domain of domains) integration(domain).devices++;
  }

  const areas = new Map<
    string,
    { name: string | null; devices: number; entities: number }
  >();
  for (const area of projected.area_registry) {
    areas.set(area.area_id, {
      name: typeof area["name"] === "string" ? (area["name"] as string) : null,
      devices: areaDevices.get(area.area_id) ?? 0,
      entities: areaEntities.get(area.area_id) ?? 0,
    });
  }

  const byIntegration = new Map(
    [...integrations].map(([name, value]) => [
      name,
      {
        entities: value.entities,
        devices: value.devices,
        entries: value.entries,
        domains: sortedObject(value.domains),
      },
    ]),
  );

  return {
    format: FORMAT,
    detail: "summary",
    ha_version: haVersion,
    compression_ratio: 0,
    config: projected.config,
    counts: {
      entities: entityIds.size,
      devices: projected.device_registry.length,
      areas: projected.area_registry.length,
      integrations: integrations.size,
      entries: projected.config_entries.length,
      unregistered_entities: unregistered,
      disabled_entities: disabled,
    },
    by_domain: sortedObject(byDomain),
    by_integration: sortedObject(byIntegration),
    areas: sortedObject(areas),
    unassigned: { devices: unassignedDevices, entities: unassignedEntities },
  };
}
