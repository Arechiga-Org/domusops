import { describe, expect, it } from "vitest";
import {
  RELEASE_RE,
  compareReleases,
  compareSeries,
  isChannel,
  parseRelease,
  type ParsedRelease,
} from "../src/release/versions.js";

function p(release: string): ParsedRelease {
  const parsed = parseRelease(release);
  if (parsed === null) throw new Error(`bad release ${release}`);
  return parsed;
}

describe("release strings", () => {
  it.each(["2026.10.1", "2026.9.3", "2026.11.0b2", "2025.1.0", "2026.10.12"])(
    "accepts %s",
    (release) => {
      expect(RELEASE_RE.test(release)).toBe(true);
      expect(parseRelease(release)).not.toBeNull();
    },
  );

  it.each([
    "",
    "stable",
    "2026.10",
    "2026.10.1.1",
    "26.10.1",
    "2026.10.1rc1",
    "2026.10.1b",
    "v2026.10.1",
    " 2026.10.1",
    "2026.10.1\n",
    "2026.123.1",
  ])("rejects %j", (release) => {
    expect(RELEASE_RE.test(release)).toBe(false);
    expect(parseRelease(release)).toBeNull();
  });

  it("parses the parts", () => {
    expect(parseRelease("2026.11.0b2")).toEqual({
      year: 2026,
      month: 11,
      patch: 0,
      beta: 2,
    });
    expect(parseRelease("2026.9.3")?.beta).toBeNull();
  });
});

describe("ordering", () => {
  it("orders numerically, not as text", () => {
    expect(compareReleases(p("2026.9.3"), p("2026.10.0b1"))).toBeLessThan(0);
    expect(compareReleases(p("2026.10.2"), p("2026.10.10"))).toBeLessThan(0);
  });

  it("puts a beta before its final release", () => {
    expect(compareReleases(p("2026.10.0b3"), p("2026.10.0"))).toBeLessThan(0);
    expect(compareReleases(p("2026.10.0"), p("2026.10.0b3"))).toBeGreaterThan(
      0,
    );
  });

  it("orders betas by number", () => {
    expect(compareReleases(p("2026.11.0b2"), p("2026.11.0b10"))).toBeLessThan(
      0,
    );
  });

  it("treats equal releases as equal", () => {
    expect(compareReleases(p("2026.10.1"), p("2026.10.1"))).toBe(0);
  });

  it("compares month series across a year boundary", () => {
    expect(compareSeries(p("2025.12.4"), p("2026.1.0"))).toBeLessThan(0);
    expect(compareSeries(p("2026.10.1"), p("2026.10.9"))).toBe(0);
  });
});

describe("channels", () => {
  it("recognises the three channel names only", () => {
    expect(isChannel("stable")).toBe(true);
    expect(isChannel("previous-stable")).toBe(true);
    expect(isChannel("beta")).toBe(true);
    expect(isChannel("dev")).toBe(false);
    expect(isChannel("exact")).toBe(false);
  });
});
