import { readFileSync } from "node:fs";
import { SYSTEM_LOG_FORMAT, systemLogJsonSchema } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

/** The `domusops.system_log/0.1` format (specs/012-ha-system-log FR-016, data-model §2 to §4). */

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  systemLogJsonSchema,
);

/** The two JSON examples of the format contract: standard, summary. */
const [standard, summary] = [
  ...readFileSync(
    new URL(
      "../../../specs/012-ha-system-log/contracts/system-log-format.md",
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

/** A standard document whose only entry is `row`, on `date`. */
const withEntry = (row: unknown, date = "2026-11-13"): object => ({
  ...standard,
  entries: { [date]: [row] },
});

const base = [
  "09:15:40",
  "error",
  "homeassistant.components.mqtt.client",
  "mqtt",
  [0, 612],
  3,
  ["Failed to connect"],
];

/** A standard document whose only part is `part`. */
const withPart = (part: unknown): object => ({ ...standard, parts: [part] });

describe("the system log format", () => {
  it("is identified as domusops.system_log/0.1", () => {
    expect(SYSTEM_LOG_FORMAT).toBe("domusops.system_log/0.1");
  });

  it.each([
    ["the standard example", standard],
    ["the summary example", summary],
    [
      "a standard document with no entry",
      { ...standard, files: [], parts: [], entries: {} },
    ],
    [
      "a filtered envelope",
      {
        ...standard,
        integrations: ["mqtt", "hue*"],
        level: "error",
        start: "2026-11-13T08:00:00+01:00",
      },
    ],
    ["an entry of seven items", withEntry(base)],
    [
      "an entry with a time and an offset",
      withEntry(["02:30:00+02:00", ...base.slice(1)]),
    ],
    [
      "an entry whose first occurrence is a time",
      withEntry([...base, "08:00:00"]),
    ],
    [
      "an entry whose first occurrence is on another date",
      withEntry([...base, "2026-11-12T23:59:01"]),
    ],
    [
      "an entry with a traceback of indexes and strings",
      withEntry([...base, null, [0, 1, "ValueError: bad"]]),
    ],
    ["an entry attributed by its source", withEntry([...base, null, null, 1])],
    [
      "an entry with no integration",
      withEntry([...base.slice(0, 3), null, ...base.slice(4)]),
    ],
    ["a frame without code", withPart([0, 12, "<module>"])],
    ["a frame with code", withPart([0, 12, "run", "    run()"])],
    [
      "a summary with no entry",
      {
        ...summary,
        counts: { entries: 0, occurrences: 0 },
        by_integration: {},
        custom: undefined,
        without_integration: undefined,
      },
    ],
  ])("accepts %s", (_, document) => {
    const plain = JSON.parse(JSON.stringify(document)) as unknown;
    expect(validate(plain), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["no format", without(standard, "format")],
    [
      "a wrong format identifier",
      { ...standard, format: "domusops.system_log/9" },
    ],
    ["an unknown detail", { ...standard, detail: "full" }],
    ["a utc_offset without minutes", { ...standard, utc_offset: "+01" }],
    ["a level of info", { ...standard, level: "info" }],
    ["a standard document without files", without(standard, "files")],
    ["a standard document without parts", without(standard, "parts")],
    ["a standard document without entries", without(standard, "entries")],
    ["a part that is a number", withPart(3)],
    ["a frame of two items", withPart([0, 12])],
    ["a frame whose function is not a string", withPart([0, 12, 3])],
    ["a frame of five items", withPart([0, 12, "run", "    run()", "x"])],
    ["an entries date that is not a date", withEntry(base, "13/11/2026")],
    [
      "an entry whose time is not HH:MM:SS",
      withEntry(["9:15", ...base.slice(1)]),
    ],
    ["an entry of six items", withEntry(base.slice(0, 6))],
    ["an entry of eleven items", withEntry([...base, null, null, 1, 1])],
    [
      "an entry with an unknown level",
      withEntry([base[0], "info", ...base.slice(2)]),
    ],
    ["a count of zero", withEntry([...base.slice(0, 5), 0, base[6]])],
    [
      "a source that is a path",
      withEntry([...base.slice(0, 4), "a.py", ...base.slice(5)]),
    ],
    [
      "a source of one number",
      withEntry([...base.slice(0, 4), [0], ...base.slice(5)]),
    ],
    ["a traceback item that is negative", withEntry([...base, null, [-1]])],
    ["a traceback item that is an object", withEntry([...base, null, [{}]])],
    ["a last item other than 1", withEntry([...base, null, null, 2])],
    [
      "a first occurrence that is not a time",
      withEntry([...base, "yesterday"]),
    ],
    ["a summary without counts", without(summary, "counts")],
    ["a summary without by_integration", without(summary, "by_integration")],
    [
      "a count pair of three numbers",
      { ...summary, by_integration: { mqtt: { error: [1, 3, 0] } } },
    ],
    [
      "a count pair with a negative number",
      { ...summary, by_integration: { mqtt: { error: [1, -3] } } },
    ],
    [
      "a count under an unknown level",
      { ...summary, by_integration: { mqtt: { info: [1, 3] } } },
    ],
    ["a summary with files", { ...summary, files: [] }],
    ["an unknown top-level key", { ...standard, user: "Owner" }],
  ])("rejects %s", (_, document) => {
    expect(validate(document)).toBe(false);
  });
});
