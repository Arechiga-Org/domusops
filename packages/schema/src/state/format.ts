import type { Groups, JsonObject, Template } from "../format.js";

/** State format identifier. Every emitted document declares it (spec FR-018). */
export const STATE_FORMAT = "domusops.state/0.1" as const;

export const STATE_DETAIL_LEVELS = ["summary", "standard"] as const;
export type StateDetailLevel = (typeof STATE_DETAIL_LEVELS)[number];

/** The head keys of an inline record (data-model §2); a positional row starts with the same two. */
export const STATE_HEAD_KEYS = ["id", "state"] as const;

export interface StateEnvelope {
  format: typeof STATE_FORMAT;
  detail: StateDetailLevel;
  ha_version: string;
  compression_ratio: number;
  time_zone: string;
  /** `±HH:MM`, the offset at `anchor`; the default for every local time in the document. */
  utc_offset: string;
  /** Local ISO 8601 with offset, to the second: the latest `last_updated` selected, or the call time. */
  anchor: string;
  /** `entities` as parsed, when given. */
  selectors?: string[];
  /** `domain` as parsed, when given. */
  domains?: string[];
  /** `state` as parsed, when given. */
  states?: string[];
  /** `attributes` as parsed, when given (`standard` documents only). */
  attributes?: string[];
}

export interface StateStandardDocument extends StateEnvelope {
  detail: "standard";
  templates: Record<string, Template>;
  /** domain -> groups. A record's head is `[object_id, state]` (`id` and `state` when inline). */
  entities: Record<string, Groups>;
}

/** A summary never carries `attributes`, which `summary` refuses. */
export interface StateSummaryDocument extends Omit<
  StateEnvelope,
  "attributes"
> {
  detail: "summary";
  counts: { entities: number; domains: number };
  /** domain -> `[entities, unavailable, unknown]`. */
  by_domain: Record<string, [number, number, number]>;
}

export type StateDocument = StateStandardDocument | StateSummaryDocument;

/** One entity as `expandState` returns it (data-model §6). */
export interface StateRecord {
  entity_id: string;
  state: string;
  attributes: JsonObject;
  /** Local ISO 8601 with offset, to the second. */
  last_changed: string;
  last_updated: string;
  last_reported: string;
  /** Full IDs; `null` when the instance gave none. */
  context: { id: string; parent_id: string | null; user_id: string | null };
}
