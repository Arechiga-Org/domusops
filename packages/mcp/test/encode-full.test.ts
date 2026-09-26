import { expand, restoreDefaults, sortRecords } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeFull } from "../src/snapshot/encode-full.js";
import { encodeStandard } from "../src/snapshot/encode-standard.js";
import { project } from "../src/snapshot/project.js";
import { redact } from "../src/snapshot/redact.js";
import { finalize, measureRawBytes } from "../src/snapshot/ratio.js";
import { REFERENCE_500 } from "./fixtures/generate.js";

const records = REFERENCE_500.records;
const redacted = redact(records, "unused-token-value");
const doc = encodeFull(project(redacted, { omit: false }), "2026.9.1");

describe("encodeFull on the 500-entity reference fixture", () => {
  it("uses the standard structure with detail=full", () => {
    expect(doc.detail).toBe("full");
    const standard = encodeStandard(
      project(redacted, { omit: true }),
      "2026.9.1",
    );
    expect(Object.keys(doc).sort()).toEqual(Object.keys(standard).sort());
  });

  it("expands to exactly the redacted retrieved data (data-model §10.3)", () => {
    const expanded = expand(doc);
    const expected = sortRecords(restoreDefaults(redacted));
    expect(expanded.config).toEqual(expected.config);
    expect(expanded.states).toEqual(expected.states);
    expect(expanded.entity_registry).toEqual(expected.entity_registry);
    expect(expanded.device_registry).toEqual(expected.device_registry);
    expect(expanded.area_registry).toEqual(expected.area_registry);
    expect(expanded.config_entries).toEqual(expected.config_entries);
  });

  it("keeps every field that standard omits", () => {
    const expanded = expand(doc);
    const entity = expanded.entity_registry[0] as Record<string, unknown>;
    for (const key of ["id", "unique_id", "created_at", "modified_at"])
      expect(entity).toHaveProperty(key);
    const state = expanded.states[0] as Record<string, unknown>;
    for (const key of [
      "last_changed",
      "last_updated",
      "last_reported",
      "context",
    ]) {
      expect(state).toHaveProperty(key);
    }
    expect(expanded.device_registry[0]).toHaveProperty("connections");
    expect(expanded.config).toHaveProperty("components");
    expect(expanded.config).toHaveProperty("config_dir");
  });

  it("is never a raw passthrough: it is smaller than the raw payload", () => {
    const text = finalize(doc, measureRawBytes(records));
    expect(JSON.parse(text).compression_ratio).toBeGreaterThan(1);
  });
});
