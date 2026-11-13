import type { HistoryStandardDocument, JsonObject } from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { encodeStandardHistory } from "../src/history/encode-standard.js";
import { keepAttributes, type EntityHistory } from "../src/history/entries.js";
import { historyFrame } from "../src/history/envelope.js";
import { queryHistory } from "../src/tools/ha-history.js";
import { REFERENCE_HISTORY } from "./fixtures/generate-history.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";

/** The standard history encoding (specs/011-ha-history data-model §2 and §3, research R6, R7). */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const ZONE = "Europe/Madrid";
/** 2026-09-28T08:00:00+02:00 */
const START_MS = Date.UTC(2026, 8, 28, 6, 0, 0);
const at = (seconds: number): number => START_MS + seconds * 1000 + 123;

function encode(
  histories: EntityHistory[],
  window = { startMs: START_MS, endMs: START_MS + 7_200_000 },
  extra: { selectors?: string[]; significantOnly?: boolean } = {},
): HistoryStandardDocument {
  const frame = historyFrame({
    detail: "standard",
    haVersion: "2026.10.0",
    timeZone: ZONE,
    window: {
      ...window,
      startIso: new Date(window.startMs).toISOString(),
      endIso: new Date(window.endMs).toISOString(),
    },
    significantOnly: extra.significantOnly ?? false,
    ...(extra.selectors === undefined ? {} : { selectors: extra.selectors }),
  });
  return encodeStandardHistory(frame, histories) as HistoryStandardDocument;
}

/** A change; it changed the state, as the instance records it, when `stateChanged` says so. */
const change = (
  seconds: number,
  state: string,
  attributes: JsonObject,
  stateChanged = false,
): EntityHistory["changes"][number] => ({
  at: at(seconds),
  state,
  attributes,
  stateChanged,
});

describe("the standard history document", () => {
  it("has the envelope's keys in order", () => {
    const document = encode([], undefined, {
      selectors: ["light.*"],
      significantOnly: true,
    });
    expect(Object.keys(document)).toEqual([
      "format",
      "detail",
      "ha_version",
      "compression_ratio",
      "time_zone",
      "utc_offset",
      "window",
      "selectors",
      "significant_only",
      "entities",
    ]);
    expect(document).toMatchObject({
      format: "domusops.history/0.1",
      detail: "standard",
      time_zone: ZONE,
      utc_offset: "+02:00",
      window: {
        start: "2026-09-28T08:00:00+02:00",
        end: "2026-09-28T10:00:00+02:00",
      },
    });
    expect(encode([])).not.toHaveProperty("significant_only");
  });

  it("encodes a start with since, and deltas against the previous entry", () => {
    const document = encode([
      {
        entityId: "light.porch",
        start: {
          state: "on",
          attributes: { brightness: 10, rgb: [1, 2, 3], name: "Porch" },
          since: START_MS - 3_600_000,
        },
        changes: [
          change(61, "on", { brightness: 20, rgb: [1, 2, 3], name: "Porch" }),
          change(122, "off", { brightness: 20, name: "Porch" }),
          change(3_725, "off", { brightness: 20, name: "Porch", mode: "x" }),
          change(3_726, "off", { brightness: 20, name: "Porch", mode: "x" }),
        ],
        skipped: 0,
      },
    ]);
    expect(document.entities).toEqual({
      "light.porch": {
        start: [
          "on",
          { brightness: 10, rgb: [1, 2, 3], name: "Porch" },
          "2026-09-28T07:00:00",
        ],
        changes: {
          "2026-09-28": {
            "08:00": [
              ["01:01", null, { brightness: 20 }],
              ["02:02", "off", null, ["rgb"]],
            ],
            "09:00": [["02:05", null, { mode: "x" }], ["02:06"]],
          },
        },
      },
    });
  });

  it("compares nested values by content, and removes in name order", () => {
    const document = encode([
      {
        entityId: "sensor.x",
        start: {
          state: "1",
          attributes: { z: 1, a: 1, nested: { b: 1, a: [1] } },
        },
        changes: [
          change(1, "1", { nested: { a: [1], b: 1 } }),
          change(2, "1", { nested: { a: [2], b: 1 } }),
        ],
        skipped: 0,
      },
    ]);
    expect(document.entities["sensor.x"]?.changes?.["2026-09-28"]).toEqual({
      "08:00": [
        ["00:01", null, null, ["a", "z"]],
        ["00:02", null, { nested: { a: [2], b: 1 } }],
      ],
    });
  });

  it("gives the first change of an entity without a start its state and every attribute", () => {
    const document = encode([
      {
        entityId: "switch.new",
        changes: [
          change(10, "on", { friendly_name: "New" }),
          change(10.4, "off", { friendly_name: "New" }),
        ],
        skipped: 0,
      },
    ]);
    expect(document.entities["switch.new"]).toEqual({
      changes: {
        "2026-09-28": {
          "08:00": [
            ["00:10", "on", { friendly_name: "New" }],
            ["00:10", "off"],
          ],
        },
      },
    });
  });

  it("lists entities in ID order and leaves out empty keys", () => {
    const document = encode([
      {
        entityId: "switch.b",
        start: { state: "on", attributes: {} },
        changes: [],
        skipped: 0,
      },
      {
        entityId: "light.a",
        start: { state: "off", attributes: {} },
        changes: [],
        skipped: 0,
      },
    ]);
    expect(Object.keys(document.entities)).toEqual(["light.a", "switch.b"]);
    expect(document.entities["light.a"]).toEqual({ start: ["off", {}] });
  });

  it("gives skipped only when above zero", () => {
    const document = encode([
      {
        entityId: "a.one",
        start: { state: "1", attributes: {} },
        changes: [],
        skipped: 3,
      },
    ]);
    expect(document.entities["a.one"]).toEqual({
      start: ["1", {}],
      skipped: 3,
    });
  });

  it("keys an hour by its own offset across a daylight-saving change", () => {
    // 2026-10-25: 03:00 CEST becomes 02:00 CET in Europe/Madrid, at 01:00Z.
    const startMs = Date.UTC(2026, 9, 24, 22, 0, 0);
    const document = encode(
      [
        {
          entityId: "sensor.x",
          start: { state: "1", attributes: {} },
          changes: [
            {
              at: Date.UTC(2026, 9, 25, 0, 30, 0),
              state: "2",
              attributes: {},
              stateChanged: true,
            },
            {
              at: Date.UTC(2026, 9, 25, 1, 30, 0),
              state: "3",
              attributes: {},
              stateChanged: true,
            },
          ],
          skipped: 0,
        },
      ],
      { startMs, endMs: startMs + 6 * 3_600_000 },
    );
    expect(document.utc_offset).toBe("+02:00");
    expect(document.entities["sensor.x"]?.changes).toEqual({
      "2026-10-25": {
        "02:00": [["30:00", "2"]],
        "02:00+01:00": [["30:00", "3"]],
      },
    });
  });

  it("encodes an attribute named __proto__ like any other", () => {
    const named = JSON.parse(
      '{"__proto__": 2, "constructor": 3}',
    ) as JsonObject;
    const document = encode([
      {
        entityId: "sensor.x",
        start: { state: "1", attributes: {} },
        changes: [change(1, "1", named)],
        skipped: 0,
      },
    ]);
    expect(JSON.stringify(document.entities["sensor.x"]?.changes)).toBe(
      '{"2026-09-28":{"08:00":[["00:01",null,{"__proto__":2,"constructor":3}]]}}',
    );
  });
});

describe("the compression floor on the reference history (FR-018, SC-002, R12)", () => {
  async function ratio(entities?: string[]): Promise<number> {
    const ha = await startFakeHa({ fixture: REFERENCE_HISTORY });
    cleanups.push(() => ha.close());
    const { start, end } = REFERENCE_HISTORY.window;
    const response = await queryHistory(
      {
        DOMUSOPS_HA_URL: ha.url,
        DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
        DOMUSOPS_HISTORY_MAX_BYTES: "100000000",
      },
      {
        start: new Date(start * 1000).toISOString(),
        end: new Date(end * 1000).toISOString(),
        now: end * 1000 + 60_000,
        ...(entities === undefined ? {} : { entities }),
      },
    );
    return (JSON.parse(response.document) as { compression_ratio: number })
      .compression_ratio;
  }

  it("is at least 5 for the whole fixture", async () => {
    expect(await ratio()).toBeGreaterThanOrEqual(5);
  });

  it("is at least 5 for the ten-second power sensor", async () => {
    expect(await ratio(["sensor.*_power"])).toBeGreaterThanOrEqual(5);
  });
});

describe("the attribute filter (FR-006, research R9)", () => {
  it("compares each change with the previous listed entry and counts what it leaves out", () => {
    const history: EntityHistory = {
      entityId: "light.porch",
      start: { state: "on", attributes: { brightness: 10, mode: "a" } },
      changes: [
        change(1, "on", { brightness: 10, mode: "b" }),
        change(2, "on", { brightness: 11, mode: "b" }),
        change(3, "on", { brightness: 10, mode: "c" }),
        change(4, "on", { brightness: 12, mode: "c" }),
        change(5, "off", { brightness: 12, mode: "c" }),
      ],
      skipped: 0,
    };
    const kept = keepAttributes([history], ["brightness"])[0] as EntityHistory;
    expect(kept.start).toEqual({ state: "on", attributes: { brightness: 10 } });
    expect(kept.changes.map((c) => [c.state, c.attributes])).toEqual([
      ["on", { brightness: 11 }],
      ["on", { brightness: 10 }],
      ["on", { brightness: 12 }],
      ["off", { brightness: 12 }],
    ]);
    expect(kept.skipped).toBe(1);
  });

  it("lists the start even when every change is left out", () => {
    const kept = keepAttributes(
      [
        {
          entityId: "sensor.x",
          start: { state: "1", attributes: { a: 1, b: 1 } },
          changes: [change(1, "1", { a: 1, b: 2 })],
          skipped: 0,
        },
      ],
      ["a"],
    )[0] as EntityHistory;
    expect(kept).toMatchObject({ changes: [], skipped: 1 });
    expect(kept.start?.attributes).toEqual({ a: 1 });
  });
});

describe("the size limit (research R10)", () => {
  it("refuses one day of the ten-second power sensor at the default limit", async () => {
    const ha = await startFakeHa({ fixture: REFERENCE_HISTORY });
    cleanups.push(() => ha.close());
    const { start, end } = REFERENCE_HISTORY.window;
    await expect(
      queryHistory(
        { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
        {
          entities: ["sensor.*_power"],
          start: new Date(start * 1000).toISOString(),
          end: new Date(end * 1000).toISOString(),
          now: end * 1000 + 60_000,
        },
      ),
    ).rejects.toMatchObject({ kind: "too_large" });
  });
});
