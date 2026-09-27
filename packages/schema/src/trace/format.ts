import type { JsonObject } from "../format.js";

/** Trace format identifier. Every emitted document declares it (spec FR-021). */
export const TRACE_FORMAT = "domusops.trace/0.1" as const;

export const TRACE_DETAIL_LEVELS = ["summary", "standard"] as const;
export type TraceDetailLevel = (typeof TRACE_DETAIL_LEVELS)[number];

/** The traced domains: automations and scripts (spec FR-003). */
export const TRACE_DOMAINS = ["automation", "script"] as const;
export type TraceDomain = (typeof TRACE_DOMAINS)[number];

/** One step of a trace, as `trace/get` returns it (data-model §1). */
export interface TraceStepRecord extends JsonObject {
  path: string;
  timestamp: string;
  changed_variables?: JsonObject;
  result?: JsonObject;
  child_id?: { domain: string; item_id: string; run_id: string };
  error?: string;
  template_errors?: string[];
}

/** A trace as `trace/list` returns it. */
export interface TraceShortRecord extends JsonObject {
  run_id: string;
  domain: string;
  item_id: string;
  state: string;
  /** Null while the run is in progress. */
  script_execution: string | null;
  timestamp: { start: string; finish: string | null };
  last_step: string | null;
  /** Automations only: the trigger description, or null. */
  trigger?: string | null;
  error?: string;
  not_triggered?: true;
}

/** A trace as `trace/get` returns it: the short record plus the steps and what the run executed. */
export interface TraceExtendedRecord extends TraceShortRecord {
  trace: Record<string, TraceStepRecord[]>;
  config: JsonObject | null;
  blueprint_inputs: JsonObject | null;
  context: { id: string; parent_id: string | null; user_id: string | null };
}

export interface TraceEnvelope {
  format: typeof TRACE_FORMAT;
  detail: TraceDetailLevel;
  ha_version: string;
  compression_ratio: number;
  time_zone: string;
  /** `±HH:MM` at the time of the call; the default offset of every local time without one. */
  utc_offset: string;
  /** What was asked, resolved (data-model §2). Each key is present only when it was given. */
  selection: {
    entities?: string[];
    start?: string;
    end?: string;
    run?: string;
    context?: string;
  };
  counts: { items: number; runs: number; not_triggered: number };
  /** Selectors and items that produced no runs, with the reason (spec FR-004). */
  no_runs?: {
    no_match?: string[];
    no_stored_runs?: string[];
    none_in_window?: string[];
    untraceable?: string[];
  };
}

/**
 * A step: `[path, t, result, variables, child, error, template_errors]`, trailing `0` positions
 * omitted (data-model §3.3). `t` is milliseconds from the run's start. A step record with an
 * unknown key is `{ step: <record with t instead of timestamp> }`.
 */
export type TraceStep = unknown[] | { step: JsonObject };

/** A run of a `standard` document (data-model §3.1). */
export interface TraceRun {
  run: string;
  /** Local ISO 8601 with offset; six fraction digits exactly when the raw timestamp had them. */
  start: string;
  duration_ms?: number;
  trigger?: string | null;
  outcome?: string;
  state?: string;
  script_execution?: string | null;
  error?: string;
  not_triggered?: true;
  context: string | { v: string };
  parent_context?: string | { v: string };
  user?: string;
  /** Index into `configs`, or null when the raw configuration is null. */
  config: number | null;
  blueprint_inputs?: unknown;
  last_step?: string | null;
  steps_order?: "recorded";
  extra?: JsonObject;
  steps: TraceStep[];
}

export interface TraceItem {
  /** The `this` template: `entity_id` and the attribute pairs every `this` state shares. */
  this?: { entity_id: string; attributes: JsonObject };
  runs: TraceRun[];
}

export interface TraceStandardDocument extends TraceEnvelope {
  detail: "standard";
  strings?: string[];
  values?: unknown[];
  configs: unknown[];
  /** Entity ID -> item ID, where the item ID differs from the entity ID's object part. */
  ids?: Record<string, string>;
  items: Record<string, TraceItem>;
}

export const TRACE_SUMMARY_COLUMNS = [
  "run",
  "start",
  "duration_ms",
  "trigger",
  "outcome",
  "last_step",
  "context",
  "error",
] as const;

export interface TraceSummaryDocument extends TraceEnvelope {
  detail: "summary";
  columns: typeof TRACE_SUMMARY_COLUMNS;
  /** Item -> rows in the order of `columns`; the last column is omitted when there is no error. */
  items: Record<string, unknown[][]>;
}

export type TraceDocument = TraceStandardDocument | TraceSummaryDocument;
