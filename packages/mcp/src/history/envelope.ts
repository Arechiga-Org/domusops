import {
  HISTORY_FORMAT,
  type HistoryDetailLevel,
  type HistoryEnvelope,
} from "@domusops/schema";
import {
  formatLocalIso,
  formatOffset,
  localParts,
} from "../logbook/local-time.js";
import type { ResolvedWindow } from "../logbook/window.js";

/** The envelope and what encoding needs from it. */
export interface HistoryFrame {
  envelope: HistoryEnvelope;
  timeZone: string;
  /** Minutes east of UTC at the window start; a local time with this offset leaves it out. */
  offsetMinutes: number;
}

/** The envelope of data-model §2, in emission order (research R5, R7). */
export function historyFrame(input: {
  detail: HistoryDetailLevel;
  haVersion: string;
  timeZone: string;
  window: ResolvedWindow;
  selectors?: readonly string[];
  attributes?: readonly string[];
  significantOnly: boolean;
}): HistoryFrame {
  const offsetMinutes = localParts(
    input.window.startMs,
    input.timeZone,
  ).offsetMinutes;
  const envelope: HistoryEnvelope = {
    format: HISTORY_FORMAT,
    detail: input.detail,
    ha_version: input.haVersion,
    compression_ratio: 0,
    time_zone: input.timeZone,
    utc_offset: formatOffset(offsetMinutes),
    window: {
      start: formatLocalIso(input.window.startMs, input.timeZone, null),
      end: formatLocalIso(input.window.endMs, input.timeZone, null),
    },
    ...(input.selectors === undefined
      ? {}
      : { selectors: [...input.selectors] }),
    ...(input.attributes === undefined
      ? {}
      : { attributes: [...input.attributes] }),
    ...(input.significantOnly ? { significant_only: true as const } : {}),
  };
  return { envelope, timeZone: input.timeZone, offsetMinutes };
}
