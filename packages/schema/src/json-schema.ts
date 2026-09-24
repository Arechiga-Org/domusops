import { FORMAT } from "./format.js";

const object = { type: "object" } as const;
const stringOrNull = { type: ["string", "null"] } as const;
const count = { type: "integer", minimum: 0 } as const;

const envelope = {
  format: { const: FORMAT },
  ha_version: { type: "string" },
  compression_ratio: { type: "number", minimum: 0 },
} as const;

const groups = {
  type: "object",
  description:
    'Rows grouped by template key. The key "_" holds inline records (objects); every other key ' +
    "holds positional rows (arrays), optionally ending with an extras object.",
  additionalProperties: { type: "array" },
} as const;

const standardDocument = {
  type: "object",
  required: [
    "format",
    "detail",
    "ha_version",
    "compression_ratio",
    "config",
    "areas",
    "entries",
    "templates",
    "devices",
    "integrations",
  ],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { enum: ["standard", "full"] },
    config: object,
    areas: { type: "object", additionalProperties: object },
    entries: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    templates: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["const", "cols"],
        additionalProperties: false,
        properties: {
          const: object,
          cols: { type: "array", items: { type: "string" } },
        },
      },
    },
    devices: groups,
    integrations: {
      type: "object",
      description: "integration -> entry group -> domain -> groups",
      additionalProperties: {
        type: "object",
        additionalProperties: { type: "object", additionalProperties: groups },
      },
    },
  },
} as const;

const summaryDocument = {
  type: "object",
  required: [
    "format",
    "detail",
    "ha_version",
    "compression_ratio",
    "config",
    "counts",
    "by_domain",
    "by_integration",
    "areas",
    "unassigned",
  ],
  additionalProperties: false,
  properties: {
    ...envelope,
    detail: { const: "summary" },
    config: object,
    counts: {
      type: "object",
      required: [
        "entities",
        "devices",
        "areas",
        "integrations",
        "entries",
        "unregistered_entities",
        "disabled_entities",
      ],
      additionalProperties: false,
      properties: {
        entities: count,
        devices: count,
        areas: count,
        integrations: count,
        entries: count,
        unregistered_entities: count,
        disabled_entities: count,
      },
    },
    by_domain: { type: "object", additionalProperties: count },
    by_integration: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["entities", "devices", "entries", "domains"],
        additionalProperties: false,
        properties: {
          entities: count,
          devices: count,
          entries: count,
          domains: { type: "object", additionalProperties: count },
        },
      },
    },
    areas: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["name", "devices", "entities"],
        additionalProperties: false,
        properties: { name: stringOrNull, devices: count, entities: count },
      },
    },
    unassigned: {
      type: "object",
      required: ["devices", "entities"],
      additionalProperties: false,
      properties: { devices: count, entities: count },
    },
  },
} as const;

/** JSON Schema (draft-07) of a `domusops.snapshot/0.1` document at any detail level (FR-021). */
export const snapshotJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DomusOps ha_snapshot document",
  oneOf: [summaryDocument, standardDocument],
} as const;
