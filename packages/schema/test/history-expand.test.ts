import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  expandHistory,
  type HistoryEntityEntry,
  type HistoryStandardDocument,
  type HistorySummaryDocument,
} from "../src/index.js";

/** The `domusops.history/0.1` decoder (specs/011-ha-history data-model §6, research R13). */

const envelope = {
  format: "domusops.history/0.1",
  detail: "standard",
  ha_version: "2026.10.0",
  compression_ratio: 1,
  time_zone: "Europe/Amsterdam",
  utc_offset: "+02:00",
  window: {
    start: "2026-09-28T08:00:00+02:00",
    end: "2026-09-28T10:00:00+02:00",
  },
} as const;

function document(
  entities: Record<string, HistoryEntityEntry>,
): HistoryStandardDocument {
  return { ...envelope, entities };
}

describe("expandHistory", () => {
  it("decodes a start state and changes, carrying the state and attributes forward", () => {
    const [phone] = expandHistory(
      document({
        "device_tracker.phone": {
          start: ["home", { battery: 81, accuracy: 12 }, "2026-09-27T22:41:07"],
          changes: {
            "2026-09-28": {
              "08:00": [
                ["14:02", null, { battery: 80 }],
                ["31:40", "not_home", { accuracy: 20 }, ["battery"]],
              ],
              "09:00": [["05:11"]],
            },
          },
        },
      }),
    );
    expect(phone).toEqual({
      entity_id: "device_tracker.phone",
      entries: [
        {
          start: true,
          state: "home",
          attributes: { battery: 81, accuracy: 12 },
          last_updated: "2026-09-28T08:00:00+02:00",
          last_changed: "2026-09-27T22:41:07+02:00",
        },
        {
          start: false,
          state: "home",
          attributes: { battery: 80, accuracy: 12 },
          last_updated: "2026-09-28T08:14:02+02:00",
          last_changed: "2026-09-27T22:41:07+02:00",
        },
        {
          start: false,
          state: "not_home",
          attributes: { accuracy: 20 },
          last_updated: "2026-09-28T08:31:40+02:00",
          last_changed: "2026-09-28T08:31:40+02:00",
        },
        {
          start: false,
          state: "not_home",
          attributes: { accuracy: 20 },
          last_updated: "2026-09-28T09:05:11+02:00",
          last_changed: "2026-09-28T08:31:40+02:00",
        },
      ],
    });
  });

  it("gives last_changed null until a state change when the start has no since", () => {
    const [sensor] = expandHistory(
      document({
        "sensor.attic": {
          start: ["19.4", { unit: "°C" }],
          changes: {
            "2026-09-28": { "08:00": [["00:41", null, { unit: "C" }]] },
          },
        },
      }),
    );
    expect(sensor?.entries.map((entry) => entry.last_changed)).toEqual([
      null,
      null,
    ]);
  });

  it("decodes the first change of an entity without a start as a full entry", () => {
    const [created] = expandHistory(
      document({
        "switch.new": {
          changes: {
            "2026-09-28": {
              "08:00": [
                ["10:00", "off", { friendly_name: "New" }],
                ["10:00", "on"],
              ],
            },
          },
        },
      }),
    );
    expect(created?.entries).toEqual([
      {
        start: false,
        state: "off",
        attributes: { friendly_name: "New" },
        last_updated: "2026-09-28T08:10:00+02:00",
        last_changed: "2026-09-28T08:10:00+02:00",
      },
      {
        start: false,
        state: "on",
        attributes: { friendly_name: "New" },
        last_updated: "2026-09-28T08:10:00+02:00",
        last_changed: "2026-09-28T08:10:00+02:00",
      },
    ]);
  });

  it("never mutates the attributes of an earlier entry", () => {
    const [light] = expandHistory(
      document({
        "light.porch": {
          start: ["on", { brightness: 10, nested: { a: 1 } }],
          changes: {
            "2026-09-28": {
              "08:00": [
                ["01:00", null, { brightness: 20 }],
                ["02:00", null, null, ["nested"]],
              ],
            },
          },
        },
      }),
    );
    expect(light?.entries.map((entry) => entry.attributes)).toEqual([
      { brightness: 10, nested: { a: 1 } },
      { brightness: 20, nested: { a: 1 } },
      { brightness: 20 },
    ]);
  });

  it("keeps an attribute named __proto__", () => {
    const [odd] = expandHistory(
      document({
        "sensor.odd": {
          start: [
            "1",
            JSON.parse('{"__proto__": 1}') as Record<string, number>,
          ],
          changes: {
            "2026-09-28": {
              "08:00": [["01:00", null, JSON.parse('{"__proto__": 2}')]],
            },
          },
        },
      }),
    );
    expect(
      odd?.entries.map(
        (entry) =>
          Object.getOwnPropertyDescriptor(entry.attributes, "__proto__")?.value,
      ),
    ).toEqual([1, 2]);
  });

  it("uses an hour key's own offset across a daylight-saving change", () => {
    const [sensor] = expandHistory({
      ...document({
        "sensor.attic": {
          start: ["1", {}],
          changes: {
            "2026-10-25": {
              "02:00": [["30:00", "2"]],
              "02:00+01:00": [["30:00", "3"]],
            },
          },
        },
      }),
      window: {
        start: "2026-10-25T00:00:00+02:00",
        end: "2026-10-25T04:00:00+01:00",
      },
    });
    expect(sensor?.entries.map((entry) => entry.last_updated)).toEqual([
      "2026-10-25T00:00:00+02:00",
      "2026-10-25T02:30:00+02:00",
      "2026-10-25T02:30:00+01:00",
    ]);
  });

  it("returns entities in entity-ID order", () => {
    const records = expandHistory(
      document({
        "switch.b": { start: ["on", {}] },
        "light.a": { start: ["off", {}] },
        "sensor.c": { start: ["1", {}] },
      }),
    );
    expect(records.map((record) => record.entity_id)).toEqual([
      "light.a",
      "sensor.c",
      "switch.b",
    ]);
  });

  it("decodes the standard example of the contract as its text states", () => {
    const [example] = [
      ...readFileSync(
        new URL(
          "../../../specs/011-ha-history/contracts/history-format.md",
          import.meta.url,
        ),
        "utf8",
      ).matchAll(/```json\n([\s\S]*?)```/g),
    ].map((match) => JSON.parse(match[1] as string) as HistoryStandardDocument);
    const phone = expandHistory(example as HistoryStandardDocument).find(
      (record) => record.entity_id === "device_tracker.phone_alpha",
    );
    const [, first, second] = phone?.entries ?? [];
    expect(first?.state).toBe("home");
    expect(first?.last_changed).toBe("2026-09-27T22:41:07+02:00");
    expect(second).toMatchObject({
      state: "not_home",
      last_updated: "2026-09-28T08:31:40+02:00",
      last_changed: "2026-09-28T08:31:40+02:00",
      attributes: { battery_level: 80, gps_accuracy: 20 },
    });
  });

  it("refuses a summary document", () => {
    const summary: HistorySummaryDocument = {
      ...envelope,
      detail: "summary",
      counts: { entities: 0, changes: 0, state_changes: 0, attribute_only: 0 },
      by_domain: {},
    };
    expect(() =>
      expandHistory(summary as unknown as HistoryStandardDocument),
    ).toThrow(/detail=standard/);
  });
});
