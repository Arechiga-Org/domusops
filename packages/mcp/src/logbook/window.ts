import { errors } from "../errors.js";
import { zonedToInstant, type LocalTime } from "./local-time.js";

/** `YYYY-MM-DDTHH:MM[:SS[.fff]]`, optionally followed by `Z` or `±HH:MM`. */
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/;

export interface ParsedTime {
  local: LocalTime;
  /** Minutes east of UTC, or null when the timestamp had no offset. */
  offsetMinutes: number | null;
}

export interface ParsedWindow {
  start: ParsedTime | null;
  end: ParsedTime | null;
}

export interface ResolvedWindow {
  startMs: number;
  endMs: number;
  /** UTC ISO 8601, for the instance call. */
  startIso: string;
  endIso: string;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseTime(text: string, which: "start" | "end"): ParsedTime {
  const m = TIMESTAMP.exec(text);
  if (m === null) {
    throw errors.windowInvalid(
      `${which} "${text}" is not an ISO 8601 timestamp`,
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millisecond =
    m[7] === undefined ? 0 : Math.floor(Number(`0.${m[7]}`) * 1000);
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59;
  if (!valid) {
    throw errors.windowInvalid(
      `${which} "${text}" is not a real date and time`,
    );
  }
  let offsetMinutes: number | null = null;
  if (m[8] !== undefined) {
    if (m[8] === "Z") offsetMinutes = 0;
    else {
      const sign = m[8].startsWith("-") ? -1 : 1;
      offsetMinutes =
        sign * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(4, 6)));
    }
  }
  return {
    local: { year, month, day, hour, minute, second, millisecond },
    offsetMinutes,
  };
}

/** Checks the syntax of the requested window. Needs no connection. */
export function parseWindowInput(input: {
  start?: string;
  end?: string;
}): ParsedWindow {
  return {
    start: input.start === undefined ? null : parseTime(input.start, "start"),
    end: input.end === undefined ? null : parseTime(input.end, "end"),
  };
}

function toInstant(time: ParsedTime, timeZone: string): number {
  if (time.offsetMinutes === null) return zonedToInstant(time.local, timeZone);
  const { year, month, day, hour, minute, second, millisecond } = time.local;
  return (
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
    time.offsetMinutes * 60_000
  );
}

/**
 * Applies the defaults (the 24 hours ending at `nowMs`), reads offset-less times in the instance
 * time zone, clamps an end after `nowMs` to it, and checks the order (research R3).
 */
export function resolveWindow(
  parsed: ParsedWindow,
  nowMs: number,
  timeZone: string,
): ResolvedWindow {
  const day = 86_400_000;
  const requestedEnd =
    parsed.end === null ? nowMs : toInstant(parsed.end, timeZone);
  const endMs = Math.min(requestedEnd, nowMs);
  const startMs =
    parsed.start === null
      ? requestedEnd - day
      : toInstant(parsed.start, timeZone);
  if (startMs > nowMs) {
    throw errors.windowInvalid("the start is in the future");
  }
  if (endMs <= startMs) {
    throw errors.windowInvalid("the end is not after the start");
  }
  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}
