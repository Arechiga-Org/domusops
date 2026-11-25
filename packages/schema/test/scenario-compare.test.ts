import { describe, expect, it } from "vitest";
import { compareValue, type Comparison } from "../src/index.js";

const ok = { ok: true };

describe("compareValue (research R10)", () => {
  it("compares numbers and text that reads as a number as numbers", () => {
    expect(compareValue({ eq: 15 }, "15")).toEqual(ok);
    expect(compareValue({ eq: "15" }, 15)).toEqual(ok);
    expect(compareValue({ eq: 15 }, 15.0)).toEqual(ok);
    expect(compareValue({ eq: "15.0" }, "15")).toEqual(ok);
    expect(compareValue({ eq: 15 }, "16")).toEqual({ ok: false });
    expect(compareValue({ eq: "1e2" }, 100)).toEqual(ok);
  });

  it("compares anything else as text, booleans as true and false", () => {
    expect(compareValue({ eq: "on" }, "on")).toEqual(ok);
    expect(compareValue({ eq: "on" }, "off")).toEqual({ ok: false });
    expect(compareValue({ eq: "on" }, true)).toEqual({ ok: false });
    expect(compareValue({ eq: true }, true)).toEqual(ok);
    expect(compareValue({ eq: true }, "true")).toEqual(ok);
    expect(compareValue({ eq: "15 W" }, 15)).toEqual({ ok: false });
  });

  it("lets null match an absent or null value, and only that", () => {
    expect(compareValue({ eq: null }, undefined)).toEqual(ok);
    expect(compareValue({ eq: null }, null)).toEqual(ok);
    expect(compareValue({ eq: null }, "")).toEqual({ ok: false });
    expect(compareValue({ eq: "on" }, undefined)).toEqual({ ok: false });
    expect(compareValue({ not: "on" }, undefined)).toEqual(ok);
  });

  it("compares lists and objects as JSON, lists in order", () => {
    expect(compareValue({ eq: [1, 2] }, [1, 2])).toEqual(ok);
    expect(compareValue({ eq: [1, 2] }, [2, 1])).toEqual({ ok: false });
    expect(compareValue({ eq: { a: 1, b: 2 } }, { b: 2, a: 1 })).toEqual(ok);
    expect(compareValue({ eq: [1] }, "1")).toEqual({ ok: false });
  });

  it("applies not and in with the same equality", () => {
    expect(compareValue({ not: 15 }, "15")).toEqual({ ok: false });
    expect(compareValue({ not: "on" }, "off")).toEqual(ok);
    expect(compareValue({ in: ["heat", "auto"] }, "auto")).toEqual(ok);
    expect(compareValue({ in: [1, 2] }, "2")).toEqual(ok);
    expect(compareValue({ in: ["heat"] }, "cool")).toEqual({ ok: false });
  });

  it("checks bounds inclusively and only on numbers", () => {
    expect(compareValue({ at_least: 100 }, "100")).toEqual(ok);
    expect(compareValue({ at_least: 100 }, 99.9)).toEqual({ ok: false });
    expect(compareValue({ at_most: 5 }, 5)).toEqual(ok);
    expect(compareValue({ at_most: 5 }, 6)).toEqual({ ok: false });
    expect(compareValue({ between: [19, 22] }, 19)).toEqual(ok);
    expect(compareValue({ between: [19, 22] }, "22")).toEqual(ok);
    expect(compareValue({ between: [19, 22] }, 22.5)).toEqual({ ok: false });
  });

  it("reports not_a_number when the actual value is not one", () => {
    const comparisons: Comparison[] = [
      { at_least: 1 },
      { at_most: 1 },
      { between: [0, 2] },
    ];
    for (const comparison of comparisons) {
      for (const actual of ["unavailable", true, null, undefined, [1], {}]) {
        expect(compareValue(comparison, actual)).toEqual({
          ok: false,
          reason: "not_a_number",
        });
      }
    }
  });
});
