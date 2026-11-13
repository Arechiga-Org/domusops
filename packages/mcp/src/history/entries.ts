import { deepEqual, type JsonObject } from "@domusops/schema";
import type { HistoryAnswer, HistoryEntry } from "../ha/history.js";
import { EXEMPT_KEYS, redactRows } from "../snapshot/redact.js";

/** One recorded state of an entity: `at` in epoch milliseconds. */
export interface Change {
  at: number;
  state: string;
  attributes: JsonObject;
  /**
   * The instance recorded a state change (the entry has no `lc`). It can be true with the same
   * state string: an entity with `force_update` sets its state again and its `last_changed` moves.
   */
  stateChanged: boolean;
}

/** One entity's history in the window (data-model §3, before encoding). */
export interface EntityHistory {
  entityId: string;
  /**
   * The state at the window start; `since`, in epoch milliseconds, when the history reveals when it
   * took effect.
   */
  start?: { state: string; attributes: JsonObject; since?: number };
  /** Every listed change, in time order. */
  changes: Change[];
  /** Changes the `attributes` filter left out. */
  skipped: number;
}

/**
 * Whether `entry` is the state at the window start: the instance sets its `lu` to the start
 * exactly (research R1).
 */
export function isStartEntry(
  entry: HistoryEntry | undefined,
  windowStartMs: number,
): entry is HistoryEntry {
  return entry !== undefined && Math.round(entry.lu * 1000) === windowStartMs;
}

/**
 * Splits one entity's raw entries into its start state and its changes (research R1, R6). The first
 * entry is the start state when its `lu` equals the window start: the instance sets it so. The
 * start's `since` is the `lc` of a first change that left the state as it was.
 */
export function entityHistory(
  entityId: string,
  entries: readonly HistoryEntry[],
  windowStartMs: number,
): EntityHistory {
  const first = entries[0];
  const hasStart = isStartEntry(first, windowStartMs);
  const rest = hasStart ? entries.slice(1) : entries;
  const changes = rest.map((entry) => ({
    at: entry.lu * 1000,
    state: entry.s,
    attributes: entry.a as JsonObject,
    stateChanged: entry.lc === undefined,
  }));
  if (!hasStart) return { entityId, changes, skipped: 0 };
  const since = rest[0]?.lc;
  return {
    entityId,
    start: {
      state: first.s,
      attributes: first.a as JsonObject,
      ...(since === undefined ? {} : { since: since * 1000 }),
    },
    changes,
    skipped: 0,
  };
}

/** Every entity of the answer, in entity-ID order. */
export function entityHistories(
  answer: HistoryAnswer,
  windowStartMs: number,
): EntityHistory[] {
  return Object.keys(answer)
    .sort()
    .map((id) => entityHistory(id, answer[id] ?? [], windowStartMs));
}

/**
 * Redacts every state and attribute with the rules `ha_state` and `ha_snapshot` apply (research
 * R8), before any comparison, so a redacted value that changes is equal from one entry to the next.
 */
export function redactHistories(
  histories: readonly EntityHistory[],
  options: {
    token: string;
    coordinates: { latitude: unknown; longitude: unknown };
  },
): EntityHistory[] {
  const rows: JsonObject[] = [];
  for (const history of histories) {
    if (history.start !== undefined) {
      rows.push({
        entity_id: history.entityId,
        state: history.start.state,
        attributes: history.start.attributes,
      });
    }
    for (const change of history.changes) {
      rows.push({
        entity_id: history.entityId,
        state: change.state,
        attributes: change.attributes,
      });
    }
  }
  const redacted = redactRows(rows, {
    token: options.token,
    exemptKeys: EXEMPT_KEYS,
    coordinates: options.coordinates,
  });
  let next = 0;
  const take = (): { state: string; attributes: JsonObject } => {
    const row = redacted[next++] as JsonObject;
    return {
      state: row["state"] as string,
      attributes: row["attributes"] as JsonObject,
    };
  };
  return histories.map((history) => ({
    ...history,
    ...(history.start === undefined
      ? {}
      : { start: { ...history.start, ...take() } }),
    changes: history.changes.map((change) => ({ ...change, ...take() })),
  }));
}

/** The named attributes of `attributes`, in their own order. */
function trimmed(
  attributes: JsonObject,
  keep: ReadonlySet<string>,
): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (keep.has(key)) {
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return out;
}

/**
 * Keeps only the named attributes, and only the changes whose state or a named attribute differs
 * from the entity's previous listed entry; the others are counted in `skipped` (FR-006, research
 * R9). The start is always kept.
 */
export function keepAttributes(
  histories: readonly EntityHistory[],
  names: readonly string[],
): EntityHistory[] {
  const keep = new Set(names);
  return histories.map((history) => {
    const start =
      history.start === undefined
        ? undefined
        : {
            ...history.start,
            attributes: trimmed(history.start.attributes, keep),
          };
    let previous: { state: string; attributes: JsonObject } | undefined = start;
    let skipped = history.skipped;
    const changes: Change[] = [];
    for (const change of history.changes) {
      const next = { ...change, attributes: trimmed(change.attributes, keep) };
      if (
        previous !== undefined &&
        !next.stateChanged &&
        previous.state === next.state &&
        deepEqual(previous.attributes, next.attributes)
      ) {
        skipped++;
        continue;
      }
      changes.push(next);
      previous = next;
    }
    return {
      entityId: history.entityId,
      ...(start === undefined ? {} : { start }),
      changes,
      skipped,
    };
  });
}
