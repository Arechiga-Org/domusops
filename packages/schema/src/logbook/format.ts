import type { JsonObject } from "../format.js";

/** Logbook format identifier. Every emitted document declares it (spec FR-020). */
export const LOGBOOK_FORMAT = "domusops.logbook/0.1" as const;

export const LOGBOOK_DETAIL_LEVELS = ["summary", "standard"] as const;
export type LogbookDetailLevel = (typeof LOGBOOK_DETAIL_LEVELS)[number];

/**
 * The cause fields of a logbook row (data-model §1), in emission order. In the cause table they
 * appear without the `context_` prefix.
 */
export const CAUSE_FIELDS = [
  "context_user_id",
  "context_entity_id",
  "context_state",
  "context_event_type",
  "context_domain",
  "context_service",
  "context_name",
  "context_message",
  "context_source",
  "context_entity_id_name",
] as const;

export const CAUSE_PREFIX = "context_";

/** One row as `logbook/get_events` returns it. Only `when` is guaranteed (data-model §1). */
export interface LogbookRow extends JsonObject {
  /** Seconds since the epoch. */
  when: number;
  entity_id?: string;
  state?: string;
}

export interface LogbookEnvelope {
  format: typeof LOGBOOK_FORMAT;
  detail: LogbookDetailLevel;
  ha_version: string;
  compression_ratio: number;
  time_zone: string;
  /** `±HH:MM`, the offset at the window start; the default for every local time in the document. */
  utc_offset: string;
  /** The resolved window, local ISO 8601 with offset, to the second. */
  window: { start: string; end: string };
  /** Local time of the earliest and latest event returned, or null when there is none. */
  first: string | null;
  last: string | null;
  selectors?: string[];
  no_events?: string[];
}

/**
 * An entry of the entity table: a bare entity ID (no constants, no columns), or
 * `[id | null, constants, columns]`. The entry with a `null` ID holds the events that belong to no
 * entity.
 */
export type LogbookEntity = string | [string | null, JsonObject, string[]];

/**
 * A row of the events section: `[time, entity, state, cause, ...columns]`, where `time` is
 * `"MM:SS"` within the bucket's hour, `entity` and `cause` are indexes (`cause` may be `null`),
 * and trailing `null` values are dropped (data-model §3.1). Values follow data-model §3.2.
 */
export type LogbookEventRow = unknown[];

/** local date `YYYY-MM-DD` -> hour key (`"HH:00"`, or `"HH:00±HH:MM"`) -> rows. */
export type LogbookEvents = Record<string, Record<string, LogbookEventRow[]>>;

export interface LogbookStandardDocument extends LogbookEnvelope {
  detail: "standard";
  strings?: string[];
  entities: LogbookEntity[];
  causes?: JsonObject[];
  events: LogbookEvents;
}

export interface LogbookSummaryDocument extends LogbookEnvelope {
  detail: "summary";
  counts: {
    events: number;
    entities: number;
    causes: number;
    no_entity_events: number;
  };
  by_domain: Record<string, number>;
  /** entity ID -> `[count, first, last]`, local times as in the envelope. */
  by_entity: Record<string, [number, string, string]>;
  /** `[cause, count]`, the cause as in the cause table of a standard document. */
  by_cause: [JsonObject, number][];
}

export type LogbookDocument = LogbookStandardDocument | LogbookSummaryDocument;
