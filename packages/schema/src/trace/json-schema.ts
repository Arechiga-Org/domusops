import { TRACE_FORMAT, TRACE_SUMMARY_COLUMNS } from "./format.js";

const object = { type: "object" } as const;
const count = { type: "integer", minimum: 0 } as const;
const stringList = { type: "array", items: { type: "string" } } as const;
/** A run's start: local time with offset, six fraction digits exactly when the microsecond is not 0. */
const runStart =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{6})?[+-]\\d{2}:\\d{2}$";
/** A window bound: local time to the second, with offset. */
const windowTime =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[+-]\\d{2}:\\d{2}$";
/** A summary row's start: `YYYY-MM-DD HH:MM:SS`, with the offset when it differs from the document's. */
const rowStart =
  "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2})?$";

const envelope = {
  format: { const: TRACE_FORMAT },
  ha_version: { type: "string" },
  compression_ratio: { type: "number", minimum: 0 },
  time_zone: { type: "string", minLength: 1 },
  utc_offset: { type: "string", pattern: "^[+-]\\d{2}:\\d{2}$" },
  selection: {
    type: "object",
    additionalProperties: false,
    properties: {
      entities: { type: "array", items: { type: "string" }, minItems: 1 },
      start: { type: "string", pattern: windowTime },
      end: { type: "string", pattern: windowTime },
      run: { type: "string" },
      context: { type: "string" },
    },
  },
  counts: {
    type: "object",
    required: ["items", "runs", "not_triggered"],
    additionalProperties: false,
    properties: { items: count, runs: count, not_triggered: count },
  },
  no_runs: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      no_match: stringList,
      no_stored_runs: stringList,
      none_in_window: stringList,
      untraceable: stringList,
    },
  },
} as const;

const envelopeRequired = [
  "format",
  "detail",
  "ha_version",
  "compression_ratio",
  "time_zone",
  "utc_offset",
  "selection",
  "counts",
] as const;

/**
 * A step: `[path, t, result, variables, child, error, template_errors]` (at least the first two),
 * or `{ step: { path, t, ... } }` when the record has a key the array cannot carry.
 */
const step = {
  oneOf: [
    {
      type: "array",
      minItems: 2,
      maxItems: 7,
      items: [{ type: "string" }, { type: "number" }],
      additionalItems: true,
    },
    {
      type: "object",
      required: ["step"],
      additionalProperties: false,
      properties: {
        step: {
          type: "object",
          required: ["path", "t"],
          properties: { path: { type: "string" }, t: { type: "number" } },
        },
      },
    },
  ],
} as const;

/** A run reports its stop reason as `outcome`, or as the pair `state` and `script_execution`. */
const run = {
  type: "object",
  required: ["run", "start", "context", "config", "steps"],
  additionalProperties: false,
  properties: {
    run: { type: "string", minLength: 1 },
    start: { type: "string", pattern: runStart },
    duration_ms: { type: "number" },
    trigger: { type: ["string", "null"] },
    outcome: { type: "string" },
    state: { type: "string" },
    script_execution: { type: ["string", "null"] },
    error: { type: "string" },
    not_triggered: { const: true },
    context: {},
    parent_context: {},
    user: { type: "string" },
    config: { type: ["integer", "null"], minimum: 0 },
    blueprint_inputs: {},
    last_step: { type: ["string", "null"] },
    steps_order: { const: "recorded" },
    extra: object,
    steps: { type: "array", items: step },
  },
  oneOf: [
    {
      required: ["outcome"],
      not: {
        anyOf: [{ required: ["state"] }, { required: ["script_execution"] }],
      },
    },
    { required: ["state", "script_execution"], not: { required: ["outcome"] } },
  ],
} as const;

const standardDocument = {
  type: "object",
  required: [...envelopeRequired, "configs", "items"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "standard" },
    strings: { type: "array", items: { type: "string" } },
    values: { type: "array" },
    configs: { type: "array" },
    ids: { type: "object", additionalProperties: { type: "string" } },
    items: {
      description: "item (entity ID, or `<domain>:<item_id>`) -> its runs",
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["runs"],
        additionalProperties: false,
        properties: {
          this: {
            type: "object",
            required: ["entity_id", "attributes"],
            additionalProperties: false,
            properties: { entity_id: { type: "string" }, attributes: {} },
          },
          runs: { type: "array", items: run },
        },
      },
    },
  },
} as const;

/** `[run, start, duration_ms, trigger, outcome, last_step, context, error?]` */
const summaryRow = {
  type: "array",
  minItems: 7,
  maxItems: 8,
  items: [
    { type: "string", minLength: 1 },
    { type: "string", pattern: rowStart },
    { type: ["integer", "null"] },
    { type: ["string", "null"] },
    { type: "string" },
    { type: ["string", "null"] },
    { type: "string" },
    { type: "string" },
  ],
} as const;

const summaryDocument = {
  type: "object",
  required: [...envelopeRequired, "columns", "items"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "summary" },
    columns: { const: [...TRACE_SUMMARY_COLUMNS] },
    items: {
      type: "object",
      additionalProperties: { type: "array", items: summaryRow },
    },
  },
} as const;

/** JSON Schema (draft-07) of a `domusops.trace/0.1` document at either detail level (FR-021). */
export const traceJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DomusOps ha_trace document",
  oneOf: [summaryDocument, standardDocument],
} as const;
