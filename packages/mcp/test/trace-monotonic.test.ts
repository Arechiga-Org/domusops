import type { TraceExtendedRecord } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { sizeFloor } from "../src/trace/size.js";
import {
  EDGE_TRACES,
  PERFORMANCE_TRACES,
  REFERENCE_TRACES,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { encodeRecords } from "./support/trace-helpers.js";

/**
 * `ha_trace` at `standard` stops reading as soon as the runs read so far already encode above the
 * size limit (specs/007-debt-paydown research R4). That is sound only if the floor of a partial
 * result is never above the document actually emitted for any larger set of runs. Adding runs can
 * move strings to lower table indexes, so the plain size is not monotonic; the floor allows for it.
 */
const floorOf = (
  records: readonly TraceExtendedRecord[],
  fixture: TraceFixture,
): number => sizeFloor(encodeRecords(records, fixture).doc);

const emittedBytes = (
  records: readonly TraceExtendedRecord[],
  fixture: TraceFixture,
): number => Buffer.byteLength(encodeRecords(records, fixture).text, "utf8");

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

describe("the floor of a partial standard result never exceeds the emitted whole (research R4)", () => {
  it.each([
    ["the reference set", REFERENCE_TRACES],
    ["the edge-case set", EDGE_TRACES],
  ])("holds for every prefix of %s", (_name, fixture) => {
    const whole = emittedBytes(fixture.traces, fixture);
    fixture.traces.forEach((_record, at) => {
      expect(
        floorOf(fixture.traces.slice(0, at + 1), fixture),
        `after ${at + 1} runs`,
      ).toBeLessThanOrEqual(whole);
    });
  });

  it("holds for every prefix of the 500-run set, at the chunk boundaries the tool checks", () => {
    const fixture = PERFORMANCE_TRACES;
    const whole = emittedBytes(fixture.traces, fixture);
    for (const n of [8, 24, 56, 120, 248]) {
      expect(floorOf(fixture.traces.slice(0, n), fixture)).toBeLessThanOrEqual(
        whole,
      );
    }
  });

  it.each([
    ["the reference set", REFERENCE_TRACES, 11],
    ["the edge-case set", EDGE_TRACES, 29],
  ])(
    "holds for a random subset of %s against the whole",
    (_name, fixture, seed) => {
      const random = seeded(seed);
      const whole = emittedBytes(fixture.traces, fixture);
      for (let trial = 0; trial < 30; trial += 1) {
        const subset = fixture.traces.filter(() => random() < 0.5);
        expect(floorOf(subset, fixture), `trial ${trial}`).toBeLessThanOrEqual(
          whole,
        );
      }
    },
  );

  it("holds for a subset against any superset of it", () => {
    const random = seeded(7);
    const all = REFERENCE_TRACES.traces;
    for (let trial = 0; trial < 30; trial += 1) {
      const outer = all.filter(() => random() < 0.6);
      const inner = outer.filter(() => random() < 0.5);
      expect(
        floorOf(inner, REFERENCE_TRACES),
        `trial ${trial}`,
      ).toBeLessThanOrEqual(emittedBytes(outer, REFERENCE_TRACES));
    }
  });

  it("is never above the plain size of the same runs", () => {
    const small = REFERENCE_TRACES.traces.slice(0, 3);
    const doc = encodeRecords(small, REFERENCE_TRACES).doc;
    expect(sizeFloor(doc)).toBeLessThanOrEqual(
      Buffer.byteLength(JSON.stringify({ ...doc, compression_ratio: 0 })),
    );
  });
});
