import type { JsonObject } from "../format.js";

/** History format identifier. Every emitted document declares it (specs/011-ha-history FR-017). */
export const HISTORY_FORMAT = "domusops.history/0.1" as const;

export const HISTORY_DETAIL_LEVELS = ["summary", "standard"] as const;
export type HistoryDetailLevel = (typeof HISTORY_DETAIL_LEVELS)[number];

export interface HistoryEnvelope {
  format: typeof HISTORY_FORMAT;
  detail: HistoryDetailLevel;
  ha_version: string;
  compression_ratio: number;
  time_zone: string;
  /** `±HH:MM`, the offset at the window start; the default for every local time in the document. */
  utc_offset: string;
  /** The resolved window, local ISO 8601 with offset, to the second. */
  window: { start: string; end: string };
  /** `entities` as parsed, when given. */
  selectors?: string[];
  /** `attributes` as parsed, when given (`standard` documents only). */
  attributes?: string[];
  /** Present only when the call asked for significant changes only. */
  significant_only?: true;
}

/**
 * The state at the window start: `[state, attributes]`, or `[state, attributes, since]` when the
 * history reveals the local time the state took effect (data-model §3).
 */
export type HistoryStart = [string, JsonObject] | [string, JsonObject, string];

/**
 * One change: `["MM:SS", state, set, unset]`, trailing `null` values dropped. `state` is `null`
 * when unchanged; `set` holds the attributes added or changed since the previous listed entry;
 * `unset` lists the attributes removed (data-model §3).
 */
export type HistoryRow =
  | [string]
  | [string, string | null]
  | [string, string | null, JsonObject | null]
  | [string, string | null, JsonObject | null, string[]];

/** local date `YYYY-MM-DD` -> hour key (`"HH:00"`, or `"HH:00±HH:MM"`) -> rows. */
export type HistoryBuckets = Record<string, Record<string, HistoryRow[]>>;

export interface HistoryEntityEntry {
  start?: HistoryStart;
  changes?: HistoryBuckets;
  /** Changes the `attributes` filter left out, when there are any. */
  skipped?: number;
}

export interface HistoryStandardDocument extends HistoryEnvelope {
  detail: "standard";
  /** entity ID -> entry, IDs in order. */
  entities: Record<string, HistoryEntityEntry>;
}

/** A summary never carries `attributes`, which `summary` refuses. */
export interface HistorySummaryDocument extends Omit<
  HistoryEnvelope,
  "attributes"
> {
  detail: "summary";
  counts: {
    entities: number;
    changes: number;
    state_changes: number;
    attribute_only: number;
  };
  /** domain -> `[entities, changes, state_changes, attribute_only]`. */
  by_domain: Record<string, [number, number, number, number]>;
  /** entity ID -> `[changes, state_changes, attribute_only]`, only when the call had `entities`. */
  by_entity?: Record<string, [number, number, number]>;
}

export type HistoryDocument = HistoryStandardDocument | HistorySummaryDocument;

/** One entry as `expandHistory` returns it (data-model §6). */
export interface HistoryRecord {
  /** True for the state at the window start. */
  start: boolean;
  state: string;
  attributes: JsonObject;
  /** Local ISO 8601 with offset, to the second; the window start for the start state. */
  last_updated: string;
  /** Local ISO 8601 with offset, or `null` when the history does not reveal it. */
  last_changed: string | null;
}

/** One entity's entries, in time order. */
export interface HistoryEntityRecords {
  entity_id: string;
  entries: HistoryRecord[];
}
