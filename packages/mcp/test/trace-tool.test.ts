import {
  encodeContextId,
  expandTrace,
  type TraceExtendedRecord,
  type TraceStandardDocument,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOWED_COMMANDS } from "../src/ha/client.js";
import { runTrace } from "../src/tools/ha-trace.js";
import { contextKey } from "../src/trace/context-id.js";
import {
  EDGE_TRACES,
  PERFORMANCE_TRACES,
  REFERENCE_TRACES,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";
import { sortKeys } from "./support/trace-helpers.js";

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function query(
  fixture: TraceFixture,
  options: Parameters<typeof runTrace>[1] = {},
  extraEnv: Record<string, string> = {},
): Promise<{ ha: FakeHa; text: string; doc: TraceStandardDocument }> {
  const ha = await startFakeHa({ fixture });
  running.push(ha);
  const text = await runTrace(
    {
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
      // The reference set is above the default limit when taken whole; the limit has its own tests.
      DOMUSOPS_TRACE_MAX_BYTES: "10000000",
      ...extraEnv,
    },
    { now: fixture.windowEnd * 1000, ...options },
  );
  return { ha, text, doc: JSON.parse(text) as TraceStandardDocument };
}

const entityOf = (fixture: TraceFixture, record: TraceExtendedRecord): string =>
  (
    fixture.records.entity_registry as unknown as {
      entity_id: string;
      unique_id: string;
      platform: string;
    }[]
  ).find((e) => e.platform === record.domain && e.unique_id === record.item_id)
    ?.entity_id as string;

const recordsOf = (
  fixture: TraceFixture,
  entity: string,
): TraceExtendedRecord[] =>
  fixture.traces.filter((t) => entityOf(fixture, t) === entity);

const expectSame = (
  doc: TraceStandardDocument,
  wanted: readonly TraceExtendedRecord[],
): void => {
  const back = expandTrace(doc);
  expect(back.map((r) => r.run_id).sort()).toEqual(
    wanted.map((r) => r.run_id).sort(),
  );
  const byRun = new Map(back.map((r) => [r.run_id, r]));
  for (const record of wanted) {
    expect(sortKeys(byRun.get(record.run_id))).toEqual(sortKeys(record));
  }
};

const firstOf = (fixture: TraceFixture, domain: string): TraceExtendedRecord =>
  fixture.traces.find(
    (t) => t.domain === domain && Object.keys(t.trace).length > 2,
  ) as TraceExtendedRecord;

describe("ha_trace, standard detail: what an item did (spec User Story 1)", () => {
  it("returns every stored run of an automation, newest first", async () => {
    const entity = entityOf(
      REFERENCE_TRACES,
      firstOf(REFERENCE_TRACES, "automation"),
    );
    const { doc } = await query(REFERENCE_TRACES, { entities: [entity] });
    expect(doc.format).toBe("domusops.trace/0.1");
    expect(doc.detail).toBe("standard");
    const wanted = recordsOf(REFERENCE_TRACES, entity);
    expect(wanted.length).toBeGreaterThan(1);
    expectSame(doc, wanted);
    const starts = (doc.items[entity]?.runs ?? []).map((r) =>
      Date.parse(r.start),
    );
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
    expect(doc.compression_ratio).toBeGreaterThan(1);
  });

  it("returns a script's runs in the same form", async () => {
    const entity = entityOf(
      REFERENCE_TRACES,
      firstOf(REFERENCE_TRACES, "script"),
    );
    const { doc } = await query(REFERENCE_TRACES, { entities: [entity] });
    expect(entity.startsWith("script.")).toBe(true);
    expectSame(doc, recordsOf(REFERENCE_TRACES, entity));
    for (const run of doc.items[entity]?.runs ?? []) {
      expect("trigger" in run).toBe(false);
    }
  });

  it("returns exactly the run asked for by its ID", async () => {
    const wanted = REFERENCE_TRACES.traces[7] as TraceExtendedRecord;
    const { doc } = await query(REFERENCE_TRACES, { run: wanted.run_id });
    expectSame(doc, [wanted]);
    expect(doc.selection).toEqual({ run: wanted.run_id });
  });

  it("returns the runs in a context taken from a logbook cause, in one call", async () => {
    const row = REFERENCE_TRACES.logbook.find(
      (r) =>
        REFERENCE_TRACES.traces.filter((t) => t.context.id === r["context_id"])
          .length > 1,
    );
    expect(row).toBeDefined();
    const id = row?.["context_id"] as string;
    const wanted = REFERENCE_TRACES.traces.filter((t) => t.context.id === id);
    expect(new Set(wanted.map((t) => t.domain)).size).toBe(2);
    // As `ha_logbook_query` emits it: compact, anchored to the second of the event.
    const compact = encodeContextId(id, (row?.when as number) * 1000) as string;
    for (const form of [id, compact]) {
      const { doc } = await query(REFERENCE_TRACES, { context: form });
      expectSame(doc, wanted);
      expect(doc.selection).toEqual({ context: form });
    }
  });

  it("names the script run a step started, whether or not it is still stored", async () => {
    const { doc } = await query(REFERENCE_TRACES);
    const stored = new Set(REFERENCE_TRACES.traces.map((t) => t.run_id));
    let linked = 0;
    let evicted = 0;
    for (const run of Object.values(doc.items).flatMap((i) => i.runs)) {
      for (const step of run.steps) {
        const child = Array.isArray(step) ? step[4] : undefined;
        if (!Array.isArray(child)) continue;
        expect(child[0]).toMatch(/^script\./);
        linked++;
        if (!stored.has(child[1] as string)) evicted++;
      }
    }
    expect(linked).toBeGreaterThan(0);
    expect(evicted).toBeGreaterThan(0);
  });

  it("gives every run a context that ties it to its logbook events (SC-007)", async () => {
    const { doc } = await query(REFERENCE_TRACES);
    const runs = Object.values(doc.items).flatMap((i) => i.runs);
    const keys = new Set(
      REFERENCE_TRACES.logbook.map((r) =>
        contextKey(r["context_id"] as string),
      ),
    );
    expect(runs.length).toBe(REFERENCE_TRACES.traces.length);
    for (const run of runs)
      expect(keys.has(contextKey(run.context as string))).toBe(true);
  });

  it("returns a not-triggered trace with its own outcome, counted apart", async () => {
    const record = EDGE_TRACES.traces.find(
      (t) => t.not_triggered === true,
    ) as TraceExtendedRecord;
    const entity = entityOf(EDGE_TRACES, record);
    const { doc } = await query(EDGE_TRACES, { entities: [entity] });
    const run = doc.items[entity]?.runs.find((r) => r.run === record.run_id);
    expect(run?.outcome).toBe("not_triggered");
    expect(run?.not_triggered).toBe(true);
    expect(doc.counts.not_triggered).toBe(1);
    expect(doc.counts.runs).toBe(doc.items[entity]!.runs.length - 1);
  });

  it("returns a run in progress with the steps recorded so far", async () => {
    const record = EDGE_TRACES.traces.find(
      (t) => t.state === "running",
    ) as TraceExtendedRecord;
    const { doc } = await query(EDGE_TRACES, { run: record.run_id });
    const run = Object.values(doc.items)[0]?.runs[0];
    expect(run?.outcome).toBe("running");
    expect(run?.duration_ms).toBeUndefined();
    expectSame(doc, [record]);
  });

  it("states where a run stopped early and why (scenario 3)", async () => {
    const stopped = EDGE_TRACES.traces.find(
      (t) => t.script_execution === "failed_conditions",
    ) as TraceExtendedRecord;
    const failing = EDGE_TRACES.traces.find(
      (t) => t.script_execution === "error",
    ) as TraceExtendedRecord;
    const a = Object.values(
      (await query(EDGE_TRACES, { run: stopped.run_id })).doc.items,
    )[0]?.runs[0];
    expect(a?.outcome).toBe("failed_conditions");
    const b = Object.values(
      (await query(EDGE_TRACES, { run: failing.run_id })).doc.items,
    )[0]?.runs[0];
    expect(b?.outcome).toBe("error");
    expect(b?.error).toBe(failing.error);
    expectSame((await query(EDGE_TRACES, { run: failing.run_id })).doc, [
      failing,
    ]);
  });

  it("states a configuration once for the runs that executed it (scenario 4)", async () => {
    const entity = entityOf(
      REFERENCE_TRACES,
      firstOf(REFERENCE_TRACES, "automation"),
    );
    const { doc } = await query(REFERENCE_TRACES, { entities: [entity] });
    const runs = doc.items[entity]?.runs ?? [];
    expect(doc.configs).toHaveLength(1);
    expect(new Set(runs.map((r) => r.config))).toEqual(new Set([0]));
  });
});

describe("what is asked of the instance", () => {
  it("lists only the domains a selector can match, and reads only the selected traces", async () => {
    const entity = entityOf(
      REFERENCE_TRACES,
      firstOf(REFERENCE_TRACES, "script"),
    );
    const { ha } = await query(REFERENCE_TRACES, { entities: [entity] });
    const lists = ha.receivedTraceParams.filter(
      (p) => Object.keys(p).join() === "domain",
    );
    expect(lists).toEqual([{ domain: "script" }]);
    const gets = ha.receivedTraceParams.filter((p) => "run_id" in p);
    const wanted = new Set(
      recordsOf(REFERENCE_TRACES, entity).map((t) => t.run_id),
    );
    expect(gets).toHaveLength(wanted.size);
    for (const get of gets)
      expect(wanted.has(get["run_id"] as string)).toBe(true);
  });

  it("sends only allowlisted read commands with the permitted keys, for every selection (SC-006)", async () => {
    const run = REFERENCE_TRACES.traces[3] as TraceExtendedRecord;
    const entity = entityOf(REFERENCE_TRACES, run);
    const combos: Parameters<typeof runTrace>[1][] = [
      {},
      { entities: [entity] },
      { entities: ["automation.*", "script.*"] },
      { run: run.run_id },
      { context: run.context.id },
    ];
    for (const options of combos) {
      const { ha } = await query(REFERENCE_TRACES, options);
      const allowed = new Set<string>(ALLOWED_COMMANDS);
      for (const command of ha.received)
        expect(allowed.has(command)).toBe(true);
      expect(ha.received.some((c) => c.startsWith("trace/debug"))).toBe(false);
      const permitted = new Set(["domain", "item_id", "run_id"]);
      for (const params of ha.receivedTraceParams) {
        for (const key of Object.keys(params))
          expect(permitted.has(key)).toBe(true);
      }
    }
  });

  it("states the time zone, the offset, the selection, and the counts in every mode (FR-012)", async () => {
    const run = REFERENCE_TRACES.traces[3] as TraceExtendedRecord;
    const entity = entityOf(REFERENCE_TRACES, run);
    const cases: [Parameters<typeof runTrace>[1], Record<string, unknown>][] = [
      [{}, {}],
      [{ entities: [entity] }, { entities: [entity] }],
      [{ run: run.run_id }, { run: run.run_id }],
      [{ context: run.context.id }, { context: run.context.id }],
    ];
    for (const [options, selection] of cases) {
      const { doc } = await query(REFERENCE_TRACES, options);
      expect(doc.time_zone).toBe("Europe/Madrid");
      expect(doc.utc_offset).toBe("+01:00");
      expect(doc.selection).toEqual(selection);
      expect(doc.counts.runs).toBeGreaterThan(0);
      for (const item of Object.values(doc.items)) {
        for (const r of item.runs) {
          expect(r.start).toMatch(/[+-]01:00$/);
        }
      }
    }
  });
});

describe("performance (spec SC-004, first half)", () => {
  it("returns one item's runs of a 100-item, 500-run instance in under 5 s", async () => {
    const entity = entityOf(
      PERFORMANCE_TRACES,
      firstOf(PERFORMANCE_TRACES, "automation"),
    );
    const started = Date.now();
    const { doc } = await query(PERFORMANCE_TRACES, { entities: [entity] });
    expect(Date.now() - started).toBeLessThan(5000);
    expectSame(doc, recordsOf(PERFORMANCE_TRACES, entity));
  });
});
