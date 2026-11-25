import { COMPARISON_KEYS } from "./check.js";
import { SCENARIO_FORMAT } from "./format.js";

const ENTITY_ID = "^[a-z0-9_]+\\.[a-z0-9_]+$";
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });

const scalar = { type: ["string", "number", "boolean"] } as const;

const idOrList = (item: object) => ({
  anyOf: [item, { type: "array", minItems: 1, items: item }],
});

const nonEmptyText = { type: "string", minLength: 1 } as const;

const operator = (key: string, operand: object) => ({
  type: "object",
  required: [key],
  maxProperties: 1,
  properties: { [key]: operand },
});

/** Entity expectation: exactly one entity key, and optionally `settle` beside it. */
const entityExpectation = (extra: object, required: string[]) => ({
  type: "object",
  ...extra,
  required,
  patternProperties: { [ENTITY_ID]: ref("expectedEntityValue") },
  properties: { settle: ref("settle") },
  additionalProperties: false,
});

const scenarioProperties = {
  scenario: { type: "string", pattern: "^[a-z0-9][a-z0-9_]{0,63}$" },
  description: { type: "string" },
  given: ref("given"),
  when: {
    anyOf: [ref("step"), { type: "array", minItems: 1, items: ref("step") }],
  },
  then: { type: "array", minItems: 1, items: ref("expectation") },
  timeout: { type: "number", minimum: 30, maximum: 3600 },
  settle: ref("settle"),
} as const;

const required = ["scenario", "given", "when", "then"];

/**
 * JSON Schema of a `domusops.scenario/0.1` document, for editors. It follows
 * `checkScenarioDocument` for the grammar's shape; what a schema cannot say (a real calendar
 * day, a `between` whose low is not above its high, names unique across files) is left to the
 * checker.
 */
export const scenarioJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SCENARIO_FORMAT,
  title: SCENARIO_FORMAT,
  type: "object",
  required: ["format"],
  properties: { format: { const: SCENARIO_FORMAT } },
  oneOf: [
    {
      required,
      properties: { format: { const: SCENARIO_FORMAT }, ...scenarioProperties },
      additionalProperties: false,
    },
    {
      required: ["scenarios"],
      properties: {
        format: { const: SCENARIO_FORMAT },
        scenarios: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required,
            properties: scenarioProperties,
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  ],
  $defs: {
    entityId: { type: "string", pattern: ENTITY_ID },
    automationId: { type: "string", pattern: "^automation\\.[a-z0-9_]+$" },
    settle: { type: "number", exclusiveMinimum: 0, maximum: 3600 },
    times: { type: "integer", minimum: 0 },
    entityValue: {
      anyOf: [
        scalar,
        {
          type: "object",
          required: ["state"],
          properties: {
            state: scalar,
            attributes: { type: "object" },
          },
        },
      ],
    },
    given: {
      type: "object",
      properties: {
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        time: {
          type: "string",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$",
        },
      },
      patternProperties: { [ENTITY_ID]: ref("entityValue") },
      additionalProperties: false,
    },
    target: {
      anyOf: [
        ref("entityId"),
        { type: "array", minItems: 1, items: ref("entityId") },
        {
          type: "object",
          minProperties: 1,
          properties: {
            entity_id: idOrList(ref("entityId")),
            device_id: idOrList(nonEmptyText),
            area_id: idOrList(nonEmptyText),
          },
          additionalProperties: false,
        },
      ],
    },
    step: {
      oneOf: [
        {
          type: "object",
          required: ["action"],
          properties: {
            action: ref("entityId"),
            target: ref("target"),
            data: { type: "object" },
          },
          additionalProperties: false,
        },
        {
          type: "object",
          required: ["event"],
          properties: {
            event: { type: "string", pattern: "^[a-z0-9_]+$" },
            data: { type: "object" },
          },
          additionalProperties: false,
        },
        {
          type: "object",
          minProperties: 1,
          patternProperties: { [ENTITY_ID]: ref("entityValue") },
          additionalProperties: false,
        },
      ],
    },
    comparison: {
      anyOf: [
        { type: ["string", "number", "boolean", "null", "array"] },
        {
          type: "object",
          propertyNames: { not: { enum: [...COMPARISON_KEYS] } },
        },
        operator("not", {}),
        operator("in", { type: "array", minItems: 1 }),
        operator("at_least", { type: "number" }),
        operator("at_most", { type: "number" }),
        operator("between", {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "number" },
        }),
      ],
    },
    expectedEntityValue: {
      anyOf: [
        { type: ["string", "number", "boolean", "null"] },
        {
          type: "object",
          minProperties: 1,
          properties: {
            attributes: {
              type: "object",
              additionalProperties: ref("comparison"),
            },
          },
          additionalProperties: ref("comparison"),
        },
      ],
    },
    expectation: {
      oneOf: [
        entityExpectation({ minProperties: 1, maxProperties: 1 }, []),
        entityExpectation({ minProperties: 2, maxProperties: 2 }, ["settle"]),
        {
          type: "object",
          required: ["triggered"],
          properties: {
            triggered: ref("automationId"),
            times: ref("times"),
            settle: ref("settle"),
          },
          additionalProperties: false,
        },
        {
          type: "object",
          required: ["called"],
          properties: {
            called: ref("entityId"),
            target: ref("target"),
            data: { type: "object", additionalProperties: ref("comparison") },
            times: ref("times"),
            settle: ref("settle"),
          },
          additionalProperties: false,
        },
        {
          type: "object",
          required: ["not_called"],
          properties: {
            not_called: ref("entityId"),
            target: ref("target"),
            data: { type: "object", additionalProperties: ref("comparison") },
            settle: ref("settle"),
          },
          additionalProperties: false,
        },
      ],
    },
  },
} as const;
