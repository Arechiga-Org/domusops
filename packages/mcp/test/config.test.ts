import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGBOOK_LIMIT,
  DEFAULT_STATE_LIMIT,
  DEFAULT_TRACE_LIMIT,
  readLogbookLimit,
  readStateLimit,
  readTraceLimit,
} from "../src/ha/config.js";

describe.each([
  ["DOMUSOPS_LOGBOOK_MAX_BYTES", readLogbookLimit, DEFAULT_LOGBOOK_LIMIT],
  ["DOMUSOPS_TRACE_MAX_BYTES", readTraceLimit, DEFAULT_TRACE_LIMIT],
  ["DOMUSOPS_STATE_MAX_BYTES", readStateLimit, DEFAULT_STATE_LIMIT],
])("%s", (variable, read, fallback) => {
  it("defaults to 100000 when unset or empty", () => {
    expect(fallback).toBe(100_000);
    expect(read({})).toBe(fallback);
    expect(read({ [variable]: "  " })).toBe(fallback);
  });

  it("accepts a positive whole number", () => {
    expect(read({ [variable]: "2500" })).toBe(2500);
  });

  it.each(["zero", "-5", "1.5", "0", "1e3"])("rejects %s", (value) => {
    expect(() => read({ [variable]: value })).toThrowError(variable);
  });
});

describe("the two limits are independent", () => {
  it("does not read one variable for the other", () => {
    const env = { DOMUSOPS_LOGBOOK_MAX_BYTES: "1000" };
    expect(readTraceLimit(env)).toBe(DEFAULT_TRACE_LIMIT);
    expect(readLogbookLimit({ DOMUSOPS_TRACE_MAX_BYTES: "1000" })).toBe(
      DEFAULT_LOGBOOK_LIMIT,
    );
  });

  it("does not read the logbook or trace variable for the state limit", () => {
    expect(
      readStateLimit({
        DOMUSOPS_LOGBOOK_MAX_BYTES: "1000",
        DOMUSOPS_TRACE_MAX_BYTES: "1000",
      }),
    ).toBe(DEFAULT_STATE_LIMIT);
    expect(readTraceLimit({ DOMUSOPS_STATE_MAX_BYTES: "1000" })).toBe(
      DEFAULT_TRACE_LIMIT,
    );
  });
});
