import { HISTORY_FORMAT } from "./format.js";

const object = { type: "object" } as const;
const count = { type: "integer", minimum: 0 } as const;
const strings = { type: "array", items: { type: "string" } } as const;
const localIso =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2})?$";

const envelope = {
  format: { const: HISTORY_FORMAT },
  ha_version: { type: "string" },
  compression_ratio: { type: "number", minimum: 0 },
  time_zone: { type: "string", minLength: 1 },
  utc_offset: { type: "string", pattern: "^[+-]\\d{2}:\\d{2}$" },
  window: {
    type: "object",
    required: ["start", "end"],
    additionalProperties: false,
    properties: {
      start: { type: "string", pattern: localIso },
      end: { type: "string", pattern: localIso },
    },
  },
  selectors: strings,
  significant_only: { const: true },
} as const;

const envelopeRequired = [
  "format",
  "detail",
  "ha_version",
  "compression_ratio",
  "time_zone",
  "utc_offset",
  "window",
] as const;

/** `["MM:SS", state, set, unset]`, trailing `null` values dropped (data-model §3). */
const row = {
  type: "array",
  minItems: 1,
  maxItems: 4,
  items: [
    { type: "string", pattern: "^[0-5]\\d:[0-5]\\d$" },
    { type: ["string", "null"] },
    { type: ["object", "null"] },
    { type: ["array", "null"], items: { type: "string" } },
  ],
} as const;

const entry = {
  type: "object",
  additionalProperties: false,
  properties: {
    start: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: [
        { type: "string" },
        object,
        { type: "string", pattern: localIso },
      ],
    },
    changes: {
      description: "local date -> hour -> rows",
      type: "object",
      propertyNames: { pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      additionalProperties: {
        type: "object",
        propertyNames: { pattern: "^\\d{2}:00([+-]\\d{2}:\\d{2})?$" },
        additionalProperties: { type: "array", items: row },
      },
    },
    skipped: { type: "integer", minimum: 1 },
  },
} as const;

const standardDocument = {
  type: "object",
  required: [...envelopeRequired, "entities"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "standard" },
    // `attributes` is never combined with `summary`, so only `standard` repeats it.
    attributes: strings,
    entities: {
      description: "entity ID -> entry",
      type: "object",
      additionalProperties: entry,
    },
  },
} as const;

const tuple = (length: number) =>
  ({
    type: "array",
    minItems: length,
    maxItems: length,
    items: Array.from({ length }, () => count),
  }) as const;

const summaryDocument = {
  type: "object",
  required: [...envelopeRequired, "counts", "by_domain"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "summary" },
    counts: {
      type: "object",
      required: ["entities", "changes", "state_changes", "attribute_only"],
      additionalProperties: false,
      properties: {
        entities: count,
        changes: count,
        state_changes: count,
        attribute_only: count,
      },
    },
    by_domain: {
      description:
        "domain -> [entities, changes, state_changes, attribute_only]",
      type: "object",
      additionalProperties: tuple(4),
    },
    by_entity: {
      description: "entity ID -> [changes, state_changes, attribute_only]",
      type: "object",
      additionalProperties: tuple(3),
    },
  },
} as const;

/** JSON Schema (draft-07) of a `domusops.history/0.1` document at either detail level (FR-017). */
export const historyJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DomusOps ha_history document",
  oneOf: [summaryDocument, standardDocument],
} as const;
