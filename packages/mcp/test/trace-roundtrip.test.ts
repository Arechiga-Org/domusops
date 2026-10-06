import { expandTrace, type TraceExtendedRecord } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import {
  EDGE_TRACES,
  PERFORMANCE_TRACES,
  REFERENCE_TRACES,
  TRACES_EMPTY,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { encodeRecords, sortKeys } from "./support/trace-helpers.js";

/** `expandTrace` of what went over the wire equals the records, by value (SC-002). */
function expectRoundTrip(
  records: readonly TraceExtendedRecord[],
  fixture: TraceFixture,
): void {
  const { text } = encodeRecords(records, fixture);
  const back = expandTrace(JSON.parse(text));
  expect(back).toHaveLength(records.length);
  const byRun = new Map(back.map((r) => [r.run_id, r]));
  expect(byRun.size).toBe(records.length);
  for (const record of records) {
    expect(sortKeys(byRun.get(record.run_id))).toEqual(sortKeys(record));
  }
}

describe("expandTrace(standard) equals the extended records (spec SC-002)", () => {
  it.each([
    ["the reference set", REFERENCE_TRACES],
    ["the performance set", PERFORMANCE_TRACES],
    ["the edge set", EDGE_TRACES],
    ["the empty set", TRACES_EMPTY],
  ])("for %s", (_name, fixture) => {
    expectRoundTrip(fixture.traces, fixture);
  });

  it("returns runs newest first within an item, and every run once", () => {
    const { text } = encodeRecords(REFERENCE_TRACES.traces, REFERENCE_TRACES);
    const back = expandTrace(JSON.parse(text));
    expect(new Set(back.map((r) => r.run_id)).size).toBe(
      REFERENCE_TRACES.traces.length,
    );
    const seen = new Map<string, string>();
    for (const run of back) {
      const key = `${run.domain}/${run.item_id}`;
      const previous = seen.get(key);
      if (previous !== undefined)
        expect(run.timestamp.start <= previous).toBe(true);
      seen.set(key, run.timestamp.start);
    }
  });

  it("holds for one record at a time, whatever the others are", () => {
    for (const record of EDGE_TRACES.traces)
      expectRoundTrip([record], EDGE_TRACES);
  });
});

describe("hand-built records (data-model §3)", () => {
  const base = (): TraceExtendedRecord =>
    structuredClone(REFERENCE_TRACES.traces[0]) as TraceExtendedRecord;

  it("keeps literals that look like the format's own forms", () => {
    const record = base();
    record.config = {
      alias: "#3",
      note: "@5",
      compact: "12:0123456789ABCDEF",
      ref: { $: 1 },
      form: { S: [1], D: 2 },
      literal: { v: { $: 0 } },
      repeated: "a value that repeats",
      again: "a value that repeats",
    };
    record.blueprint_inputs = { text: "@-1", other: "#0" };
    expectRoundTrip([record], REFERENCE_TRACES);
  });

  it("keeps a context object with an extra key, and a null parent", () => {
    const record = base();
    (record.context as unknown as Record<string, unknown>)["extra"] = "kept";
    expectRoundTrip([record], REFERENCE_TRACES);
    const plain = base();
    plain.context = { id: "not-a-ulid", parent_id: null, user_id: "0a1b2c" };
    expectRoundTrip([plain], REFERENCE_TRACES);
  });

  it("keeps a step with no optional part, a child, an error, and template errors", () => {
    const record = base();
    const [path] = Object.keys(record.trace) as [string];
    record.trace["action/bare"] = [
      { path: "action/bare", timestamp: record.timestamp.start },
    ];
    record.trace["action/all"] = [
      {
        path: "action/all",
        timestamp: record.timestamp.start,
        result: { params: { domain: "script", service: "x" } },
        changed_variables: { a: 1, b: [1, 2], c: { d: null } },
        child_id: { domain: "script", item_id: "x", run_id: "0".repeat(32) },
        error: "boom",
        template_errors: ["one", "two"],
      },
    ];
    record.last_step = "action/all";
    expect(path).toBeDefined();
    expectRoundTrip([record], REFERENCE_TRACES);
  });

  it("keeps a null configuration and a trace of a removed item", () => {
    const record = base();
    record.config = null;
    record.item_id = "removed-item";
    expectRoundTrip([record], REFERENCE_TRACES);
  });

  it("keeps a timestamp that is not canonical as text", () => {
    const record = base();
    record.config = {
      at: "2026-03-14T10:00:03Z",
      odd: "2026-03-14T10:00:03.1234567+00:00",
    };
    expectRoundTrip([record], REFERENCE_TRACES);
  });
});
