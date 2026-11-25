/** The most a duration may be: 7 days, in seconds. */
export const MAX_DURATION_SECONDS = 604800;

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const SLUG = /^[a-z0-9_]+$/;
const NAME = /^[a-z0-9][a-z0-9_]{0,63}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DURATION = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/;

export const isEntityId = (value: unknown): value is string =>
  typeof value === "string" && ENTITY_ID.test(value);

/** `<domain>.<service>`, both parts lower-case words. */
export const isAction = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 2 && parts.every((part) => SLUG.test(part));
};

/** An absent-action pattern: an action, or `<domain>.*`. */
export const isActionPattern = (value: unknown): value is string =>
  isAction(value) ||
  (typeof value === "string" &&
    value.endsWith(".*") &&
    SLUG.test(value.slice(0, -2)));

/** Scenario and starting-point names. */
export const isScenarioName = (value: unknown): value is string =>
  typeof value === "string" && NAME.test(value);

/** An event type, such as `doorbell_pressed`. */
export const isEventType = (value: unknown): value is string =>
  typeof value === "string" && SLUG.test(value);

/** A time of day, `"HH:MM"` or `"HH:MM:SS"`, normalised to `"HH:MM:SS"`; `null` when it is not one. */
export function parseTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = TIME_OF_DAY.exec(value);
  if (match === null) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

/** A real calendar day, `"YYYY-MM-DD"`. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** An instant, `"YYYY-MM-DDTHH:MM[:SS]"`, normalised to seconds; `null` when it is not one. */
export function parseInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = INSTANT.exec(value);
  if (match === null) return null;
  const date = match[1] ?? "";
  const time = parseTimeOfDay(match[2]);
  if (!isCalendarDate(date) || time === null) return null;
  return `${date}T${time}`;
}

function inRange(seconds: number): boolean {
  return (
    Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_DURATION_SECONDS
  );
}

/**
 * A duration as seconds: a number, `"HH:MM:SS"`, `"HH:MM"` (hours below 24) or an object with
 * `hours`, `minutes` and `seconds`, at least one of them. Greater than 0, at most 7 days;
 * `null` when it is not one.
 */
export function parseDuration(value: unknown): number | null {
  let seconds: number;
  if (typeof value === "number") {
    seconds = value;
  } else if (typeof value === "string") {
    const match = DURATION.exec(value);
    if (match === null) return null;
    const hours = Number(match[1]);
    // `HH:MM` also reads as a time of day, so its hours stay below 24; `HH:MM:SS` goes up to
    // the 7-day limit.
    if (match[3] === undefined && hours > 23) return null;
    seconds = hours * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  } else if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields);
    if (
      keys.length === 0 ||
      keys.some((k) => !["hours", "minutes", "seconds"].includes(k))
    ) {
      return null;
    }
    const part = (key: string): number | null => {
      const field = fields[key];
      if (field === undefined) return 0;
      return typeof field === "number" && Number.isFinite(field) && field >= 0
        ? field
        : null;
    };
    const hours = part("hours");
    const minutes = part("minutes");
    const secs = part("seconds");
    if (hours === null || minutes === null || secs === null) return null;
    seconds = hours * 3600 + minutes * 60 + secs;
  } else {
    return null;
  }
  return inRange(seconds) ? seconds : null;
}
