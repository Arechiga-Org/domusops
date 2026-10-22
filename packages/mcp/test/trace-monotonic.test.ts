import type { TraceExtendedRecord } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import {
  EDGE_TRACES,
  REFERENCE_TRACES,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { encodeRecords } from "./support/trace-helpers.js";

/**
 * `ha_trace` at `standard` stops reading as soon as the runs read so far already encode above the
 * size limit (specs/007-debt-paydown research R4). That is sound only if adding runs never makes
 * the document smaller. The comparison is made on the document with the ratio left at 0, which is
 * never longer than the document the tool finally emits.
 */
const sizeOf = (
  records: readonly TraceExtendedRecord[],
  fixture: TraceFixture,
): number =>
  Buffer.byteLength(
    JSON.stringify({
      ...encodeRecords(records, fixture).doc,
      compression_ratio: 0,
    }),
    "utf8",
  );

/** A small seeded generator, so a failure is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the standard trace document never shrinks as runs are added (research R4)", () => {
  it.each([
    ["the reference set", REFERENCE_TRACES],
    ["the edge-case set", EDGE_TRACES],
  ])("grows with every prefix of %s", (_name, fixture) => {
    let previous = 0;
    fixture.traces.forEach((_record, at) => {
      const size = sizeOf(fixture.traces.slice(0, at + 1), fixture);
      expect(size, `after ${at + 1} runs`).toBeGreaterThanOrEqual(previous);
      previous = size;
    });
  });

  it.each([
    ["the reference set", REFERENCE_TRACES, 11],
    ["the edge-case set", EDGE_TRACES, 29],
  ])(
    "is not larger for a random subset of %s than for the whole",
    (_name, fixture, seed) => {
      const random = seeded(seed);
      const whole = sizeOf(fixture.traces, fixture);
      for (let trial = 0; trial < 30; trial += 1) {
        const subset = fixture.traces.filter(() => random() < 0.5);
        expect(sizeOf(subset, fixture), `trial ${trial}`).toBeLessThanOrEqual(
          whole,
        );
      }
    },
  );

  it("is not larger for a subset than for any superset of it", () => {
    const random = seeded(7);
    const all = REFERENCE_TRACES.traces;
    for (let trial = 0; trial < 30; trial += 1) {
      const outer = all.filter(() => random() < 0.6);
      const inner = outer.filter(() => random() < 0.5);
      expect(
        sizeOf(inner, REFERENCE_TRACES),
        `trial ${trial}`,
      ).toBeLessThanOrEqual(sizeOf(outer, REFERENCE_TRACES));
    }
  });
});
