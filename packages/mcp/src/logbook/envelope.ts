import {
  LOGBOOK_FORMAT,
  type LogbookDetailLevel,
  type LogbookEnvelope,
  type LogbookRow,
} from "@domusops/schema";
import { formatLocalIso, formatOffset, localParts } from "./local-time.js";
import type { ResolvedWindow } from "./window.js";

export interface EncodeContext {
  haVersion: string;
  timeZone: string;
  window: ResolvedWindow;
  selectors: string[] | undefined;
  noEvents: string[];
}

/** The offset at the start of the window: the default for every local time in the document. */
export function baseOffsetMinutes(context: EncodeContext): number {
  return localParts(context.window.startMs, context.timeZone).offsetMinutes;
}

/**
 * The envelope both detail levels share (data-model §2), in emission order. `rows` are the
 * projected rows in chronological order; `first` and `last` come from the earliest and latest.
 * The `compression_ratio` is a placeholder for `finalize` to fill.
 */
export function buildEnvelope<D extends LogbookDetailLevel>(
  context: EncodeContext,
  rows: readonly LogbookRow[],
  detail: D,
): LogbookEnvelope & { detail: D } {
  const base = baseOffsetMinutes(context);
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  return {
    format: LOGBOOK_FORMAT,
    detail,
    ha_version: context.haVersion,
    compression_ratio: 0,
    time_zone: context.timeZone,
    utc_offset: formatOffset(base),
    window: {
      start: formatLocalIso(context.window.startMs, context.timeZone, null),
      end: formatLocalIso(context.window.endMs, context.timeZone, null),
    },
    first:
      firstRow === undefined
        ? null
        : formatLocalIso(firstRow.when * 1000, context.timeZone, base),
    last:
      lastRow === undefined
        ? null
        : formatLocalIso(lastRow.when * 1000, context.timeZone, base),
    ...(context.selectors === undefined
      ? {}
      : { selectors: context.selectors }),
    ...(context.selectors === undefined || context.noEvents.length === 0
      ? {}
      : { no_events: context.noEvents }),
  };
}
