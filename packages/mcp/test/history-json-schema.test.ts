import { readFileSync } from "node:fs";
import { HISTORY_FORMAT, historyJsonSchema } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

/** The `domusops.history/0.1` format (specs/011-ha-history FR-017, data-model §2 to §4). */

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  historyJsonSchema,
);

/** The three JSON examples of the format contract: standard, the filtered entities, summary. */
const [standard, filteredEntities, summary] = [
  ...readFileSync(
    new URL(
      "../../../specs/011-ha-history/contracts/history-format.md",
      import.meta.url,
    ),
    "utf8",
  ).matchAll(/```json\n([\s\S]*?)```/g),
].map((match) => JSON.parse(match[1] as string) as Record<string, unknown>) as [
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
];

const without = (document: object, key: string): object =>
  Object.fromEntries(Object.entries(document).filter(([k]) => k !== key));

/** A standard document whose only entity has `entry`. */
const withEntry = (entry: unknown): object => ({
  ...standard,
  entities: { "sensor.attic_temperature": entry },
});

/** A standard document whose only entity has one change, `row`, at `hour` of a fixed day. */
const withRow = (row: unknown, hour = "08:00"): object =>
  withEntry({ changes: { "2026-09-28": { [hour]: [row] } } });

describe("the history format", () => {
  it("is identified as domusops.history/0.1", () => {
    expect(HISTORY_FORMAT).toBe("domusops.history/0.1");
  });

  it.each([
    ["the standard example", standard],
    [
      "the filtered example",
      {
        ...standard,
        attributes: ["battery_level"],
        entities: filteredEntities,
      },
    ],
    ["the summary example", summary],
    [
      "a summary with rows per entity",
      { ...summary, by_entity: { "light.porch": [3, 1, 2] } },
    ],
    ["a standard document with no entity", { ...standard, entities: {} }],
    ["significant_only", { ...standard, significant_only: true }],
    ["an entity with only a start state", withEntry({ start: ["off", {}] })],
    [
      "an entity with skipped changes",
      withEntry({ start: ["on", {}], skipped: 4 }),
    ],
    ["a row with only a time", withRow(["00:41"])],
    ["a row that removes attributes", withRow(["00:41", null, null, ["rgb"]])],
    ["an hour key with an offset", withRow(["00:41", "on"], "02:00+01:00")],
  ])("accepts %s", (_, document) => {
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["no format", without(standard, "format")],
    [
      "a wrong format identifier",
      { ...standard, format: "domusops.history/9" },
    ],
    ["an unknown detail", { ...standard, detail: "full" }],
    ["a utc_offset without minutes", { ...standard, utc_offset: "+02" }],
    [
      "a window without a start",
      { ...standard, window: { end: "2026-09-28T10:00:00+02:00" } },
    ],
    [
      "a window without an end",
      { ...standard, window: { start: "2026-09-28T08:00:00+02:00" } },
    ],
    ["significant_only false", { ...standard, significant_only: false }],
    ["a standard document without entities", without(standard, "entities")],
    ["an entity entry with an unknown key", withEntry({ context: "x" })],
    ["a start without attributes", withEntry({ start: ["on"] })],
    ["a start whose state is not a string", withEntry({ start: [1, {}] })],
    [
      "a start with four items",
      withEntry({ start: ["on", {}, "2026-09-28T08:00:00", 1] }),
    ],
    ["skipped of zero", withEntry({ start: ["on", {}], skipped: 0 })],
    [
      "a bucket date that is not a date",
      withEntry({ changes: { "28/09/2026": { "08:00": [["00:41"]] } } }),
    ],
    ["an hour key that is not on the hour", withRow(["00:41"], "08:30")],
    ["a row whose time is not MM:SS", withRow(["8:41"])],
    ["a row with five items", withRow(["00:41", null, null, [], 1])],
    ["an empty row", withRow([])],
    ["a row whose set is a list", withRow(["00:41", null, ["a"]])],
    ["a summary without counts", without(summary, "counts")],
    ["a summary without by_domain", without(summary, "by_domain")],
    [
      "a by_domain row of three numbers",
      { ...summary, by_domain: { light: [3, 0, 0] } },
    ],
    [
      "a by_domain row with a negative count",
      { ...summary, by_domain: { light: [3, -1, 0, 0] } },
    ],
    [
      "a by_entity row of four numbers",
      { ...summary, by_entity: { "light.porch": [3, 1, 2, 0] } },
    ],
    ["a summary with attributes", { ...summary, attributes: ["brightness"] }],
    ["an unknown top-level key", { ...standard, user: "Owner" }],
  ])("rejects %s", (_, document) => {
    expect(validate(document)).toBe(false);
  });
});
