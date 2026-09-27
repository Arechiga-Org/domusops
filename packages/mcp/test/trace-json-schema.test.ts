/* eslint-disable @typescript-eslint/no-explicit-any -- the rejection cases mutate parsed documents of a shape the schema, not the type system, is checking */
import { traceJsonSchema, type TraceExtendedRecord } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import type { TraceEncodeContext } from "../src/trace/encode-standard.js";
import { encodeSummary } from "../src/trace/encode-summary.js";
import { finalize, measureRowsBytes } from "../src/snapshot/ratio.js";
import {
  EDGE_TRACES,
  PERFORMANCE_TRACES,
  REFERENCE_TRACES,
  TRACES_EMPTY,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { encodeRecords, itemsOf, TIME_ZONE } from "./support/trace-helpers.js";

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  traceJsonSchema,
);

/** A parsed document, poked at by the rejection cases: its shape is what is under test. */
type Doc = Record<string, any>;

const LONG = new Set(["trace", "config", "blueprint_inputs", "context"]);

function documents(
  fixture: TraceFixture,
): Record<string, Record<string, unknown>> {
  const standard = JSON.parse(encodeRecords(fixture.traces, fixture).text);
  const runs = fixture.traces.map((record) => ({
    record: Object.fromEntries(
      Object.entries(record).filter(([key]) => !LONG.has(key)),
    ) as TraceExtendedRecord,
    contextId: record.context.id,
  }));
  const context: TraceEncodeContext = {
    haVersion: fixture.haVersion,
    timeZone: TIME_ZONE,
    nowMs: fixture.windowEnd * 1000,
    selection: {},
    items: itemsOf(fixture),
    noRuns: null,
  };
  const withReasons = {
    ...context,
    selection: { entities: ["light.*"], start: "2026-03-14T00:00:00+01:00" },
    noRuns: { no_match: ["light.*"], none_in_window: ["automation.x"] },
  };
  const summaryOf = (c: TraceEncodeContext): Record<string, unknown> =>
    JSON.parse(
      finalize(encodeSummary(runs, c), measureRowsBytes(fixture.traces)),
    );
  return {
    standard,
    summary: summaryOf(context),
    "summary with reasons": summaryOf(withReasons),
  };
}

describe("traceJsonSchema accepts what the tool emits", () => {
  for (const [name, fixture] of [
    ["reference", REFERENCE_TRACES],
    ["performance", PERFORMANCE_TRACES],
    ["edge", EDGE_TRACES],
    ["empty", TRACES_EMPTY],
  ] as const) {
    for (const [kind, doc] of Object.entries(documents(fixture))) {
      it(`accepts the ${kind} document of the ${name} set`, () => {
        expect(
          validate(doc),
          JSON.stringify(validate.errors?.slice(0, 2)),
        ).toBe(true);
      });
    }
  }
});

describe("traceJsonSchema rejects malformed documents", () => {
  const good = documents(EDGE_TRACES)["standard"] as Doc;
  const clone = (): Doc => JSON.parse(JSON.stringify(good));
  const goodSummary = documents(EDGE_TRACES)["summary"] as Doc;
  const cloneSummary = (): Doc => JSON.parse(JSON.stringify(goodSummary));
  const firstRun = (doc: Doc): Doc =>
    Object.values<any>(doc["items"])[0].runs[0];

  it("rejects a wrong format identifier", () => {
    expect(validate({ ...clone(), format: "domusops.trace/9.9" })).toBe(false);
  });

  it("rejects a document without a time zone", () => {
    const doc = clone();
    delete doc["time_zone"];
    expect(validate(doc)).toBe(false);
  });

  it("rejects a standard step that is not an array or a step object", () => {
    const doc = clone();
    firstRun(doc)["steps"].push("action/0");
    expect(validate(doc)).toBe(false);
    const other = clone();
    firstRun(other)["steps"].push({ path: "action/0", t: 1 });
    expect(validate(other)).toBe(false);
  });

  it("accepts the fallback step object, and rejects one without a path", () => {
    const doc = clone();
    firstRun(doc)["steps"].push({ step: { path: "action/0", t: 1 } });
    expect(validate(doc)).toBe(true);
    firstRun(doc)["steps"].push({ step: { t: 1 } });
    expect(validate(doc)).toBe(false);
  });

  it("rejects a run with both an outcome and a state, or with neither", () => {
    const both = clone();
    Object.assign(firstRun(both), {
      state: "stopped",
      script_execution: "finished",
    });
    expect(validate(both)).toBe(false);
    const neither = clone();
    delete firstRun(neither)["outcome"];
    delete firstRun(neither)["state"];
    delete firstRun(neither)["script_execution"];
    expect(validate(neither)).toBe(false);
  });

  it("rejects a run start that is not local time with an offset", () => {
    const doc = clone();
    firstRun(doc)["start"] = "2026-03-14T10:00:00Z";
    expect(validate(doc)).toBe(false);
  });

  it("rejects a summary row of the wrong shape, and wrong columns", () => {
    const row = cloneSummary();
    Object.values<any>(row["items"])[0].push(["only", "two"]);
    expect(validate(row)).toBe(false);
    const columns = cloneSummary();
    columns["columns"] = ["run"];
    expect(validate(columns)).toBe(false);
  });

  it("rejects an empty no_runs and an unknown key in it", () => {
    const empty = clone();
    empty["no_runs"] = {};
    expect(validate(empty)).toBe(false);
    const unknown = clone();
    unknown["no_runs"] = { nothing: ["x"] };
    expect(validate(unknown)).toBe(false);
  });
});
