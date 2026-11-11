import { parseIsoMicros, type TraceShortRecord } from "@domusops/schema";
import type { StoredLimit } from "../ha/trace.js";

/** The runs one item stores. */
export interface StoredRuns {
  count: number;
  /** The earliest start among them, in microseconds since the epoch. */
  oldest: number;
}

/** An item whose stored runs may no longer reach the window start, with its limit. */
export interface Affected extends StoredLimit {
  entityId: string;
}

/**
 * The selected automations and scripts whose oldest stored run started after the window start
 * (research R4): only those can have replaced runs from the window, so only their limits need
 * reading. Not-triggered traces are stored apart, with a limit of their own, and never replace
 * runs, so they are not counted. Removed items (keys with no entity ID) no longer run and are left
 * out.
 */
export function candidates(
  short: readonly TraceShortRecord[],
  keyOf: (record: TraceShortRecord) => string,
  selected: (key: string) => boolean,
  startMs: number,
): Map<string, StoredRuns> {
  const runs = new Map<string, StoredRuns>();
  for (const record of short) {
    if (record.not_triggered === true) continue;
    const key = keyOf(record);
    if (key.includes(":") || !selected(key)) continue;
    const start = parseIsoMicros(record.timestamp.start) as number;
    const stored = runs.get(key);
    if (stored === undefined) runs.set(key, { count: 1, oldest: start });
    else {
      stored.count++;
      stored.oldest = Math.min(stored.oldest, start);
    }
  }
  for (const [key, stored] of runs) {
    if (stored.oldest <= startMs * 1000) runs.delete(key);
  }
  return runs;
}

/** The candidates that store as many runs as they keep, in entity-ID order. */
export function affected(
  found: ReadonlyMap<string, StoredRuns>,
  limits: ReadonlyMap<string, StoredLimit>,
): Affected[] {
  const out: Affected[] = [];
  for (const [entityId, stored] of found) {
    const limit = limits.get(entityId);
    if (limit !== undefined && stored.count >= limit.limit) {
      out.push({ entityId, ...limit });
    }
  }
  return out.sort((a, b) =>
    a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0,
  );
}
