/** Wall-clock time in an IANA zone, from `Intl` alone (no dependency). */
export interface LocalParts {
  /** `YYYY-MM-DD` */
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes east of UTC at that instant. */
  offsetMinutes: number;
}

/** A local wall-clock time with no zone attached. */
export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function localParts(epochMs: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const year = parts["year"] as number;
  const month = parts["month"] as number;
  const day = parts["day"] as number;
  const hour = parts["hour"] as number;
  const minute = parts["minute"] as number;
  const second = parts["second"] as number;
  const wholeSecondMs = Math.floor(epochMs / 1000) * 1000;
  const offsetMs =
    Date.UTC(year, month - 1, day, hour, minute, second) - wholeSecondMs;
  return {
    date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
    offsetMinutes: Math.round(offsetMs / 60_000),
  };
}

/** `±HH:MM` */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `YYYY-MM-DDTHH:MM:SS`, with the offset appended when it differs from `baseOffsetMinutes`. */
export function formatLocalIso(
  epochMs: number,
  timeZone: string,
  baseOffsetMinutes: number | null,
): string {
  const p = localParts(epochMs, timeZone);
  const text = `${p.date}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  return baseOffsetMinutes !== null && p.offsetMinutes === baseOffsetMinutes
    ? text
    : `${text}${formatOffset(p.offsetMinutes)}`;
}

/**
 * Resolves a local time in a zone to an instant. A time that does not exist (the gap of a
 * daylight-saving change) moves forward by the gap; a time that occurs twice resolves to the
 * earlier instant.
 */
export function zonedToInstant(local: LocalTime, timeZone: string): number {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond,
  );
  const day = 86_400_000;
  const before = localParts(naive - day, timeZone).offsetMinutes * 60_000;
  const after = localParts(naive + day, timeZone).offsetMinutes * 60_000;
  const valid = [before, after]
    .map((offset) => ({ offset, instant: naive - offset }))
    .filter(
      ({ offset, instant }) =>
        localParts(instant, timeZone).offsetMinutes * 60_000 === offset,
    )
    .map(({ instant }) => instant);
  if (valid.length > 0) return Math.min(...valid);
  // In the gap: reading the time with the offset that applied before it lands after the gap.
  return naive - before;
}
