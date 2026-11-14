import {
  SYSTEM_LOG_FORMAT,
  type SystemLogDetailLevel,
  type SystemLogEnvelope,
  type SystemLogLevel,
} from "@domusops/schema";
import {
  formatLocalIso,
  formatOffset,
  localParts,
} from "../logbook/local-time.js";
import { pad } from "../util/json.js";

/** The envelope and what encoding needs from it. */
export interface SystemLogFrame {
  envelope: SystemLogEnvelope;
  timeZone: string;
  /** Minutes east of UTC at the time of the call; a local time with this offset leaves it out. */
  offsetMinutes: number;
}

/** The envelope of data-model §2, in emission order (research R6, R11). */
export function systemLogFrame(input: {
  detail: SystemLogDetailLevel;
  haVersion: string;
  timeZone: string;
  nowMs: number;
  integrations?: readonly string[];
  level?: SystemLogLevel;
  startMs?: number;
  custom: readonly string[];
}): SystemLogFrame {
  const offsetMinutes = localParts(input.nowMs, input.timeZone).offsetMinutes;
  const envelope: SystemLogEnvelope = {
    format: SYSTEM_LOG_FORMAT,
    detail: input.detail,
    ha_version: input.haVersion,
    compression_ratio: 0,
    time_zone: input.timeZone,
    utc_offset: formatOffset(offsetMinutes),
    ...(input.integrations === undefined
      ? {}
      : { integrations: [...input.integrations] }),
    ...(input.level === undefined ? {} : { level: input.level }),
    ...(input.startMs === undefined
      ? {}
      : { start: formatLocalIso(input.startMs, input.timeZone, null) }),
    ...(input.custom.length === 0 ? {} : { custom: [...input.custom] }),
  };
  return { envelope, timeZone: input.timeZone, offsetMinutes };
}

/** A local time of a document (research R11): its date, and the time to the second. */
export interface LocalStamp {
  date: string;
  /** `HH:MM:SS`, with `±HH:MM` when the offset differs from the document's. */
  time: string;
}

/** The local date and time of `seconds` since the epoch, truncated to the second. */
export function localStamp(seconds: number, frame: SystemLogFrame): LocalStamp {
  const p = localParts(Math.floor(seconds) * 1000, frame.timeZone);
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  return {
    date: p.date,
    time:
      p.offsetMinutes === frame.offsetMinutes
        ? time
        : `${time}${formatOffset(p.offsetMinutes)}`,
  };
}

/**
 * An entry's first occurrence (data-model §3): `null` when it equals the last to the second, the
 * time alone on the same date, else local ISO 8601, each with its offset only when it differs.
 */
export function firstOccurrence(
  first: number,
  last: number,
  frame: SystemLogFrame,
): string | null {
  if (Math.floor(first) === Math.floor(last)) return null;
  const at = localStamp(first, frame);
  if (at.date === localStamp(last, frame).date) return at.time;
  return formatLocalIso(
    Math.floor(first) * 1000,
    frame.timeZone,
    frame.offsetMinutes,
  );
}
