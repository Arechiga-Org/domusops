import {
  deepEqual,
  type HistoryBuckets,
  type HistoryEntityEntry,
  type HistoryRow,
  type HistoryStandardDocument,
  type JsonObject,
} from "@domusops/schema";
import {
  formatLocalIso,
  formatOffset,
  localParts,
} from "../logbook/local-time.js";
import { pad } from "../util/json.js";
import type { HistoryFrame } from "./envelope.js";
import type { EntityHistory } from "./entries.js";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sets `key` as an own property even when it is `__proto__`, which plain assignment would turn into
 * a prototype change and lose.
 */
function put(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

interface Listed {
  state: string;
  attributes: JsonObject;
}

/**
 * A change as a delta against the entity's previous listed entry (data-model §3): the new state or
 * `null`, the attributes added or changed, the attributes removed in name order, trailing `null`
 * values dropped. Without a previous entry, the state and every attribute are given.
 */
function rowOf(
  time: string,
  previous: Listed | undefined,
  change: Listed,
): HistoryRow {
  const state =
    previous === undefined || previous.state !== change.state
      ? change.state
      : null;
  const set: JsonObject = {};
  let changed = false;
  for (const [key, value] of Object.entries(change.attributes)) {
    if (
      previous === undefined ||
      !Object.hasOwn(previous.attributes, key) ||
      !deepEqual(previous.attributes[key], value)
    ) {
      put(set, key, value);
      changed = true;
    }
  }
  const unset =
    previous === undefined
      ? []
      : Object.keys(previous.attributes)
          .filter((key) => !Object.hasOwn(change.attributes, key))
          .sort(compare);
  const row: (string | JsonObject | string[] | null)[] = [
    time,
    state,
    changed ? set : null,
    unset.length > 0 ? unset : null,
  ];
  while (row.length > 1 && row[row.length - 1] === null) row.pop();
  return row as HistoryRow;
}

/**
 * The `standard` document (data-model §3, research R6, R7): per entity in ID order, the start state,
 * then the changes bucketed by local date and hour, each one a delta against the previous listed
 * entry. The `compression_ratio` is a placeholder for `finalize` to fill.
 */
export function encodeStandardHistory(
  frame: HistoryFrame,
  histories: readonly EntityHistory[],
): HistoryStandardDocument {
  const { timeZone, offsetMinutes } = frame;
  const entities: Record<string, HistoryEntityEntry> = {};
  for (const history of [...histories].sort((a, b) =>
    compare(a.entityId, b.entityId),
  )) {
    const entry: HistoryEntityEntry = {};
    let previous: Listed | undefined;
    if (history.start !== undefined) {
      const { state, attributes, since } = history.start;
      entry.start =
        since === undefined
          ? [state, attributes]
          : [
              state,
              attributes,
              formatLocalIso(Math.floor(since), timeZone, offsetMinutes),
            ];
      previous = history.start;
    }
    const changes: HistoryBuckets = {};
    for (const change of history.changes) {
      const local = localParts(Math.floor(change.at), timeZone);
      const hour = `${pad(local.hour)}:00`;
      const hourKey =
        local.offsetMinutes === offsetMinutes
          ? hour
          : `${hour}${formatOffset(local.offsetMinutes)}`;
      const day = (changes[local.date] ??= {});
      (day[hourKey] ??= []).push(
        rowOf(`${pad(local.minute)}:${pad(local.second)}`, previous, change),
      );
      previous = change;
    }
    if (history.changes.length > 0) entry.changes = changes;
    if (history.skipped > 0) entry.skipped = history.skipped;
    entities[history.entityId] = entry;
  }
  return {
    ...frame.envelope,
    detail: "standard",
    entities,
  } as HistoryStandardDocument;
}
