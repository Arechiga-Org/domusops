import { describe, expect, it } from "vitest";
import { isInstant } from "../src/instance/handle.js";

describe("isInstant", () => {
  it.each([
    "2031-03-04T02:59:50Z",
    "2031-03-04T02:59:50.250Z",
    "2031-03-04T02:59:50+02:00",
    "2031-03-04T02:59",
    "2031-03-04 02:59:50",
    "2031-03-04T02:59:50-0500",
  ])("accepts %s", (value) => {
    expect(isInstant(value)).toBe(true);
  });

  it.each([
    "2031-03-04",
    "not a date",
    "",
    "March 4, 2031 02:59",
    "2031-02-31T00:00:00Z",
    "2031-03-04T25:00:00Z",
    "2031-03-04T02:59:50 and then some",
  ])("rejects %j", (value) => {
    expect(isInstant(value)).toBe(false);
  });

  it("rejects a value that is not a string", () => {
    expect(isInstant(1_900_000_000)).toBe(false);
    expect(isInstant(null)).toBe(false);
  });
});
