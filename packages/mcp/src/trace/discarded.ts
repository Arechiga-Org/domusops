import { parseIsoMicros, type TraceShortRecord } from "@domusops/schema";
import type { StoredLimit } from "../ha/trace.js";

/** The stored records of one item of one kind: runs, or not-triggered traces. */
export interface Bucket {
  count: number;
  /** The earliest start among them, in microseconds since the epoch. */
  oldest: number;
}

/** An item whose stored runs may no longer reach the window start, with its limit. */
export interface Affected extends StoredLimit {
  entityId: string;
}

/**
 * The items whose stored records may have replaced runs from the window (research R4): per
 * selected automation or script and per kind (runs and not-triggered traces are stored apart),
 * the buckets whose oldest record started after the window start. Only those can have lost runs
 * from the window, so only their limits need reading. Removed items (keys with no entity ID) no
 * longer run and are left out.
 */
export function candidates(
  short: readonly TraceShortRecord[],
  keyOf: (record: TraceShortRecord) => string,
  selected: (key: string) => boolean,
  startMs: number,
): Map<string, Bucket[]> {
  const buckets = new Map<string, Map<boolean, Bucket>>();
  for (const record of short) {
    const key = keyOf(record);
    if (key.includes(":") || !selected(key)) continue;
    const kind = (record as { not_triggered?: unknown }).not_triggered === true;
    const start = parseIsoMicros(record.timestamp.start) as number;
    const byKind = buckets.get(key) ?? new Map<boolean, Bucket>();
    buckets.set(key, byKind);
    const bucket = byKind.get(kind);
    if (bucket === undefined) byKind.set(kind, { count: 1, oldest: start });
    else {
      bucket.count++;
      bucket.oldest = Math.min(bucket.oldest, start);
    }
  }
  const out = new Map<string, Bucket[]>();
  for (const [key, byKind] of buckets) {
    const late = [...byKind.values()].filter((b) => b.oldest > startMs * 1000);
    if (late.length > 0) out.set(key, late);
  }
  return out;
}

/** The candidates that store as many records of a kind as they keep, in entity-ID order. */
export function affected(
  found: ReadonlyMap<string, readonly Bucket[]>,
  limits: ReadonlyMap<string, StoredLimit>,
): Affected[] {
  const out: Affected[] = [];
  for (const [entityId, buckets] of found) {
    const limit = limits.get(entityId);
    if (limit === undefined) continue;
    if (buckets.some((bucket) => bucket.count >= limit.limit)) {
      out.push({ entityId, ...limit });
    }
  }
  return out.sort((a, b) =>
    a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0,
  );
}
