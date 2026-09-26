import {
  expandLogbook,
  projectLogbook,
  type LogbookRow,
  type LogbookStandardDocument,
  type LogbookSummaryDocument,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOWED_COMMANDS } from "../src/ha/client.js";
import { runLogbookQuery } from "../src/tools/ha-logbook-query.js";
import {
  LOGBOOK_EMPTY,
  PERFORMANCE_LOGBOOK,
  REFERENCE_LOGBOOK_24H,
  type LogbookFixture,
} from "./fixtures/generate-logbook.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

const END_MS = REFERENCE_LOGBOOK_24H.window.end * 1000;

async function query(
  fixture: LogbookFixture,
  options: Parameters<typeof runLogbookQuery>[1] = {},
  extraEnv: Record<string, string> = {},
): Promise<{ ha: FakeHa; text: string; doc: LogbookStandardDocument }> {
  const ha = await startFakeHa({ fixture });
  running.push(ha);
  const text = await runLogbookQuery(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...extraEnv },
    { now: fixture.window.end * 1000, ...options },
  );
  return { ha, text, doc: JSON.parse(text) as LogbookStandardDocument };
}

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
const inWindow = (
  rows: LogbookRow[],
  start: number,
  end: number,
): LogbookRow[] => rows.filter((r) => r.when >= start && r.when <= end);

describe("ha_logbook_query, standard detail", () => {
  it("returns the last 24 hours by default, every event in order", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H);
    expect(doc.format).toBe("domusops.logbook/0.1");
    expect(doc.detail).toBe("standard");
    expect(expandLogbook(doc)).toEqual(
      projectLogbook(REFERENCE_LOGBOOK_24H.logbook),
    );
  });

  it("honours an explicit window", async () => {
    const { start, end } = REFERENCE_LOGBOOK_24H.window;
    const from = end - 6 * 3600;
    const { doc } = await query(REFERENCE_LOGBOOK_24H, {
      start: iso(from),
      end: iso(end),
    });
    expect(expandLogbook(doc)).toEqual(
      projectLogbook(inWindow(REFERENCE_LOGBOOK_24H.logbook, from, end)),
    );
    expect(start).toBeLessThan(from);
  });

  it("states the window, the time zone, and the first and last event (FR-010)", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H);
    expect(doc.time_zone).toBe("Europe/Madrid");
    expect(doc.utc_offset).toBe("+01:00");
    expect(doc.window).toEqual({
      start: "2026-03-13T11:00:00+01:00",
      end: "2026-03-14T11:00:00+01:00",
    });
    expect(doc.first).toMatch(/^2026-03-1[34]T\d\d:\d\d:\d\d$/);
    expect(doc.last).toMatch(/^2026-03-1[34]T\d\d:\d\d:\d\d$/);
    expect((doc.first as string) <= (doc.last as string)).toBe(true);
    expect(doc.ha_version).toBe("2026.9.1");
    expect(doc.compression_ratio).toBeGreaterThan(1);
  });

  it("is a valid document when nothing happened", async () => {
    const { doc } = await query(LOGBOOK_EMPTY);
    expect(doc.events).toEqual({});
    expect(doc.first).toBeNull();
    expect(expandLogbook(doc)).toEqual([]);
  });

  it("states each cause once and references it from every event that shares it", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H);
    const combos = new Set(
      REFERENCE_LOGBOOK_24H.logbook
        .map((r) =>
          Object.keys(r)
            .filter((k) => k.startsWith("context_") && k !== "context_id")
            .sort()
            .map((k) => `${k}=${String(r[k])}`)
            .join("|"),
        )
        .filter((c) => c !== ""),
    );
    expect(doc.causes?.length).toBe(combos.size);
  });
});

describe("ha_logbook_query, entity selectors", () => {
  const rows = REFERENCE_LOGBOOK_24H.logbook;
  const someLight = rows.find((r) => r.entity_id?.startsWith("light."))
    ?.entity_id as string;

  it("sends exact IDs to the instance and nothing else", async () => {
    const { ha, doc } = await query(REFERENCE_LOGBOOK_24H, {
      entities: [someLight],
    });
    expect(ha.receivedParams[0]?.["entity_ids"]).toEqual([someLight]);
    expect(expandLogbook(doc)).toEqual(
      projectLogbook(rows.filter((r) => r.entity_id === someLight)),
    );
  });

  it("does not send entity_ids for a pattern, and filters in the tool", async () => {
    const { ha, doc } = await query(REFERENCE_LOGBOOK_24H, {
      entities: ["light.*"],
    });
    expect(ha.receivedParams[0]).not.toHaveProperty("entity_ids");
    expect(expandLogbook(doc)).toEqual(
      projectLogbook(rows.filter((r) => r.entity_id?.startsWith("light."))),
    );
  });

  it("drops events without an entity when selectors are given, and keeps them otherwise", async () => {
    const withoutEntity = rows.filter((r) => r.entity_id === undefined).length;
    expect(withoutEntity).toBeGreaterThan(0);
    const all = await query(REFERENCE_LOGBOOK_24H);
    expect(
      expandLogbook(all.doc).filter((r) => r["entity_id"] === undefined),
    ).toHaveLength(withoutEntity);
    const narrowed = await query(REFERENCE_LOGBOOK_24H, { entities: ["*"] });
    expect(
      expandLogbook(narrowed.doc).filter((r) => r["entity_id"] === undefined),
    ).toHaveLength(0);
  });

  it("echoes the selectors and lists those that matched nothing", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H, {
      entities: ["light.*", "sensor.does_not_exist", "light.*"],
    });
    expect(doc.selectors).toEqual(["light.*", "sensor.does_not_exist"]);
    expect(doc.no_events).toEqual(["sensor.does_not_exist"]);
  });

  it("omits selectors and no_events when there are none", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H);
    expect(doc).not.toHaveProperty("selectors");
    expect(doc).not.toHaveProperty("no_events");
  });
});

describe("ha_logbook_query, read-only", () => {
  it("sends only allowlisted commands, and only the three permitted parameters", async () => {
    const seen: FakeHa[] = [];
    for (const options of [
      {},
      { entities: ["light.*"] },
      { entities: ["light.a", "switch.b"] },
      { start: iso(END_MS / 1000 - 3600) },
    ]) {
      seen.push((await query(REFERENCE_LOGBOOK_24H, options)).ha);
    }
    for (const ha of seen) {
      for (const command of ha.received) {
        expect(ALLOWED_COMMANDS as readonly string[]).toContain(command);
      }
      for (const params of ha.receivedParams) {
        for (const key of Object.keys(params)) {
          expect(["start_time", "end_time", "entity_ids"]).toContain(key);
        }
      }
    }
  });
});

describe("ha_logbook_query, scale", () => {
  it("returns 10,000 events over 1,000 entities in under 5 s (SC-004)", async () => {
    // The standard document (about 370 KB) is far above the default size limit, which this case
    // does not test.
    const started = performance.now();
    const { doc } = await query(
      PERFORMANCE_LOGBOOK,
      {},
      { DOMUSOPS_LOGBOOK_MAX_BYTES: "10000000" },
    );
    expect(performance.now() - started).toBeLessThan(5000);
    expect(expandLogbook(doc)).toHaveLength(PERFORMANCE_LOGBOOK.logbook.length);
  });
});

describe("ha_logbook_query, detail levels", () => {
  it("returns a standard document when detail is omitted", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H);
    expect(doc.detail).toBe("standard");
  });

  it("returns counts only at summary, applying the window and the selectors", async () => {
    const { text } = await query(REFERENCE_LOGBOOK_24H, {
      detail: "summary",
      entities: ["light.*", "sensor.does_not_exist"],
    });
    const doc = JSON.parse(text) as LogbookSummaryDocument;
    const lights = REFERENCE_LOGBOOK_24H.logbook.filter((r) =>
      r.entity_id?.startsWith("light."),
    );
    expect(doc.detail).toBe("summary");
    expect(doc.counts.events).toBe(lights.length);
    expect(doc.counts.no_entity_events).toBe(0);
    expect(doc.selectors).toEqual(["light.*", "sensor.does_not_exist"]);
    expect(doc.no_events).toEqual(["sensor.does_not_exist"]);
    expect(doc).not.toHaveProperty("events");
  });

  it("is not subject to the size limit that refuses the standard document", async () => {
    const env = { DOMUSOPS_LOGBOOK_MAX_BYTES: "1000" };
    await expect(query(REFERENCE_LOGBOOK_24H, {}, env)).rejects.toMatchObject({
      kind: "too_large",
    });
    const { doc } = await query(
      REFERENCE_LOGBOOK_24H,
      { detail: "summary" },
      env,
    );
    const summary = doc as unknown as LogbookSummaryDocument;
    expect(summary.counts.events).toBe(REFERENCE_LOGBOOK_24H.logbook.length);
  });

  it("carries the same compression_ratio definition as standard", async () => {
    const { doc } = await query(REFERENCE_LOGBOOK_24H, { detail: "summary" });
    expect(doc.compression_ratio).toBeGreaterThan(5);
  });
});
