import { LOGBOOK_FORMAT } from "./format.js";

const object = { type: "object" } as const;
const count = { type: "integer", minimum: 0 } as const;
const localIso =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2})?$";
const nullableTime = { type: ["string", "null"], pattern: localIso } as const;

const envelope = {
  format: { const: LOGBOOK_FORMAT },
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
  first: nullableTime,
  last: nullableTime,
  selectors: { type: "array", items: { type: "string" } },
  no_events: { type: "array", items: { type: "string" } },
} as const;

const envelopeRequired = [
  "format",
  "detail",
  "ha_version",
  "compression_ratio",
  "time_zone",
  "utc_offset",
  "window",
  "first",
  "last",
] as const;

/** An entity entry is a bare ID, or `[id | null, constants, columns]`. */
const entity = {
  oneOf: [
    { type: "string" },
    {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: [
        { type: ["string", "null"] },
        object,
        { type: "array", items: { type: "string" } },
      ],
    },
  ],
} as const;

/** `[time, entity, state, cause, ...columns]`: at least the first two, which are always present. */
const eventRow = {
  type: "array",
  minItems: 2,
  items: [{ type: "string", pattern: "^\\d{2}:\\d{2}$" }, count],
  additionalItems: true,
} as const;

const standardDocument = {
  type: "object",
  required: [...envelopeRequired, "entities", "events"],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "standard" },
    strings: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: entity },
    causes: { type: "array", items: object },
    events: {
      description: "local date -> hour key -> rows",
      type: "object",
      additionalProperties: false,
      patternProperties: {
        "^\\d{4}-\\d{2}-\\d{2}$": {
          type: "object",
          additionalProperties: false,
          patternProperties: {
            "^\\d{2}:00([+-]\\d{2}:\\d{2})?$": {
              type: "array",
              items: eventRow,
            },
          },
        },
      },
    },
  },
} as const;

const summaryDocument = {
  type: "object",
  required: [
    ...envelopeRequired,
    "counts",
    "by_domain",
    "by_entity",
    "by_cause",
  ],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "summary" },
    counts: {
      type: "object",
      required: ["events", "entities", "causes", "no_entity_events"],
      additionalProperties: false,
      properties: {
        events: count,
        entities: count,
        causes: count,
        no_entity_events: count,
      },
    },
    by_domain: { type: "object", additionalProperties: count },
    by_entity: {
      type: "object",
      additionalProperties: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: [count, { type: "string" }, { type: "string" }],
      },
    },
    by_cause: {
      type: "array",
      items: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: [object, count],
      },
    },
  },
} as const;

/** JSON Schema (draft-07) of a `domusops.logbook/0.1` document at either detail level (FR-020). */
export const logbookJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DomusOps ha_logbook_query document",
  oneOf: [summaryDocument, standardDocument],
} as const;
