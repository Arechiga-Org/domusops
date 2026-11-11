import { PING_FORMAT } from "./format.js";

const reason = {
  type: "string",
  pattern: "^(version_unsupported|not_admin|integration_missing:[a-z0-9_]+)$",
} as const;

const readiness = {
  type: "object",
  required: ["ready"],
  additionalProperties: false,
  properties: {
    ready: { type: "boolean" },
    reasons: { type: "array", items: reason, minItems: 1 },
  },
  oneOf: [
    { properties: { ready: { const: true } }, not: { required: ["reasons"] } },
    { properties: { ready: { const: false } }, required: ["reasons"] },
  ],
} as const;

/** JSON Schema of a `domusops.ping/0.1` document. */
export const pingJsonSchema = {
  title: "domusops.ping/0.1",
  type: "object",
  required: [
    "format",
    "server",
    "instance",
    "admin",
    "integrations",
    "tools",
    "compression_ratio",
  ],
  additionalProperties: false,
  properties: {
    format: { const: PING_FORMAT },
    server: {
      type: "object",
      required: ["name", "version"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
      },
    },
    instance: {
      type: "object",
      required: ["version", "minimum", "supported", "time_zone"],
      additionalProperties: false,
      properties: {
        version: { type: "string", minLength: 1 },
        minimum: { type: "string", minLength: 1 },
        supported: { type: "boolean" },
        time_zone: { type: "string", minLength: 1 },
      },
    },
    admin: { type: "boolean" },
    integrations: {
      description: "integration name -> whether it is loaded; names are open",
      type: "object",
      additionalProperties: { type: "boolean" },
    },
    tools: {
      description: "tool name -> its readiness; names are open",
      type: "object",
      additionalProperties: readiness,
    },
    next_steps: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
    },
    compression_ratio: { type: "number", minimum: 0 },
  },
} as const;
