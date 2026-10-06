import { describe, expect, it } from "vitest";
import { ToolError, type ErrorKind } from "../src/errors.js";
import { parseWindowInput, resolveWindow } from "../src/logbook/window.js";

const TZ = "Europe/Madrid";
const NOW = Date.UTC(2026, 8, 26, 10, 0, 0);
const HOUR = 3_600_000;

function win(input: { start?: string; end?: string }, now = NOW) {
  return resolveWindow(parseWindowInput(input), now, TZ);
}

function kindOf(action: () => unknown): ErrorKind {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return (error as ToolError).kind;
  }
  throw new Error("expected a window_invalid error");
}

describe("defaults", () => {
  it("is the 24 hours ending at the time of the call", () => {
    const w = win({});
    expect(w.endMs).toBe(NOW);
    expect(w.startMs).toBe(NOW - 24 * HOUR);
    expect(w.endIso).toBe("2026-09-26T10:00:00.000Z");
    expect(w.startIso).toBe("2026-09-25T10:00:00.000Z");
  });

  it("starts 24 hours before an end that is given", () => {
    const w = win({ end: "2026-09-25T12:00:00Z" });
    expect(w.endMs).toBe(Date.UTC(2026, 8, 25, 12));
    expect(w.startMs).toBe(Date.UTC(2026, 8, 24, 12));
  });

  it("ends now when only a start is given", () => {
    const w = win({ start: "2026-09-25T00:00:00Z" });
    expect(w.startMs).toBe(Date.UTC(2026, 8, 25));
    expect(w.endMs).toBe(NOW);
  });

  it("defaults the start from the clamped end when only an end in the future is given", () => {
    // One hour ahead: the window is still 24 hours, ending now.
    const near = win({ end: "2026-09-26T11:00:00Z" });
    expect(near.endMs).toBe(NOW);
    expect(near.endMs - near.startMs).toBe(24 * HOUR);
    // Two days ahead: not an error about a start the caller never gave.
    const far = win({ end: "2026-09-28T00:00:00Z" });
    expect(far.endMs).toBe(NOW);
    expect(far.startMs).toBe(NOW - 24 * HOUR);
  });

  it("clamps an end after the time of the call to it", () => {
    const w = win({
      start: "2026-09-25T00:00:00Z",
      end: "2099-01-01T00:00:00Z",
    });
    expect(w.endMs).toBe(NOW);
  });
});

describe("time zones", () => {
  it("reads a time without an offset in the instance time zone, winter and summer", () => {
    expect(
      win({ start: "2026-01-15T10:00", end: "2026-01-15T12:00" }).startMs,
    ).toBe(Date.UTC(2026, 0, 15, 9));
    expect(
      win({ start: "2026-07-15T10:00", end: "2026-07-15T12:00" }).startMs,
    ).toBe(Date.UTC(2026, 6, 15, 8));
  });

  it("honours an explicit Z or offset", () => {
    expect(
      win({ start: "2026-07-15T10:00:00Z", end: "2026-07-15T12:00:00Z" })
        .startMs,
    ).toBe(Date.UTC(2026, 6, 15, 10));
    expect(
      win({
        start: "2026-07-15T10:00:00-05:00",
        end: "2026-07-15T20:00:00-05:00",
      }).startMs,
    ).toBe(Date.UTC(2026, 6, 15, 15));
  });

  it("accepts the extreme real offsets, +14:00 and -12:00", () => {
    expect(
      win({ start: "2026-07-15T10:00+14:00", end: "2026-07-15T12:00Z" })
        .startMs,
    ).toBe(Date.UTC(2026, 6, 14, 20));
    expect(
      win({ start: "2026-07-15T10:00-12:00", end: "2026-07-15T23:00Z" })
        .startMs,
    ).toBe(Date.UTC(2026, 6, 15, 22));
  });

  it("accepts seconds and fractional seconds", () => {
    const w = win({
      start: "2026-09-25T10:00:00.250Z",
      end: "2026-09-25T10:00:05Z",
    });
    expect(w.startMs).toBe(Date.UTC(2026, 8, 25, 10, 0, 0, 250));
    expect(w.endMs).toBe(Date.UTC(2026, 8, 25, 10, 0, 5));
  });

  it("moves a time in a daylight-saving gap forward by the gap", () => {
    // 2026-03-29 02:00 becomes 03:00 in Europe/Madrid: 02:30 does not exist.
    const w = win({ start: "2026-03-29T02:30", end: "2026-03-29T05:00" });
    expect(w.startMs).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });

  it("resolves a time that occurs twice to the earlier instant", () => {
    // 2026-10-25 03:00 becomes 02:00: 02:30 occurs at 00:30Z and again at 01:30Z.
    const w = win(
      { start: "2026-10-25T02:30", end: "2026-10-25T05:00" },
      Date.UTC(2026, 10, 1),
    );
    expect(w.startMs).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });
});

describe("invalid windows", () => {
  it.each([
    "not-a-date",
    "2026-13-01",
    "2026-13-01T00:00",
    "2026-02-30T00:00",
    "2026-09-25T25:00",
    "2026-09-25T10:60",
    "2026-09-25 10:00",
    "2026-09-25T10:00+0200",
    "2026-09-25T10:00+99:99",
    "2026-09-25T10:00+05:60",
    "2026-09-25T10:00+14:01",
    "2026-09-25T10:00-15:00",
    "0026-09-25T10:00",
    "1969-12-31T23:59Z",
    "",
  ])("rejects %j at the syntax check, before any connection", (text) => {
    expect(kindOf(() => parseWindowInput({ start: text }))).toBe(
      "window_invalid",
    );
    expect(kindOf(() => parseWindowInput({ end: text }))).toBe(
      "window_invalid",
    );
  });

  it("rejects an end that is not after the start", () => {
    expect(
      kindOf(() =>
        win({ start: "2026-09-25T10:00:00Z", end: "2026-09-25T10:00:00Z" }),
      ),
    ).toBe("window_invalid");
    expect(
      kindOf(() =>
        win({ start: "2026-09-25T10:00:00Z", end: "2026-09-25T09:00:00Z" }),
      ),
    ).toBe("window_invalid");
  });

  it("rejects a start after the time of the call", () => {
    expect(kindOf(() => win({ start: "2026-09-27T00:00:00Z" }))).toBe(
      "window_invalid",
    );
  });

  it("names the problem and the accepted form", () => {
    try {
      parseWindowInput({ start: "yesterday" });
    } catch (error) {
      const text = (error as ToolError).toToolText("ha_logbook_query");
      expect(text).toContain("yesterday");
      expect(text).toContain("2026-09-26T03:00");
      return;
    }
    throw new Error("expected an error");
  });
});
