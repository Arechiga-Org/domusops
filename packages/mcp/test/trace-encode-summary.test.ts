import {
  decodeContextId,
  parseIsoMicros,
  TRACE_SUMMARY_COLUMNS,
  type TraceExtendedRecord,
  type TraceSummaryDocument,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { encodeSummary } from "../src/trace/encode-summary.js";
import { runTrace } from "../src/tools/ha-trace.js";
import {
  EDGE_TRACES,
  REFERENCE_TRACES,
  TRACES_EMPTY,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function summary(
  fixture: TraceFixture,
  options: Parameters<typeof runTrace>[1] = {},
): Promise<{ text: string; doc: TraceSummaryDocument; ha: FakeHa }> {
  const ha = await startFakeHa({ fixture });
  running.push(ha);
  const text = await runTrace(
    {
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
      DOMUSOPS_TRACE_MAX_BYTES: "10000000",
    },
    { now: fixture.windowEnd * 1000, detail: "summary", ...options },
  );
  return { text, doc: JSON.parse(text) as TraceSummaryDocument, ha };
}

const rowsOf = (doc: TraceSummaryDocument): unknown[][] =>
  Object.values(doc.items).flat();

describe("summary of the reference set (spec FR-008)", () => {
  it("has one row per selected run, with the columns of data-model §4", async () => {
    const { doc } = await summary(REFERENCE_TRACES);
    expect(doc.format).toBe("domusops.trace/0.1");
    expect(doc.detail).toBe("summary");
    expect(doc.columns).toEqual([...TRACE_SUMMARY_COLUMNS]);
    expect(rowsOf(doc)).toHaveLength(REFERENCE_TRACES.traces.length);
    expect(doc.counts.runs).toBe(REFERENCE_TRACES.traces.length);
    const ids = rowsOf(doc).map((r) => r[0]);
    expect(new Set(ids)).toEqual(
      new Set(REFERENCE_TRACES.traces.map((t) => t.run_id)),
    );
  });

  it("writes each column in its form", async () => {
    const { doc } = await summary(REFERENCE_TRACES);
    const byRun = new Map(REFERENCE_TRACES.traces.map((t) => [t.run_id, t]));
    for (const row of rowsOf(doc)) {
      const raw = byRun.get(row[0] as string) as TraceExtendedRecord;
      // Local time to the second; the offset only when it differs from the document's.
      expect(row[1]).toMatch(
        /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d([+-]\d\d:\d\d)?$/,
      );
      const finish = parseIsoMicros(raw.timestamp.finish as string) as number;
      const start = parseIsoMicros(raw.timestamp.start) as number;
      expect(row[2]).toBe(Math.round((finish - start) / 1000));
      expect(row[3]).toBe("trigger" in raw ? raw.trigger : null);
      expect(row[4]).toBe(raw.script_execution);
      expect(row[5]).toBe(raw.last_step);
      // The full ID is recoverable from the compact one, anchored to the second of the start.
      const second = Math.floor(start / 1_000_000) * 1000;
      expect(decodeContextId(row[6] as string, second)).toBe(raw.context.id);
      expect(row).toHaveLength(7);
    }
  });

  it("gives a run that shares its context with another its own context (research R4)", async () => {
    const counts = new Map<string, number>();
    for (const t of REFERENCE_TRACES.traces) {
      counts.set(t.context.id, (counts.get(t.context.id) ?? 0) + 1);
    }
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
    const { doc, ha } = await summary(REFERENCE_TRACES);
    const byRun = new Map(REFERENCE_TRACES.traces.map((t) => [t.run_id, t]));
    for (const row of rowsOf(doc)) {
      const raw = byRun.get(row[0] as string) as TraceExtendedRecord;
      const second =
        Math.floor(
          (parseIsoMicros(raw.timestamp.start) as number) / 1_000_000,
        ) * 1000;
      expect(decodeContextId(row[6] as string, second)).toBe(raw.context.id);
    }
    // Only the runs the context map does not point to are read in full.
    const reads = ha.receivedTraceParams.filter((p) => "run_id" in p).length;
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(REFERENCE_TRACES.traces.length);
  });

  it("orders items by their newest run and runs newest first (data-model §3.1)", async () => {
    const { doc } = await summary(REFERENCE_TRACES);
    const starts = Object.values(doc.items).map((rows) =>
      rows.map((r) => Date.parse(String(r[1]).replace(" ", "T"))),
    );
    for (const list of starts)
      expect([...list].sort((a, b) => b - a)).toEqual(list);
    const newest = starts.map((l) => l[0] as number);
    expect([...newest].sort((a, b) => b - a)).toEqual(newest);
  });

  it("contains no steps, variables, or configuration", async () => {
    const { text } = await summary(REFERENCE_TRACES);
    for (const word of [
      '"steps"',
      '"trace"',
      '"configs"',
      '"values"',
      '"strings"',
      "changed_variables",
      '"alias"',
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it("is deterministic", async () => {
    const a = await summary(REFERENCE_TRACES);
    const b = await summary(REFERENCE_TRACES);
    expect(a.text).toBe(b.text);
  });

  it("is smaller than the standard document of the same selection, and reports its ratio", async () => {
    const { text, doc } = await summary(REFERENCE_TRACES);
    expect(doc.compression_ratio).toBeGreaterThan(1);
    const ha = await startFakeHa({ fixture: REFERENCE_TRACES });
    running.push(ha);
    const standard = await runTrace(
      {
        DOMUSOPS_HA_URL: ha.url,
        DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
        DOMUSOPS_TRACE_MAX_BYTES: "10000000",
      },
      { now: REFERENCE_TRACES.windowEnd * 1000 },
    );
    expect(text.length * 5).toBeLessThan(standard.length);
  });
});

describe("summary outcomes and errors", () => {
  it("shows a running run with no duration, an error, and a not-triggered trace", async () => {
    const { doc } = await summary(EDGE_TRACES);
    const byRun = new Map(rowsOf(doc).map((r) => [r[0] as string, r]));
    const running = EDGE_TRACES.traces.find(
      (t) => t.state === "running",
    ) as TraceExtendedRecord;
    expect(byRun.get(running.run_id)?.[2]).toBeNull();
    expect(byRun.get(running.run_id)?.[4]).toBe("running");
    const failing = EDGE_TRACES.traces.find(
      (t) => t.script_execution === "error",
    ) as TraceExtendedRecord;
    const row = byRun.get(failing.run_id) as unknown[];
    expect(row[4]).toBe("error");
    expect(row).toHaveLength(8);
    expect(row[7]).toBe(failing.error);
    const notTriggered = EDGE_TRACES.traces.find(
      (t) => t.not_triggered === true,
    ) as TraceExtendedRecord;
    expect(byRun.get(notTriggered.run_id)?.[4]).toBe("not_triggered");
    expect(doc.counts.not_triggered).toBe(1);
  });

  it("gives a script no trigger", async () => {
    const { doc } = await summary(REFERENCE_TRACES, { entities: ["script.*"] });
    expect(rowsOf(doc).length).toBeGreaterThan(0);
    for (const row of rowsOf(doc)) expect(row[3]).toBeNull();
  });

  it("yields a valid empty document", async () => {
    const { doc } = await summary(TRACES_EMPTY);
    expect(doc.items).toEqual({});
    expect(doc.counts).toEqual({ items: 0, runs: 0, not_triggered: 0 });
    expect(doc.compression_ratio).toBeGreaterThan(0);
  });

  it("selects by run and by context like the standard level", async () => {
    const one = REFERENCE_TRACES.traces[5] as TraceExtendedRecord;
    expect(
      rowsOf((await summary(REFERENCE_TRACES, { run: one.run_id })).doc),
    ).toHaveLength(1);
    const byContext = await summary(REFERENCE_TRACES, {
      context: one.context.id,
    });
    expect(rowsOf(byContext.doc).length).toBeGreaterThanOrEqual(1);
  });
});

describe("the context column (data-model §4)", () => {
  const encode = (contextId: string): unknown =>
    Object.values(
      encodeSummary(
        [
          {
            contextId,
            record: {
              run_id: "0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b",
              domain: "automation",
              item_id: "1700000000001",
              state: "stopped",
              script_execution: "finished",
              timestamp: {
                start: "2026-03-14T10:00:00.5+00:00",
                finish: "2026-03-14T10:00:01+00:00",
              },
              last_step: "action/0",
              trigger: "time",
            },
          },
        ],
        {
          haVersion: "2026.9.3",
          timeZone: "UTC",
          nowMs: Date.UTC(2026, 2, 14, 12),
          selection: {},
          items: {
            keyOf: (domain, itemId) => `${domain}.${itemId}`,
            itemIdOf: () => undefined,
          },
          noRuns: null,
        },
      ).items,
    )[0]?.[0]?.[6];

  it("is a plain string, even for an ID that looks like an encoded one", () => {
    // The standard encoding wraps this form as { v }; the summary contract has no such escape.
    expect(encode("12:7Q3KXW2M9ZB4Y6AR")).toBe("12:7Q3KXW2M9ZB4Y6AR");
    expect(encode("not-a-ulid")).toBe("not-a-ulid");
  });
});
