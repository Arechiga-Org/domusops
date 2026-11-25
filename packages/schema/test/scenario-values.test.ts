import { describe, expect, it } from "vitest";
import {
  isAction,
  isActionPattern,
  isCalendarDate,
  isEntityId,
  isScenarioName,
  parseDuration,
  parseInstant,
  parseTimeOfDay,
} from "../src/index.js";

describe("scenario values", () => {
  it("accepts entity IDs and actions of lower-case words", () => {
    expect(isEntityId("light.hallway_2")).toBe(true);
    expect(isEntityId("Light.hallway")).toBe(false);
    expect(isEntityId("light")).toBe(false);
    expect(isEntityId("light.a.b")).toBe(false);
    expect(isAction("light.turn_on")).toBe(true);
    expect(isAction("turn_on")).toBe(false);
    expect(isAction("media_player.*")).toBe(false);
    expect(isActionPattern("media_player.*")).toBe(true);
    expect(isActionPattern("notify.mobile_app_phone")).toBe(true);
    expect(isActionPattern(".*")).toBe(false);
    expect(isActionPattern("a.b.*")).toBe(false);
  });

  it("limits names to 64 lower-case characters starting with a letter or digit", () => {
    expect(isScenarioName("hallway_night_motion")).toBe(true);
    expect(isScenarioName("_hidden")).toBe(false);
    expect(isScenarioName("a".repeat(64))).toBe(true);
    expect(isScenarioName("a".repeat(65))).toBe(false);
    expect(isScenarioName("Upper")).toBe(false);
  });

  it("reads durations in every written form, above 0 and up to 7 days", () => {
    expect(parseDuration(90)).toBe(90);
    expect(parseDuration("00:04:00")).toBe(240);
    expect(parseDuration("01:30")).toBe(5400);
    expect(parseDuration({ hours: 1, minutes: 1, seconds: 1 })).toBe(3661);
    expect(parseDuration({ minutes: 5 })).toBe(300);
    expect(parseDuration({ hours: 48 })).toBe(172800);
    expect(parseDuration(604800)).toBe(604800);
    expect(parseDuration(0)).toBeNull();
    expect(parseDuration(-1)).toBeNull();
    expect(parseDuration(604801)).toBeNull();
    expect(parseDuration("48:00:00")).toBe(172800);
    expect(parseDuration("168:00:00")).toBe(604800);
    expect(parseDuration("168:00:01")).toBeNull();
    expect(parseDuration("24:00")).toBeNull();
    expect(parseDuration("1000:00:00")).toBeNull();
    expect(parseDuration("00:61")).toBeNull();
    expect(parseDuration({})).toBeNull();
    expect(parseDuration({ days: 1 })).toBeNull();
    expect(parseDuration({ hours: -1, minutes: 90 })).toBeNull();
    expect(parseDuration(Number.NaN)).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });

  it("reads a time of day as HH:MM:SS, 24-hour", () => {
    expect(parseTimeOfDay("03:00")).toBe("03:00:00");
    expect(parseTimeOfDay("23:59:59")).toBe("23:59:59");
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("7:00")).toBeNull();
    expect(parseTimeOfDay("07:60")).toBeNull();
    expect(parseTimeOfDay(300)).toBeNull();
  });

  it("accepts only real calendar days", () => {
    expect(isCalendarDate("2026-04-15")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-4-5")).toBe(false);
  });

  it("reads instants with or without seconds", () => {
    expect(parseInstant("2026-04-15T07:00")).toBe("2026-04-15T07:00:00");
    expect(parseInstant("2026-04-15T07:00:30")).toBe("2026-04-15T07:00:30");
    expect(parseInstant("2026-02-30T07:00")).toBeNull();
    expect(parseInstant("2026-04-15 07:00")).toBeNull();
    expect(parseInstant("2026-04-15T25:00")).toBeNull();
  });
});
