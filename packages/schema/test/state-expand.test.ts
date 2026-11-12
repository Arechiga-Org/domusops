import { describe, expect, it } from "vitest";
import {
  encodeContextId,
  expandState,
  type StateStandardDocument,
  type StateSummaryDocument,
} from "../src/index.js";

/** The `domusops.state/0.1` decoder (specs/010-ha-state data-model §6, research R11). */

const ANCHOR = "2026-09-28T21:04:10+02:00";
const ANCHOR_MS = Date.parse(ANCHOR);
const CONTEXT = "01JAF5Q2W8E4R6T1Y3V7M9N0PQ";
const PARENT = "01JAF5Q2W8E4R6T1Y3V7M9N0PR";

const envelope = {
  format: "domusops.state/0.1",
  detail: "standard",
  ha_version: "2026.10.0",
  compression_ratio: 1,
  time_zone: "Europe/Amsterdam",
  utc_offset: "+02:00",
  anchor: ANCHOR,
} as const;

function document(
  templates: StateStandardDocument["templates"],
  entities: StateStandardDocument["entities"],
): StateStandardDocument {
  return { ...envelope, templates, entities };
}

describe("expandState", () => {
  it("decodes positional rows with template constants and defaults", () => {
    const records = expandState(
      document(
        {
          t1: {
            const: { friendly_name: "Lamp", supported_features: 40 },
            cols: ["brightness", "st.context", "st.last_changed"],
          },
        },
        {
          light: {
            t1: [
              [
                "porch",
                "on",
                90,
                encodeContextId(CONTEXT, ANCHOR_MS),
                "2026-09-28T19:04:10",
              ],
            ],
          },
        },
      ),
    );
    expect(records).toEqual([
      {
        entity_id: "light.porch",
        state: "on",
        attributes: {
          brightness: 90,
          friendly_name: "Lamp",
          supported_features: 40,
        },
        last_changed: "2026-09-28T19:04:10+02:00",
        last_updated: "2026-09-28T19:04:10+02:00",
        last_reported: "2026-09-28T19:04:10+02:00",
        context: { id: CONTEXT, parent_id: null, user_id: null },
      },
    ]);
  });

  it("decodes inline records and unescapes attribute keys", () => {
    const [record] = expandState(
      document(
        {},
        {
          sensor: {
            _: [
              {
                id: "probe",
                state: "21.5",
                "~id": "attr-id",
                "~state": "attr-state",
                "~st.x": 1,
                "~~tilde": 2,
                "st.context": encodeContextId(CONTEXT, ANCHOR_MS),
                "st.last_changed": "2026-09-27T21:04:10",
                "st.last_updated": "2026-09-27T21:04:12",
                "st.last_reported": "2026-09-28T21:04:10",
                "st.parent_id": encodeContextId(PARENT, ANCHOR_MS),
                "st.user_id": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
              },
            ],
          },
        },
      ),
    );
    expect(record).toEqual({
      entity_id: "sensor.probe",
      state: "21.5",
      attributes: {
        id: "attr-id",
        state: "attr-state",
        "st.x": 1,
        "~tilde": 2,
      },
      last_changed: "2026-09-27T21:04:10+02:00",
      last_updated: "2026-09-27T21:04:12+02:00",
      last_reported: "2026-09-28T21:04:10+02:00",
      context: {
        id: CONTEXT,
        parent_id: PARENT,
        user_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      },
    });
  });

  it("restores last_reported from last_updated when it is left out", () => {
    const [record] = expandState(
      document(
        {},
        {
          sensor: {
            _: [
              {
                id: "probe",
                state: "1",
                "st.context": "plain-id",
                "st.last_changed": "2026-09-27T21:04:10",
                "st.last_updated": "2026-09-28T01:00:00",
              },
            ],
          },
        },
      ),
    );
    expect(record?.last_reported).toBe("2026-09-28T01:00:00+02:00");
    expect(record?.context.id).toBe("plain-id");
  });

  it("keeps a time's own offset and unwraps an escaped context ID", () => {
    const [record] = expandState(
      document(
        {},
        {
          sun: {
            _: [
              {
                id: "sun",
                state: "above_horizon",
                "st.context": { v: "-5:ABCDEFGHJKMNPQRS" },
                "st.last_changed": "2026-03-01T08:00:00+01:00",
              },
            ],
          },
        },
      ),
    );
    expect(record?.last_changed).toBe("2026-03-01T08:00:00+01:00");
    expect(record?.last_updated).toBe("2026-03-01T08:00:00+01:00");
    expect(record?.context.id).toBe("-5:ABCDEFGHJKMNPQRS");
  });

  it("returns records in entity-ID order across domains and groups", () => {
    const row = (id: string): unknown[] => [id, "on", "2026-09-28T21:00:00"];
    const inline = (id: string): Record<string, unknown> => ({
      id,
      state: "off",
      "st.context": "c",
      "st.last_changed": "2026-09-28T21:00:00",
    });
    const records = expandState(
      document(
        { t1: { const: { "st.context": "c" }, cols: ["st.last_changed"] } },
        {
          switch: { t1: [row("b"), row("d")], _: [inline("a")] },
          light: { t1: [row("z")], _: [inline("c")] },
        },
      ),
    );
    expect(records.map((r) => r.entity_id)).toEqual([
      "light.c",
      "light.z",
      "switch.a",
      "switch.b",
      "switch.d",
    ]);
  });

  it("refuses a summary document", () => {
    const summary: StateSummaryDocument = {
      ...envelope,
      detail: "summary",
      counts: { entities: 0, domains: 0 },
      by_domain: {},
    };
    expect(() =>
      expandState(summary as unknown as StateStandardDocument),
    ).toThrow(/detail=standard/);
  });
});
