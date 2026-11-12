import { readFileSync } from "node:fs";
import { STATE_FORMAT, stateJsonSchema } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

/** The `domusops.state/0.1` format (specs/010-ha-state FR-018, data-model §1 to §3). */

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  stateJsonSchema,
);

/** The two JSON examples of the format contract, standard first. */
const [standard, summary] = [
  ...readFileSync(
    new URL(
      "../../../specs/010-ha-state/contracts/state-format.md",
      import.meta.url,
    ),
    "utf8",
  ).matchAll(/```json\n([\s\S]*?)```/g),
].map((match) => JSON.parse(match[1] as string) as Record<string, unknown>) as [
  Record<string, unknown>,
  Record<string, unknown>,
];

const without = (document: object, key: string): object =>
  Object.fromEntries(Object.entries(document).filter(([k]) => k !== key));

describe("the state format", () => {
  it("is identified as domusops.state/0.1", () => {
    expect(STATE_FORMAT).toBe("domusops.state/0.1");
  });

  it.each([
    ["the standard example", standard],
    ["the summary example", summary],
    [
      "an empty standard document",
      { ...standard, templates: {}, entities: {} },
    ],
  ])("accepts %s", (_, document) => {
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["no format", without(standard, "format")],
    ["a wrong format identifier", { ...standard, format: "domusops.state/9" }],
    ["an unknown detail", { ...standard, detail: "full" }],
    ["a utc_offset without minutes", { ...standard, utc_offset: "+02" }],
    [
      "an anchor that is not a local time",
      { ...standard, anchor: "yesterday" },
    ],
    ["a summary without counts", without(summary, "counts")],
    ["a summary without by_domain", without(summary, "by_domain")],
    [
      "a by_domain row of two numbers",
      { ...summary, by_domain: { light: [3, 0] } },
    ],
    [
      "a by_domain row with a negative count",
      { ...summary, by_domain: { light: [3, -1, 0] } },
    ],
    ["a standard document without templates", without(standard, "templates")],
    ["a standard document without entities", without(standard, "entities")],
    [
      "an inline record without an id",
      { ...standard, entities: { light: { _: [{ state: "on" }] } } },
    ],
    [
      "a positional row without a state",
      { ...standard, entities: { light: { t1: [["porch"]] } } },
    ],
    ["an unknown top-level key", { ...standard, user: "Owner" }],
  ])("rejects %s", (_, document) => {
    expect(validate(document)).toBe(false);
  });
});
