import { SYSTEM_LOG_FORMAT, SYSTEM_LOG_LEVELS } from "./format.js";

const count = { type: "integer", minimum: 0 } as const;
const index = { type: "integer", minimum: 0 } as const;
const strings = { type: "array", items: { type: "string" } } as const;
const level = { enum: SYSTEM_LOG_LEVELS } as const;
const localIso =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2})?$";
const localTime = "^\\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2})?$";

const envelope = {
  format: { const: SYSTEM_LOG_FORMAT },
  ha_version: { type: "string" },
  compression_ratio: { type: "number", minimum: 0 },
  time_zone: { type: "string", minLength: 1 },
  utc_offset: { type: "string", pattern: "^[+-]\\d{2}:\\d{2}$" },
  integrations: strings,
  level,
  start: { type: "string", pattern: localIso },
  custom: strings,
} as const;

const envelopeRequired = [
  "format",
  "detail",
  "ha_version",
  "compression_ratio",
  "time_zone",
  "utc_offset",
] as const;

/** `[file, line, function]` or `[file, line, function, code]` (data-model §3). */
const frame = {
  type: "array",
  minItems: 3,
  maxItems: 4,
  items: [index, index, { type: "string" }, { type: "string" }],
} as const;

/**
 * `[time, level, logger, integration, source, count, messages, first, traceback, by_source]`,
 * trailing `null` values dropped (data-model §3).
 */
const entry = {
  type: "array",
  minItems: 7,
  maxItems: 10,
  items: [
    { type: "string", pattern: localTime },
    level,
    { type: "string" },
    { type: ["string", "null"] },
    { type: "array", minItems: 2, maxItems: 2, items: [index, index] },
    { type: "integer", minimum: 1 },
    strings,
    {
      oneOf: [
        { type: "null" },
        { type: "string", pattern: localTime },
        { type: "string", pattern: localIso },
      ],
    },
    {
      type: ["array", "null"],
      items: { oneOf: [index, { type: "string" }] },
    },
    { const: 1 },
  ],
} as const;

const standardDocument = {
  type: "object",
  required: [...envelopeRequired, "files", "parts", "entries"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "standard" },
    files: strings,
    parts: {
      type: "array",
      items: { oneOf: [{ type: "string" }, frame] },
    },
    entries: {
      description: "local date -> entries",
      type: "object",
      propertyNames: { pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      additionalProperties: { type: "array", items: entry },
    },
  },
} as const;

const pair = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: [count, count],
} as const;

const byLevel = {
  type: "object",
  propertyNames: level,
  additionalProperties: pair,
} as const;

const summaryDocument = {
  type: "object",
  required: [...envelopeRequired, "counts", "by_integration"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "summary" },
    counts: {
      type: "object",
      required: ["entries", "occurrences"],
      additionalProperties: false,
      properties: { entries: count, occurrences: count },
    },
    by_integration: {
      description: "domain -> level -> [entries, occurrences]",
      type: "object",
      additionalProperties: byLevel,
    },
    without_integration: byLevel,
  },
} as const;

/** JSON Schema (draft-07) of a `domusops.system_log/0.1` document at either detail level (FR-016). */
export const systemLogJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DomusOps ha_system_log document",
  oneOf: [summaryDocument, standardDocument],
} as const;
