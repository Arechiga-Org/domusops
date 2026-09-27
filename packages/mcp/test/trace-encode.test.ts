import {
  expandTrace,
  parseIsoMicros,
  type TraceExtendedRecord,
  type TraceStandardDocument,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import {
  EDGE_TRACES,
  PERFORMANCE_TRACES,
  REFERENCE_TRACES,
  TRACES_EMPTY,
} from "./fixtures/generate-traces.js";
import { encodeRecords, sortKeys } from "./support/trace-helpers.js";

const ratioOf = (text: string): number =>
  (JSON.parse(text) as { compression_ratio: number }).compression_ratio;

const reference = encodeRecords(REFERENCE_TRACES.traces, REFERENCE_TRACES);

describe("compression floor (spec FR-019, SC-001)", () => {
  it("meets the floor of 3 on the reference set", () => {
    expect(ratioOf(reference.text)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the reference set calibrated to the live measurements (research R5, R6)", () => {
    // Live: 3.07 on all 92 stored traces of the maintainer's instance (2026-09-26). Adjust the generator, not this range.
    expect(ratioOf(reference.text)).toBeGreaterThanOrEqual(3.05);
    expect(ratioOf(reference.text)).toBeLessThanOrEqual(3.4);
  });

  it("reports the ratio of the performance set, above the floor too", () => {
    const perf = encodeRecords(PERFORMANCE_TRACES.traces, PERFORMANCE_TRACES);
    expect(ratioOf(perf.text)).toBeGreaterThanOrEqual(3);
  });
});

describe("determinism (data-model §3.4)", () => {
  it("gives byte-identical output for identical input", () => {
    const again = encodeRecords(REFERENCE_TRACES.traces, REFERENCE_TRACES);
    expect(again.text).toBe(reference.text);
  });

  it("does not depend on the order the records arrive in", () => {
    const reversed = [...REFERENCE_TRACES.traces].reverse();
    expect(encodeRecords(reversed, REFERENCE_TRACES).text).toBe(reference.text);
  });
});

/** Every reference of a document resolves (data-model §9, invariant 4). */
function checkReferences(doc: TraceStandardDocument): void {
  const strings = doc.strings ?? [];
  const values = doc.values ?? [];
  const walk = (node: unknown, inValues: number): void => {
    if (typeof node === "string") {
      if (node.startsWith("#")) {
        expect(Number(node.slice(1))).toBeLessThan(strings.length);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, inValues));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === "v") return;
    if (keys.length === 1 && keys[0] === "$") {
      const at = (node as { $: number }).$;
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(inValues < 0 ? values.length : inValues);
      return;
    }
    for (const value of Object.values(node)) walk(value, inValues);
  };
  values.forEach((entry, at) => walk(entry, at));
  walk(doc.configs, -1);
  for (const item of Object.values(doc.items)) {
    if (item.this !== undefined) walk(item.this.attributes, -1);
    for (const run of item.runs) {
      if (run.config !== null)
        expect(run.config).toBeLessThan(doc.configs.length);
      walk(run.blueprint_inputs, -1);
      for (const step of run.steps) walk(step, -1);
    }
  }
}

describe("references and orders (data-model §3.1, §3.3)", () => {
  it("resolves every reference on every fixture", () => {
    for (const f of [REFERENCE_TRACES, EDGE_TRACES, PERFORMANCE_TRACES]) {
      checkReferences(encodeRecords(f.traces, f).doc);
    }
  });

  it("orders items by their newest run, then runs newest first", () => {
    const { doc } = encodeRecords(EDGE_TRACES.traces, EDGE_TRACES);
    const starts = Object.values(doc.items).map((item) =>
      item.runs.map((r) => Date.parse(r.start)),
    );
    for (const list of starts) {
      expect([...list].sort((a, b) => b - a)).toEqual(list);
    }
    const newest = starts.map((list) => list[0] as number);
    expect([...newest].sort((a, b) => b - a)).toEqual(newest);
  });

  it("emits steps in time order with recorded order for ties", () => {
    const { doc } = encodeRecords(EDGE_TRACES.traces, EDGE_TRACES);
    for (const item of Object.values(doc.items)) {
      for (const run of item.runs) {
        if (run.steps_order !== undefined) continue;
        const times = run.steps.map((s) =>
          Array.isArray(s) ? (s[1] as number) : (s.step["t"] as number),
        );
        expect([...times].sort((a, b) => a - b)).toEqual(times);
      }
    }
  });

  it("falls back to recorded order when the clock stepped backwards, and still round-trips", () => {
    const { doc } = encodeRecords(EDGE_TRACES.traces, EDGE_TRACES);
    const flagged = Object.values(doc.items)
      .flatMap((i) => i.runs)
      .filter((r) => r.steps_order === "recorded");
    expect(flagged.length).toBeGreaterThan(0);
    const back = expandTrace(JSON.parse(JSON.stringify(doc)));
    const run = back.find(
      (r) => r.run_id === flagged[0]?.run,
    ) as TraceExtendedRecord;
    const raw = EDGE_TRACES.traces.find(
      (t) => t.run_id === run.run_id,
    ) as TraceExtendedRecord;
    expect(Object.keys(run.trace)).toEqual(Object.keys(raw.trace));
    expect(sortKeys(run.trace)).toEqual(sortKeys(raw.trace));
  });

  it("emits last_step only when it differs from the last path of the map", () => {
    const { doc } = encodeRecords(EDGE_TRACES.traces, EDGE_TRACES);
    for (const run of Object.values(doc.items).flatMap((i) => i.runs)) {
      expect(run.last_step).toBeUndefined();
    }
    const odd = structuredClone(
      REFERENCE_TRACES.traces[0],
    ) as TraceExtendedRecord;
    odd.last_step = "action/9";
    const encoded = encodeRecords([odd], REFERENCE_TRACES).doc;
    expect(Object.values(encoded.items)[0]?.runs[0]?.last_step).toBe(
      "action/9",
    );
    const back = expandTrace(JSON.parse(JSON.stringify(encoded)));
    expect(back[0]?.last_step).toBe("action/9");
  });
});

describe("outcomes", () => {
  const runsOf = (records: TraceExtendedRecord[]) =>
    Object.values(encodeRecords(records, EDGE_TRACES).doc.items).flatMap(
      (i) => i.runs,
    );

  it("gives a running run no duration and the outcome running", () => {
    const running = EDGE_TRACES.traces.find(
      (t) => t.state === "running",
    ) as TraceExtendedRecord;
    const [run] = runsOf([running]);
    expect(run?.outcome).toBe("running");
    expect(run?.duration_ms).toBeUndefined();
  });

  it("emits the stop reason as the outcome, and not-triggered as its own", () => {
    const outcomes = new Set(runsOf(EDGE_TRACES.traces).map((r) => r.outcome));
    for (const wanted of [
      "finished",
      "failed_conditions",
      "error",
      "not_triggered",
      "running",
    ]) {
      expect(outcomes).toContain(wanted);
    }
  });

  it("emits state and script_execution when they are not a plain pair", () => {
    const odd = structuredClone(EDGE_TRACES.traces[0]) as TraceExtendedRecord;
    odd.state = "stopped";
    odd.script_execution = null;
    const [run] = runsOf([odd]);
    expect(run?.outcome).toBeUndefined();
    expect(run?.state).toBe("stopped");
    expect(run?.script_execution).toBeNull();
    const back = expandTrace(
      JSON.parse(JSON.stringify(encodeRecords([odd], EDGE_TRACES).doc)),
    );
    expect(back[0]?.state).toBe("stopped");
    expect(back[0]?.script_execution).toBeNull();
  });

  it("counts not-triggered traces apart from runs", () => {
    const { doc } = encodeRecords(EDGE_TRACES.traces, EDGE_TRACES);
    const notTriggered = EDGE_TRACES.traces.filter(
      (t) => t.not_triggered === true,
    ).length;
    expect(doc.counts.not_triggered).toBe(notTriggered);
    expect(doc.counts.runs).toBe(EDGE_TRACES.traces.length - notTriggered);
  });
});

describe("unknown keys (data-model §1)", () => {
  it("keeps an unknown key of the extended record in `extra`", () => {
    const record = structuredClone(
      REFERENCE_TRACES.traces[0],
    ) as TraceExtendedRecord;
    (record as Record<string, unknown>)["new_key"] = { a: 1 };
    const doc = encodeRecords([record], REFERENCE_TRACES).doc;
    expect(Object.values(doc.items)[0]?.runs[0]?.extra).toEqual({
      new_key: { a: 1 },
    });
    expect(expandTrace(JSON.parse(JSON.stringify(doc)))[0]).toEqual(
      expect.objectContaining({ new_key: { a: 1 } }),
    );
  });

  it("emits a step with an unknown key as an object", () => {
    const record = structuredClone(
      REFERENCE_TRACES.traces[0],
    ) as TraceExtendedRecord;
    const firstPath = Object.keys(record.trace)[0] as string;
    (record.trace[firstPath]?.[0] as Record<string, unknown>)["future"] = true;
    const doc = encodeRecords([record], REFERENCE_TRACES).doc;
    const steps = Object.values(doc.items)[0]?.runs[0]?.steps ?? [];
    expect(steps.some((s) => !Array.isArray(s))).toBe(true);
    const back = expandTrace(
      JSON.parse(JSON.stringify(doc)),
    )[0] as TraceExtendedRecord;
    expect(sortKeys(back.trace)).toEqual(sortKeys(record.trace));
  });

  it("keeps a step path that looks like one of the format's forms", () => {
    const record = structuredClone(
      REFERENCE_TRACES.traces[0],
    ) as TraceExtendedRecord;
    const [path] = Object.keys(record.trace) as [string];
    const list = record.trace[path] as NonNullable<
      TraceExtendedRecord["trace"][string]
    >;
    delete record.trace[path];
    record.trace["#odd"] = list.map((s) => ({ ...s, path: "#odd" }));
    record.last_step = Object.keys(record.trace).at(-1) as string;
    const doc = encodeRecords([record], REFERENCE_TRACES).doc;
    const back = expandTrace(
      JSON.parse(JSON.stringify(doc)),
    )[0] as TraceExtendedRecord;
    expect(sortKeys(back.trace)).toEqual(sortKeys(record.trace));
  });
});

describe("shape of the output", () => {
  it("references a configuration once for the runs of an item, and shares it", () => {
    const { doc } = encodeRecords(REFERENCE_TRACES.traces, REFERENCE_TRACES);
    expect(doc.configs.length).toBeLessThan(REFERENCE_TRACES.traces.length);
    for (const item of Object.values(doc.items)) {
      const used = new Set(item.runs.map((r) => r.config));
      expect(used.size).toBe(1);
    }
  });

  it("gives a run's start in local time with the offset, exactly", () => {
    const { doc } = encodeRecords(REFERENCE_TRACES.traces, REFERENCE_TRACES);
    for (const run of Object.values(doc.items).flatMap((i) => i.runs)) {
      expect(run.start).toMatch(
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?[+-]\d\d:\d\d$/,
      );
    }
    const raw = REFERENCE_TRACES.traces[0] as TraceExtendedRecord;
    const [first] = expandTrace(
      JSON.parse(JSON.stringify(encodeRecords([raw], REFERENCE_TRACES).doc)),
    );
    expect(parseIsoMicros(first?.timestamp.start ?? "")).toBe(
      parseIsoMicros(raw.timestamp.start),
    );
  });

  it("yields a valid empty document", () => {
    const { doc, text } = encodeRecords(TRACES_EMPTY.traces, TRACES_EMPTY);
    expect(doc.items).toEqual({});
    expect(doc.configs).toEqual([]);
    expect(doc.counts).toEqual({ items: 0, runs: 0, not_triggered: 0 });
    expect(ratioOf(text)).toBeGreaterThan(0);
    expect(ratioOf(text)).toBeLessThan(1);
  });

  it("names the format and the time zone", () => {
    expect(reference.doc.format).toBe("domusops.trace/0.1");
    expect(reference.doc.detail).toBe("standard");
    expect(reference.doc.time_zone).toBe("Europe/Madrid");
    expect(reference.doc.utc_offset).toMatch(/^[+-]\d\d:\d\d$/);
  });
});
