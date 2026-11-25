import { SCENARIO_REPORT_FORMAT, type Json } from "./format.js";

/** The channels a run can target, as the harness names them. */
export type ScenarioChannel = "stable" | "previous-stable" | "beta";

/** Why a scenario could not run (contracts/report-format.md §2). */
export const COULD_NOT_RUN_CODES = [
  "config_invalid",
  "runtime_missing",
  "channel_unresolved",
  "image_unavailable",
  "not_ready",
  "instance_stopped",
  "stand_in_exists",
  "stand_in_kind_unsupported",
  "action_offered",
  "actions_unavailable",
  "time_unavailable",
  "starting_point_not_held",
  "virtual_unavailable",
] as const;
export type CouldNotRunCode = (typeof COULD_NOT_RUN_CODES)[number];

export type ScenarioOutcome = "passed" | "failed" | "could_not_run" | "not_run";

export interface ExpectationFailure {
  /** Where the expectation is: `then[i]` or `when[j].then[i]`. */
  at: string;
  line: number;
  subject: string;
  check:
    | "state"
    | `attribute:${string}`
    | "stays"
    | "triggered"
    | "called"
    | "limit"
    | "step";
  expected: Json;
  actual: Json;
  reason?:
    | "entity_missing"
    | "not_a_number"
    | "changed_during_span"
    | "time_limit"
    | "recording_limit"
    | "action_failed"
    | "advance_to_past";
  /** Instance time of the read, or of the change for a span. */
  read_at: string;
  /** At most 10 recorded calls of the action, newest last. */
  calls?: { at: string; data: Record<string, Json>; absent: boolean }[];
}

export interface ScenarioResult {
  scenario: string;
  file: string;
  release: string | null;
  outcome: ScenarioOutcome;
  /** The frozen start moment with its offset and weekday. */
  start?: string;
  duration_ms: number;
  /** Counts checks: an entity expectation counts its state and each stated attribute. */
  expectations?: { passed: number; failed: number };
  failures?: ExpectationFailure[];
  reason?: { code: CouldNotRunCode; message: string };
  /** At most 5 entries the instance logged, messages cut at 300 characters. */
  instance_errors?: { logger: string; message: string }[];
  /** Failed scenarios only: at most 20 entries per map, the rest counted in `more`. */
  activity?: {
    triggered: Record<string, number>;
    called: Record<string, number>;
    more: number;
  };
}

export interface ScenarioReport {
  format: typeof SCENARIO_REPORT_FORMAT;
  runner: { name: string; version: string };
  started_at: string;
  duration_ms: number;
  outcome: ScenarioOutcome;
  counts: {
    passed: number;
    failed: number;
    could_not_run: number;
    not_run: number;
  };
  releases: { channel?: ScenarioChannel; release: string | null }[];
  /** How secrets were provided; `null` when no instance started. Never a value. */
  config: {
    secrets: "placeholders" | "caller-file" | "none-referenced";
    placeholder_keys: string[];
  } | null;
  scenarios: ScenarioResult[];
}

const outcome = {
  enum: ["passed", "failed", "could_not_run", "not_run"],
} as const;

const count = { type: "integer", minimum: 0 } as const;

const failure = {
  type: "object",
  required: ["at", "line", "subject", "check", "expected", "actual", "read_at"],
  additionalProperties: false,
  properties: {
    at: {
      type: "string",
      pattern: "^(when\\[\\d+\\]\\.)?then\\[\\d+\\]$|^when\\[\\d+\\]$",
    },
    line: { type: "integer", minimum: 1 },
    subject: { type: "string", minLength: 1 },
    check: {
      type: "string",
      pattern: "^(state|stays|triggered|called|limit|step|attribute:.+)$",
    },
    expected: {},
    actual: {},
    reason: {
      enum: [
        "entity_missing",
        "not_a_number",
        "changed_during_span",
        "time_limit",
        "recording_limit",
        "action_failed",
        "advance_to_past",
      ],
    },
    read_at: { type: "string", minLength: 1 },
    calls: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        required: ["at", "data", "absent"],
        additionalProperties: false,
        properties: {
          at: { type: "string" },
          data: { type: "object" },
          absent: { type: "boolean" },
        },
      },
    },
  },
} as const;

const countMap = {
  type: "object",
  maxProperties: 20,
  additionalProperties: { type: "integer", minimum: 1 },
} as const;

const result = {
  type: "object",
  required: ["scenario", "file", "release", "outcome", "duration_ms"],
  additionalProperties: false,
  properties: {
    scenario: { type: "string", minLength: 1 },
    file: { type: "string", minLength: 1 },
    release: { type: ["string", "null"] },
    outcome,
    start: { type: "string" },
    duration_ms: count,
    expectations: {
      type: "object",
      required: ["passed", "failed"],
      additionalProperties: false,
      properties: { passed: count, failed: count },
    },
    failures: { type: "array", minItems: 1, items: failure },
    reason: {
      type: "object",
      required: ["code", "message"],
      additionalProperties: false,
      properties: {
        code: { enum: [...COULD_NOT_RUN_CODES] },
        message: { type: "string" },
      },
    },
    instance_errors: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        required: ["logger", "message"],
        additionalProperties: false,
        properties: {
          logger: { type: "string" },
          message: { type: "string", maxLength: 300 },
        },
      },
    },
    activity: {
      type: "object",
      required: ["triggered", "called", "more"],
      additionalProperties: false,
      properties: { triggered: countMap, called: countMap, more: count },
    },
  },
  allOf: [
    {
      if: {
        properties: { outcome: { const: "failed" } },
        required: ["outcome"],
      },
      else: {
        properties: {
          failures: false,
          instance_errors: false,
          activity: false,
        },
      },
    },
    {
      if: {
        properties: { outcome: { const: "could_not_run" } },
        required: ["outcome"],
      },
      then: { required: ["reason"], properties: { reason: true } },
      else: { properties: { reason: false } },
    },
  ],
} as const;

/** JSON Schema of a `domusops.scenario-report/0.1` document. */
export const scenarioReportJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: SCENARIO_REPORT_FORMAT,
  type: "object",
  required: [
    "format",
    "runner",
    "started_at",
    "duration_ms",
    "outcome",
    "counts",
    "releases",
    "config",
    "scenarios",
  ],
  additionalProperties: false,
  properties: {
    format: { const: SCENARIO_REPORT_FORMAT },
    runner: {
      type: "object",
      required: ["name", "version"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
      },
    },
    started_at: { type: "string", minLength: 1 },
    duration_ms: count,
    outcome,
    counts: {
      type: "object",
      required: ["passed", "failed", "could_not_run", "not_run"],
      additionalProperties: false,
      properties: {
        passed: count,
        failed: count,
        could_not_run: count,
        not_run: count,
      },
    },
    releases: {
      type: "array",
      items: {
        type: "object",
        required: ["release"],
        additionalProperties: false,
        properties: {
          channel: { enum: ["stable", "previous-stable", "beta"] },
          release: { type: ["string", "null"] },
        },
      },
    },
    config: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          required: ["secrets", "placeholder_keys"],
          additionalProperties: false,
          properties: {
            secrets: {
              enum: ["placeholders", "caller-file", "none-referenced"],
            },
            placeholder_keys: { type: "array", items: { type: "string" } },
          },
        },
      ],
    },
    scenarios: { type: "array", items: result },
  },
} as const;
