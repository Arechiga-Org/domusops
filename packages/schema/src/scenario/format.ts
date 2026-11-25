/** Scenario format identifier. Every scenario document declares it (specs/006-scenario-dsl FR-001). */
export const SCENARIO_FORMAT = "domusops.scenario/0.1" as const;

/** Run report format identifier (specs/006-scenario-dsl FR-027). */
export const SCENARIO_REPORT_FORMAT = "domusops.scenario-report/0.1" as const;

/** The date a scenario starts on when it states only a time: a Wednesday, fixed by the format. */
export const DEFAULT_SCENARIO_DATE = "2026-04-15";
export const DEFAULT_SCENARIO_TIME = "12:00:00";
/** Real seconds a scenario may take before it fails with `time_limit`. */
export const DEFAULT_SCENARIO_TIMEOUT_SECONDS = 300;
/** Real seconds an expectation is retried before it fails. */
export const DEFAULT_SETTLE_SECONDS = 5;

/**
 * The kinds of device a scenario may stand in for: the harness's device kinds. The sandbox tests
 * that its own list is equal, since this package cannot import it.
 */
export const STAND_IN_KINDS = [
  "switch",
  "binary_sensor",
  "sensor",
  "light",
  "lock",
  "fan",
  "cover",
  "valve",
  "device_tracker",
] as const;

export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };
export type Scalar = string | number | boolean | null;

/** Seconds, greater than 0 and at most 604800 (7 days). */
export type Duration = number;

/** What an expectation compares with; a bare value as written is `eq`. */
export type Comparison =
  | { eq: Json }
  | { not: Json }
  | { in: Json[] }
  | { at_least: number }
  | { at_most: number }
  | { between: [number, number] };

export interface EntityValue {
  state: Scalar;
  attributes: Record<string, Json>;
}

export interface Target {
  entity_id?: string[];
  device_id?: string[];
  area_id?: string[];
}

export interface StandIn {
  entityId: string;
  class?: string;
  initial?: string;
}

/** A starting point with `use` applied and the defaults filled (contract §3). */
export interface StartingPoint {
  date: string;
  time: string;
  entities: [entityId: string, value: EntityValue][];
  standIns: StandIn[];
  absentActions: string[];
}

export type Step =
  | { kind: "states"; entities: [string, EntityValue][]; path: string }
  | {
      kind: "action";
      action: string;
      target?: Target;
      data: Record<string, Json>;
      path: string;
    }
  | {
      kind: "event";
      eventType: string;
      data: Record<string, Json>;
      path: string;
    }
  | { kind: "advance"; seconds: Duration; path: string }
  | {
      kind: "advance_to";
      at: { time: string } | { instant: string };
      path: string;
    }
  | { kind: "expect"; expectations: Expectation[]; path: string };

export type Expectation = (
  | {
      kind: "entity";
      entityId: string;
      state?: Comparison;
      attributes: [name: string, Comparison][];
      for?: Duration;
    }
  | { kind: "triggered"; automation: string; times?: number }
  | {
      kind: "called";
      action: string;
      target?: Target;
      data: [string, Comparison][];
      times?: number;
    }
) & { within: Duration | 0; settle: number; at: string; path: string };

/** A starting point as written in one scenario, before `use` is applied. */
export interface StartingPointDraft {
  /** Names of the starting points applied first, in order. */
  use: string[];
  date?: string;
  time?: string;
  entities: [string, EntityValue][];
  standIns: StandIn[];
  absentActions: string[];
}

export interface NamedStartingPoint {
  name: string;
  /** JSON Pointer of the starting point in its file. */
  path: string;
  point: StartingPointDraft;
}

/** One scenario of a file, normalised and not yet resolved against the rest of the suite. */
export interface ScenarioDraft {
  name: string;
  description?: string;
  /** JSON Pointer of the scenario in its file; the document root for a one-scenario file. */
  path: string;
  given: StartingPointDraft;
  /** `when`, then a final `expect` step from `then`. */
  steps: Step[];
  /** The scenario's own limit, in real seconds. */
  timeout?: number;
  settle: number;
}

/** What `normalizeScenarioDocument` returns for one valid document. */
export interface ScenarioFile {
  scenarios: ScenarioDraft[];
  startingPoints: NamedStartingPoint[];
}

export interface ResolvedScenario {
  name: string;
  description?: string;
  /** Relative to the configuration directory. */
  file: string;
  /** JSON Pointer of the scenario in its file. */
  path: string;
  given: StartingPoint;
  steps: Step[];
  /** Real seconds: the scenario's own, else the run's default, else 300. */
  timeout: number;
  settle: number;
}

export type ScenarioIssueCode =
  | "format_missing"
  | "format_unsupported"
  | "unknown_key"
  | "missing_key"
  | "wrong_type"
  | "bad_entity_id"
  | "bad_action"
  | "bad_duration"
  | "bad_time"
  | "bad_date"
  | "bad_comparison"
  | "exclusive_keys"
  | "empty_list"
  | "bad_name"
  | "stand_in_kind_unsupported"
  | "duplicate_scenario"
  | "duplicate_starting_point"
  | "unknown_starting_point"
  | "starting_point_cycle"
  | "tag_not_allowed"
  | "yaml_syntax";

export interface ScenarioIssue {
  /** JSON Pointer into the document; the root is the empty string. */
  path: string;
  code: ScenarioIssueCode;
  message: string;
}
