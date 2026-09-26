import type { RawRecords, SummaryDocument } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeSummary } from "../src/snapshot/encode-summary.js";
import { project } from "../src/snapshot/project.js";
import { EMPTY, REFERENCE_500 } from "./fixtures/generate.js";

const summarize = (records: RawRecords): SummaryDocument =>
  encodeSummary(project(records, { omit: true }), "2026.9.1");

describe("encodeSummary on the 500-entity reference fixture", () => {
  const records = REFERENCE_500.records;
  const doc = summarize(records);
  const entityIds = new Set([
    ...records.states.map((s) => s.entity_id),
    ...records.entity_registry.map((e) => e.entity_id),
  ]);

  it("has the envelope and the counts of the generator", () => {
    expect(doc.detail).toBe("summary");
    expect(doc.ha_version).toBe("2026.9.1");
    const registered = new Set(records.entity_registry.map((e) => e.entity_id));
    expect(doc.counts.entities).toBe(entityIds.size);
    expect(doc.counts.devices).toBe(records.device_registry.length);
    expect(doc.counts.areas).toBe(records.area_registry.length);
    expect(doc.counts.entries).toBe(records.config_entries.length);
    expect(doc.counts.unregistered_entities).toBe(
      records.states.filter((s) => !registered.has(s.entity_id)).length,
    );
    expect(doc.counts.disabled_entities).toBe(
      records.entity_registry.filter((e) => e.disabled_by != null).length,
    );
    expect(doc.counts.integrations).toBe(
      Object.keys(doc.by_integration).length,
    );
  });

  it("counts by domain and by integration consistently", () => {
    expect(Object.values(doc.by_domain).reduce((a, b) => a + b, 0)).toBe(
      entityIds.size,
    );
    const registeredEntities = Object.values(doc.by_integration).reduce(
      (n, i) => n + i.entities,
      0,
    );
    expect(registeredEntities + doc.counts.unregistered_entities).toBe(
      entityIds.size,
    );
    for (const integration of Object.values(doc.by_integration)) {
      expect(
        Object.values(integration.domains).reduce((a, b) => a + b, 0),
      ).toBe(integration.entities);
    }
    // Integrations that only have config entries still appear.
    expect(doc.by_integration["sun"]).toEqual({
      entities: 0,
      devices: 0,
      entries: 1,
      domains: {},
    });
    expect(doc.by_integration["esphome"]?.entries).toBe(2);
  });

  it("counts entities and devices by effective area, and the rest as unassigned", () => {
    const areaEntities = Object.values(doc.areas).reduce(
      (n, a) => n + a.entities,
      0,
    );
    const areaDevices = Object.values(doc.areas).reduce(
      (n, a) => n + a.devices,
      0,
    );
    expect(areaEntities + doc.unassigned.entities).toBe(entityIds.size);
    expect(areaDevices + doc.unassigned.devices).toBe(
      records.device_registry.length,
    );
    expect(doc.areas["kitchen"]?.name).toBe("Kitchen");
    expect(Object.keys(doc.areas)).toHaveLength(records.area_registry.length);
    // The fixture plants an orphan area on a device, which counts as unassigned.
    expect(doc.unassigned.devices).toBeGreaterThan(0);
  });

  it("never lists an individual entity (FR-010)", () => {
    const text = JSON.stringify(doc);
    for (const id of entityIds) expect(text).not.toContain(`"${id}"`);
  });

  it("is deterministic and keeps the config the same as standard", () => {
    expect(JSON.stringify(summarize(records))).toBe(JSON.stringify(doc));
    expect(doc.config["location_name"]).toBe("Home");
    expect(doc.config).not.toHaveProperty("components");
  });
});

describe("encodeSummary on an empty instance", () => {
  it("reports every count as 0", () => {
    const doc = summarize(EMPTY.records);
    expect(doc.counts).toEqual({
      entities: 0,
      devices: 0,
      areas: 0,
      integrations: 0,
      entries: 0,
      unregistered_entities: 0,
      disabled_entities: 0,
    });
    expect(doc.by_domain).toEqual({});
    expect(doc.by_integration).toEqual({});
    expect(doc.areas).toEqual({});
    expect(doc.unassigned).toEqual({ devices: 0, entities: 0 });
  });
});
