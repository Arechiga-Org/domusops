import { expand, restoreDefaults, sortRecords } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeStandard } from "../src/snapshot/encode-standard.js";
import { project } from "../src/snapshot/project.js";
import { REFERENCE_500 } from "./fixtures/generate.js";

describe("round trip", () => {
  it("expand(standard) equals the retrieved data with the omission list applied", () => {
    const projected = project(REFERENCE_500.records, { omit: true });
    const doc = encodeStandard(projected, REFERENCE_500.haVersion);
    const expanded = expand(doc);
    const expected = sortRecords(restoreDefaults(projected));

    expect(expanded.config).toEqual(expected.config);
    expect(expanded.area_registry).toEqual(expected.area_registry);
    expect(expanded.config_entries).toEqual(expected.config_entries);
    expect(expanded.device_registry).toEqual(expected.device_registry);
    expect(expanded.entity_registry).toEqual(expected.entity_registry);
    expect(expanded.states).toEqual(expected.states);
  });

  it("keeps every entity ID from both registries and states", () => {
    const projected = project(REFERENCE_500.records, { omit: true });
    const expanded = expand(encodeStandard(projected, REFERENCE_500.haVersion));
    const source = new Set([
      ...REFERENCE_500.records.states.map((s) => s.entity_id),
      ...REFERENCE_500.records.entity_registry.map((e) => e.entity_id),
    ]);
    const roundTripped = new Set([
      ...expanded.states.map((s) => s.entity_id),
      ...expanded.entity_registry.map((e) => e.entity_id),
    ]);
    expect(roundTripped).toEqual(source);
  });
});
