import { STATE_FORMAT } from "./format.js";

const object = { type: "object" } as const;
const count = { type: "integer", minimum: 0 } as const;
const strings = { type: "array", items: { type: "string" } } as const;
const localIso =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2})?$";

const envelope = {
  format: { const: STATE_FORMAT },
  ha_version: { type: "string" },
  compression_ratio: { type: "number", minimum: 0 },
  time_zone: { type: "string", minLength: 1 },
  utc_offset: { type: "string", pattern: "^[+-]\\d{2}:\\d{2}$" },
  anchor: { type: "string", pattern: localIso },
  selectors: strings,
  domains: strings,
  states: strings,
} as const;

const envelopeRequired = [
  "format",
  "detail",
  "ha_version",
  "compression_ratio",
  "time_zone",
  "utc_offset",
  "anchor",
] as const;

/** As in the snapshot: `_` holds inline records, every other key holds positional rows. */
const groups = {
  type: "object",
  properties: {
    _: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "state"],
        properties: { id: { type: "string" }, state: { type: "string" } },
      },
    },
  },
  additionalProperties: {
    type: "array",
    items: {
      type: "array",
      minItems: 2,
      items: [{ type: "string" }, { type: "string" }],
      additionalItems: true,
    },
  },
} as const;

const standardDocument = {
  type: "object",
  required: [...envelopeRequired, "templates", "entities"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "standard" },
    // `attributes` is never combined with `summary`, so only `standard` repeats it.
    attributes: strings,
    templates: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["const", "cols"],
        additionalProperties: false,
        properties: { const: object, cols: strings },
      },
    },
    entities: {
      description: "domain -> groups",
      type: "object",
      additionalProperties: groups,
    },
  },
} as const;

const summaryDocument = {
  type: "object",
  required: [...envelopeRequired, "counts", "by_domain"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "summary" },
    counts: {
      type: "object",
      required: ["entities", "domains"],
      additionalProperties: false,
      properties: { entities: count, domains: count },
    },
    by_domain: {
      description: "domain -> [entities, unavailable, unknown]",
      type: "object",
      additionalProperties: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: [count, count, count],
      },
    },
  },
} as const;

/** JSON Schema (draft-07) of a `domusops.state/0.1` document at either detail level (FR-018). */
export const stateJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DomusOps ha_state document",
  oneOf: [summaryDocument, standardDocument],
} as const;
