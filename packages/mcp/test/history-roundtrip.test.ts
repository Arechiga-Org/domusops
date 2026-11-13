import {
  expandHistory,
  type HistoryRecord,
  type HistoryStandardDocument,
  type JsonObject,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { formatLocalIso } from "../src/logbook/local-time.js";
import { EXEMPT_KEYS, redactRows } from "../src/snapshot/redact.js";
import { queryHistory } from "../src/tools/ha-history.js";
import type { RecordedState } from "./fixtures/generate.js";
import { REFERENCE_HISTORY } from "./fixtures/generate-history.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";

/**
 * `expandHistory` restores every entry the document was built from (specs/011-ha-history FR-017,
 * SC-002, data-model §6): states, full redacted attributes, times to the second.
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const { start, end } = REFERENCE_HISTORY.window;
const ZONE = String(REFERENCE_HISTORY.records.config["time_zone"]);
const local = (seconds: number): string =>
  formatLocalIso(Math.floor(seconds * 1000), ZONE, null);

const redacted = (attributes: JsonObject): JsonObject =>
  (
    redactRows([attributes], {
      token: FAKE_TOKEN,
      exemptKeys: EXEMPT_KEYS,
      coordinates: {
        latitude: REFERENCE_HISTORY.records.config["latitude"],
        longitude: REFERENCE_HISTORY.records.config["longitude"],
      },
    }) as JsonObject[]
  )[0] as JsonObject;

/**
 * The entries the instance records for `id` in the window, as the decoder must restore them. A
 * change's `last_changed` is the recorder's own; the start's is known only from an
 * attribute-only change that follows it.
 */
function expected(id: string): HistoryRecord[] {
  const recorded: RecordedState[] = REFERENCE_HISTORY.history[id] ?? [];
  const before = recorded.filter((entry) => entry.lu < start).at(-1);
  const inside = recorded.filter(
    (entry) => entry.lu >= start && entry.lu < end,
  );
  const first = inside[0];
  return [
    ...(before === undefined
      ? []
      : [
          {
            start: true,
            state: before.s,
            attributes: redacted(before.a),
            last_updated: local(start),
            last_changed:
              first !== undefined && first.lc !== first.lu
                ? local(first.lc)
                : null,
          },
        ]),
    ...inside.map((entry) => ({
      start: false,
      state: entry.s,
      attributes: redacted(entry.a),
      last_updated: local(entry.lu),
      last_changed: local(entry.lc),
    })),
  ];
}

async function decoded(
  entities: string[],
): Promise<Record<string, HistoryRecord[]>> {
  const ha = await startFakeHa({ fixture: REFERENCE_HISTORY });
  cleanups.push(() => ha.close());
  const response = await queryHistory(
    {
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
      DOMUSOPS_HISTORY_MAX_BYTES: "100000000",
    },
    {
      entities,
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      now: end * 1000 + 60_000,
    },
  );
  const document = JSON.parse(response.document) as HistoryStandardDocument;
  return Object.fromEntries(
    expandHistory(document).map((record) => [record.entity_id, record.entries]),
  );
}

describe("expandHistory(encode(redact(history)))", () => {
  it.each([
    [
      "the whole reference history",
      Object.keys(REFERENCE_HISTORY.history).filter(
        (id) => id !== "sensor.hub_firmware",
      ),
    ],
    ["one temperature sensor", ["sensor.annex_temperature"]],
    [
      "the phone, whose coordinates are redacted",
      ["device_tracker.attic_phone"],
    ],
    ["the lights", ["light.cellar", "light.landing", "light.nook"]],
    ["an entity created in the window", ["switch.new_heater"]],
    ["an unchanged entity named by exact ID", ["sensor.hub_firmware"]],
  ])("restores %s", async (_, ids) => {
    const entries = await decoded(ids);
    expect(Object.keys(entries)).toEqual([...ids].sort());
    for (const id of ids) expect(entries[id], id).toEqual(expected(id));
  });
});
