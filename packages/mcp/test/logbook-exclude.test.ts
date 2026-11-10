import {
  expandLogbook,
  projectLogbook,
  type LogbookRow,
  type LogbookStandardDocument,
  type LogbookSummaryDocument,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError } from "../src/errors.js";
import { byteLength, measureRowsBytes } from "../src/snapshot/ratio.js";
import { runLogbookQuery } from "../src/tools/ha-logbook-query.js";
import {
  REFERENCE_LOGBOOK_24H,
  type LogbookFixture,
} from "./fixtures/generate-logbook.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";

/** `exclude` on ha_logbook_query (specs/008-mcp-reliability US3, FR-007 to FR-010, research R3). */

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function query(
  options: Parameters<typeof runLogbookQuery>[1] = {},
  extraEnv: Record<string, string> = {},
  fixture: LogbookFixture = REFERENCE_LOGBOOK_24H,
): Promise<{ ha: FakeHa; text: string }> {
  const ha = await startFakeHa({ fixture });
  running.push(ha);
  const text = await runLogbookQuery(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...extraEnv },
    { now: fixture.window.end * 1000, ...options },
  );
  return { ha, text };
}

const ROWS = REFERENCE_LOGBOOK_24H.logbook;
const startsWith =
  (...prefixes: string[]) =>
  (row: LogbookRow): boolean =>
    typeof row.entity_id === "string" &&
    prefixes.some((p) => (row.entity_id as string).startsWith(p));
const not =
  (test: (row: LogbookRow) => boolean) =>
  (row: LogbookRow): boolean =>
    !test(row);

/** The entities with the most rows, most first. */
function noisiest(count: number): string[] {
  const rows = new Map<string, number>();
  for (const row of ROWS) {
    if (typeof row.entity_id === "string")
      rows.set(row.entity_id, (rows.get(row.entity_id) ?? 0) + 1);
  }
  return [...rows]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id]) => id);
}

const entityIds = (rows: readonly LogbookRow[]): Set<string> =>
  new Set(
    rows.flatMap((row) =>
      typeof row.entity_id === "string" ? [row.entity_id] : [],
    ),
  );

describe("ha_logbook_query with exclude", () => {
  it("leaves every event of an excluded entity out of a standard document, and keeps events with no entity", async () => {
    const { text } = await query({ exclude: ["sensor.*"] });
    const doc = JSON.parse(text) as LogbookStandardDocument;
    const kept = ROWS.filter(not(startsWith("sensor.")));
    expect(kept.some((row) => row.entity_id === undefined)).toBe(true);
    expect(expandLogbook(doc)).toEqual(projectLogbook(kept));
  });

  it("leaves excluded entities out of every count of a summary document", async () => {
    const { text } = await query({ detail: "summary", exclude: ["sensor.*"] });
    const doc = JSON.parse(text) as LogbookSummaryDocument;
    const kept = ROWS.filter(not(startsWith("sensor.")));
    expect(doc.counts.events).toBe(kept.length);
    expect(doc.counts.entities).toBe(entityIds(kept).size);
    expect(doc.by_domain["sensor"]).toBeUndefined();
    expect(
      Object.keys(doc.by_entity).filter((id) => id.startsWith("sensor.")),
    ).toEqual([]);
  });

  it("excludes an entity matched by both entities and exclude", async () => {
    const { text } = await query({
      entities: ["light.*", "sensor.*"],
      exclude: ["sensor.*"],
    });
    const doc = JSON.parse(text) as LogbookStandardDocument;
    expect(expandLogbook(doc)).toEqual(
      projectLogbook(ROWS.filter(startsWith("light."))),
    );
  });

  it("asks the instance only for the exact IDs that are not excluded", async () => {
    const [light, sensor] = [
      [...entityIds(ROWS)].find((id) => id.startsWith("light.")) as string,
      [...entityIds(ROWS)].find((id) => id.startsWith("sensor.")) as string,
    ];
    const { ha, text } = await query({
      entities: [light, sensor],
      exclude: [sensor],
    });
    expect(ha.receivedParams.map((p) => p["entity_ids"])).toEqual([[light]]);
    const doc = JSON.parse(text) as LogbookStandardDocument;
    expect(expandLogbook(doc)).toEqual(
      projectLogbook(ROWS.filter((row) => row.entity_id === light)),
    );
    expect(doc.no_events ?? []).toEqual([]);
  });

  it("sends no logbook request when every exact ID is excluded, and returns a valid empty document", async () => {
    const sensor = [...entityIds(ROWS)].find((id) =>
      id.startsWith("sensor."),
    ) as string;
    const { ha, text } = await query({
      entities: [sensor],
      exclude: ["sensor.*"],
    });
    expect(ha.received).not.toContain("logbook/get_events");
    const doc = JSON.parse(text) as LogbookStandardDocument;
    expect(doc.events).toEqual({});
    expect(doc.first).toBeNull();
    expect(doc.no_events ?? []).toEqual([]);
  });

  it("keeps the meaning of no_events: a pattern whose events were all excluded is not listed, one that matched nothing is", async () => {
    const { text } = await query({
      entities: ["sensor.*", "fan.*"],
      exclude: ["sensor.*"],
    });
    const doc = JSON.parse(text) as LogbookStandardDocument;
    expect(doc.no_events).toEqual(["fan.*"]);
  });

  it("measures compression_ratio on the events it returns", async () => {
    const { text } = await query({ exclude: ["sensor.*", "light.*"] });
    const kept = ROWS.filter(not(startsWith("sensor.", "light.")));
    const doc = JSON.parse(text) as LogbookStandardDocument;
    const emitted = byteLength(
      JSON.stringify({ ...doc, compression_ratio: 0 }),
    );
    expect(doc.compression_ratio).toBe(
      Math.round((measureRowsBytes(kept) / emitted) * 100) / 100,
    );
  });

  it("fits a standard query refused for size once its noisiest entities are excluded (SC-004)", async () => {
    const exclude = noisiest(10);
    const whole = byteLength((await query()).text);
    const narrowed = byteLength((await query({ exclude })).text);
    expect(narrowed).toBeLessThan(whole);
    // A limit between the two sizes: the reference window is refused whole, and fits with exclude.
    const limit = { DOMUSOPS_LOGBOOK_MAX_BYTES: String(narrowed) };
    await expect(query({}, limit)).rejects.toMatchObject({
      kind: "too_large",
      nextStep: expect.stringContaining("exclude") as unknown,
    });
    const { text } = await query({ exclude }, limit);
    const doc = JSON.parse(text) as LogbookStandardDocument;
    const ids = entityIds(expandLogbook(doc) as LogbookRow[]);
    for (const id of exclude) expect(ids.has(id)).toBe(false);
  });

  it.each([
    [[], "empty list"],
    [["Light.Hallway"], "uppercase"],
    [["light.hallway lamp"], "space"],
    [["x".repeat(129)], "too long"],
    [Array.from({ length: 101 }, (_, i) => `light.l${i}`), "too many"],
  ])(
    "refuses an invalid exclude list (%s: %s) like an invalid entities list",
    async (exclude) => {
      const error = await query({ exclude }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ToolError);
      expect(error).toMatchObject({ kind: "selector_invalid" });
    },
  );
});
