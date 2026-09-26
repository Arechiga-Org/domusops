import {
  DEFAULTS,
  OMITTED_FIELDS,
  deepEqual,
  type Groups,
  type RawRecords,
  type StandardDocument,
  type Template,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeStandard } from "../src/snapshot/encode-standard.js";
import { project } from "../src/snapshot/project.js";
import { measureRawBytes } from "../src/snapshot/ratio.js";
import { REFERENCE_500 } from "./fixtures/generate.js";

const records = REFERENCE_500.records;
const build = (r: RawRecords): StandardDocument =>
  encodeStandard(project(r, { omit: true }), REFERENCE_500.haVersion);
const doc = build(records);

/** Every entity record in a groups object, as [entity_id, flat fields]. */
function eachEntity(
  groups: Groups,
  templates: Record<string, Template>,
  cb: (entityId: string, fields: Record<string, unknown>) => void,
): void {
  for (const [key, items] of Object.entries(groups)) {
    for (const item of items) {
      if (key === "_") {
        const { entity_id, ...rest } = item as Record<string, unknown>;
        delete rest["state"];
        delete rest["device"];
        cb(String(entity_id), rest);
      } else {
        const template = templates[key] as Template;
        const row = item as unknown[];
        const fields: Record<string, unknown> = { ...template.const };
        template.cols.forEach((col, i) => {
          fields[col] = row[3 + i];
        });
        cb(String(row[0]), fields);
      }
    }
  }
}

describe("encodeStandard on the 500-entity reference fixture", () => {
  const entityRows: {
    id: string;
    domain: string;
    fields: Record<string, unknown>;
  }[] = [];
  for (const groups of Object.values(doc.integrations)) {
    for (const domains of Object.values(groups)) {
      for (const [domain, g] of Object.entries(domains)) {
        eachEntity(g, doc.templates, (id, fields) =>
          entityRows.push({ id, domain, fields }),
        );
      }
    }
  }

  it("models an installation of realistic raw size per entity", () => {
    const ids = new Set([
      ...records.states.map((s) => s.entity_id),
      ...records.entity_registry.map((e) => e.entity_id),
    ]);
    const perEntity = measureRawBytes(records) / ids.size;
    expect(perEntity).toBeGreaterThanOrEqual(900);
    expect(perEntity).toBeLessThanOrEqual(1600);
  });

  it("emits every entity ID exactly once", () => {
    const expected = new Set([
      ...records.states.map((s) => s.entity_id),
      ...records.entity_registry.map((e) => e.entity_id),
    ]);
    const emitted = entityRows.map((r) => r.id);
    expect(emitted.length).toBe(expected.size);
    expect(new Set(emitted)).toEqual(expected);
  });

  it("groups as integration -> entry group -> domain -> template key", () => {
    expect(Object.keys(doc.integrations)).toContain("zha");
    expect(Object.keys(doc.integrations)).toContain("_unregistered");
    for (const row of entityRows)
      expect(row.id.startsWith(`${row.domain}.`)).toBe(true);
    const unregistered = doc.integrations["_unregistered"] ?? {};
    expect(Object.keys(unregistered)).toEqual(["_none"]);
  });

  it("defines every alias it uses and uses every alias it defines", () => {
    const text = JSON.stringify({
      ...doc,
      entries: undefined,
      templates: undefined,
    });
    const usedTemplates = new Set<string>();
    for (const groups of [
      doc.devices,
      ...Object.values(doc.integrations).flatMap((g) =>
        Object.values(g).flatMap((d) => Object.values(d)),
      ),
    ]) {
      for (const key of Object.keys(groups))
        if (key !== "_") usedTemplates.add(key);
    }
    expect(new Set(Object.keys(doc.templates))).toEqual(usedTemplates);

    const definedDevices = new Set<string>();
    for (const [key, items] of Object.entries(doc.devices)) {
      for (const item of items) {
        definedDevices.add(
          key === "_"
            ? String((item as { alias: string }).alias)
            : String((item as unknown[])[0]),
        );
      }
    }
    const deviceRefs = new Set(
      text.match(/"d\d+"/g)?.map((m) => m.slice(1, -1)) ?? [],
    );
    // Every device alias that appears is defined (aliases match ^d\d+$, orphans carry "!").
    for (const alias of deviceRefs)
      expect(definedDevices.has(alias)).toBe(true);
    for (const alias of definedDevices)
      expect(deviceRefs.has(alias)).toBe(true);

    const definedEntries = new Set(Object.keys(doc.entries));
    for (const groups of Object.values(doc.integrations)) {
      for (const group of Object.keys(groups)) {
        if (/^e\d+$/.test(group)) expect(definedEntries.has(group)).toBe(true);
      }
    }
  });

  it("is byte-identical for identical input, whatever the input order", () => {
    const again = JSON.stringify(build(records));
    expect(again).toBe(JSON.stringify(doc));
    const reversed: RawRecords = {
      ...records,
      states: [...records.states].reverse(),
      entity_registry: [...records.entity_registry].reverse(),
      device_registry: [...records.device_registry].reverse(),
      area_registry: [...records.area_registry].reverse(),
      config_entries: [...records.config_entries].reverse(),
    };
    expect(JSON.stringify(build(reversed))).toBe(JSON.stringify(doc));
  });

  it("emits no omitted field, and no constant or inline field that equals its default", () => {
    const omitted = new Set([
      ...OMITTED_FIELDS.entity_registry.map((k) => `reg.${k}`),
      ...OMITTED_FIELDS.states.map((k) => `st.${k}`),
    ]);
    const notDefault = (key: string, value: unknown): void => {
      const name = key.slice("reg.".length);
      if (key.startsWith("reg.") && name in DEFAULTS.entity_registry) {
        expect(deepEqual(value, DEFAULTS.entity_registry[name])).toBe(false);
      }
    };
    for (const row of entityRows) {
      for (const key of Object.keys(row.fields))
        expect(omitted.has(key)).toBe(false);
    }
    // A column may hold an explicit default for the rows that omit the field; a constant or an
    // inline field never does, because absence already means the default (FR-007).
    for (const template of Object.values(doc.templates)) {
      for (const [key, value] of Object.entries(template.const))
        notDefault(key, value);
    }
    for (const groups of Object.values(doc.integrations)) {
      for (const domains of Object.values(groups)) {
        for (const g of Object.values(domains)) {
          for (const item of (g["_"] ?? []) as Record<string, unknown>[]) {
            for (const [key, value] of Object.entries(item))
              notDefault(key, value);
          }
        }
      }
    }
    for (const forbidden of OMITTED_FIELDS.config)
      expect(doc.config).not.toHaveProperty(forbidden);
    for (const entry of Object.values(doc.entries)) {
      expect(entry).not.toHaveProperty("created_at");
      expect(entry).not.toHaveProperty("modified_at");
    }
  });

  it("preserves non-ASCII names byte for byte", () => {
    const text = JSON.stringify(doc);
    for (const name of ["Küche", "客厅", "Garden 🌳", "Sótano"]) {
      expect(text).toContain(name);
    }
  });

  it("factors the shared structure: far fewer templates than entities", () => {
    expect(Object.keys(doc.templates).length).toBeLessThan(
      entityRows.length / 4,
    );
  });
});
