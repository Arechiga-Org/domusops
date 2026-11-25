import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkScenarioDocument,
  type ScenarioIssue,
  type ScenarioIssueCode,
} from "../src/index.js";

type Doc = Record<string, unknown>;

const base = (): Doc => ({
  format: "domusops.scenario/0.1",
  scenario: "s",
  given: {},
  when: { "binary_sensor.x": "on" },
  then: [{ "light.x": "on" }],
});

const withKey = (key: string, value: unknown): Doc => ({
  ...base(),
  [key]: value,
});

/** The codes and paths of the issues of `doc`. */
const issues = (doc: unknown): [ScenarioIssueCode, string][] =>
  checkScenarioDocument(doc).map((i: ScenarioIssue) => [i.code, i.path]);

describe("checkScenarioDocument", () => {
  it("accepts the SEED example once it names the format", () => {
    const seed = JSON.parse(
      readFileSync(
        new URL("./fixtures/scenarios/valid/seed.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    expect(checkScenarioDocument(seed)).toEqual([]);
  });

  it("accepts both top-level shapes", () => {
    expect(checkScenarioDocument(base())).toEqual([]);
    const several = {
      format: "domusops.scenario/0.1",
      scenarios: [
        {
          scenario: "a",
          given: {},
          when: [{ "x.y": "on" }],
          then: [{ "x.y": "on" }],
        },
      ],
    };
    expect(checkScenarioDocument(several)).toEqual([]);
  });

  it("refuses a document that is not a mapping", () => {
    expect(issues([])).toEqual([["wrong_type", ""]]);
    expect(issues("scenario")).toEqual([["wrong_type", ""]]);
    expect(issues(null)).toEqual([["wrong_type", ""]]);
  });

  it("requires the format and refuses another version naming the one it reads", () => {
    const noFormat = base();
    delete noFormat["format"];
    expect(issues(noFormat)).toEqual([["format_missing", ""]]);
    const newer = checkScenarioDocument(
      withKey("format", "domusops.scenario/0.2"),
    );
    expect(newer).toHaveLength(1);
    expect(newer[0]).toMatchObject({
      code: "format_unsupported",
      path: "/format",
    });
    expect(newer[0]?.message).toContain("domusops.scenario/0.1");
    expect(issues(withKey("format", 1))).toEqual([["wrong_type", "/format"]]);
  });

  it("refuses unknown keys everywhere with their path", () => {
    expect(issues(withKey("extra", 1))).toEqual([["unknown_key", "/extra"]]);
    expect(issues(withKey("given", { stand_ins: {} }))).toEqual([
      ["unknown_key", "/given/stand_ins"],
    ]);
    expect(issues(withKey("when", [{ advance: 5 }]))).toEqual([
      ["unknown_key", "/when/0/advance"],
    ]);
    expect(issues(withKey("then", [{ "light.x": "on", within: 5 }]))).toEqual([
      ["unknown_key", "/then/0/within"],
    ]);
    expect(issues(withKey("starting_points", {}))).toEqual([
      ["unknown_key", "/starting_points"],
    ]);
  });

  it("reports every issue at once, not the first", () => {
    const doc = {
      format: "domusops.scenario/0.1",
      scenario: "Bad",
      given: { "Light.X": "on", time: "25:00" },
      when: [],
      then: [{ called: "nope" }],
    };
    expect(
      issues(doc)
        .map(([code]) => code)
        .sort(),
    ).toEqual([
      "bad_action",
      "bad_entity_id",
      "bad_name",
      "bad_time",
      "empty_list",
    ]);
  });

  it("requires the name, given, when and then", () => {
    for (const key of ["scenario", "given", "when", "then"]) {
      const doc = base();
      delete doc[key];
      expect(issues(doc)).toEqual([["missing_key", ""]]);
    }
    // With nothing of a scenario in sight, one issue says what the document needs.
    expect(issues({ format: "domusops.scenario/0.1" })).toEqual([
      ["missing_key", ""],
    ]);
    expect(issues({ ...base(), scenarios: [] })).toEqual([
      ["exclusive_keys", ""],
    ]);
  });

  it("checks the wrong type of each section", () => {
    expect(issues(withKey("scenario", 4))).toEqual([
      ["wrong_type", "/scenario"],
    ]);
    expect(issues(withKey("description", 4))).toEqual([
      ["wrong_type", "/description"],
    ]);
    expect(issues(withKey("given", []))).toEqual([["wrong_type", "/given"]]);
    expect(issues(withKey("when", 3))).toEqual([["wrong_type", "/when"]]);
    expect(issues(withKey("then", {}))).toEqual([["wrong_type", "/then"]]);
    expect(issues({ format: "domusops.scenario/0.1", scenarios: {} })).toEqual([
      ["wrong_type", "/scenarios"],
    ]);
  });

  it("checks names, entity IDs, actions, times and dates", () => {
    expect(issues(withKey("scenario", "Has Space"))).toEqual([
      ["bad_name", "/scenario"],
    ]);
    expect(issues(withKey("given", { "Light.X": "on" }))).toEqual([
      ["bad_entity_id", "/given/Light.X"],
    ]);
    expect(issues(withKey("then", [{ called: "turn_on" }]))).toEqual([
      ["bad_action", "/then/0/called"],
    ]);
    expect(issues(withKey("then", [{ triggered: "light.x" }]))).toEqual([
      ["bad_entity_id", "/then/0/triggered"],
    ]);
    expect(issues(withKey("given", { time: "24:30" }))).toEqual([
      ["bad_time", "/given/time"],
    ]);
    expect(issues(withKey("given", { time: 300 }))).toEqual([
      ["wrong_type", "/given/time"],
    ]);
    expect(issues(withKey("given", { date: "2026-02-29" }))).toEqual([
      ["bad_date", "/given/date"],
    ]);
    expect(
      issues(withKey("given", { date: "2028-02-29", time: "07:00:30" })),
    ).toEqual([]);
    expect(issues(withKey("when", [{ event: "Door Bell" }]))).toEqual([
      ["bad_name", "/when/0/event"],
    ]);
  });

  it("checks the time limit and the settle time", () => {
    expect(issues(withKey("timeout", 30))).toEqual([]);
    expect(issues(withKey("timeout", 29))).toEqual([
      ["bad_duration", "/timeout"],
    ]);
    expect(issues(withKey("timeout", 3601))).toEqual([
      ["bad_duration", "/timeout"],
    ]);
    expect(issues(withKey("settle", 0))).toEqual([["bad_duration", "/settle"]]);
    expect(issues(withKey("settle", 2.5))).toEqual([]);
    expect(issues(withKey("then", [{ "light.x": "on", settle: "5" }]))).toEqual(
      [["bad_duration", "/then/0/settle"]],
    );
  });

  it("checks entity values: a state, or a mapping with a state", () => {
    expect(issues(withKey("given", { "sensor.x": { unit: "C" } }))).toEqual([
      ["missing_key", "/given/sensor.x"],
    ]);
    expect(issues(withKey("given", { "sensor.x": ["a"] }))).toEqual([
      ["wrong_type", "/given/sensor.x"],
    ]);
    expect(issues(withKey("given", { "sensor.x": { state: null } }))).toEqual([
      ["wrong_type", "/given/sensor.x/state"],
    ]);
    expect(
      issues(withKey("given", { "sensor.x": { state: 1, attributes: [] } })),
    ).toEqual([["wrong_type", "/given/sensor.x/attributes"]]);
    expect(
      issues(
        withKey("given", {
          "sensor.x": { state: 1, attributes: { state: 2 } },
        }),
      ),
    ).toEqual([]);
  });

  it("checks steps: one kind each, with their own keys", () => {
    expect(issues(withKey("when", [{}]))).toEqual([["missing_key", "/when/0"]]);
    expect(
      issues(withKey("when", [{ action: "light.turn_on", "light.x": "on" }])),
    ).toEqual([["exclusive_keys", "/when/0"]]);
    expect(
      issues(withKey("when", [{ action: "light.turn_on", event: "x" }])),
    ).toEqual([["exclusive_keys", "/when/0"]]);
    expect(
      issues(withKey("when", [{ action: "light.turn_on", extra: 1 }])),
    ).toEqual([["unknown_key", "/when/0/extra"]]);
    expect(
      issues(withKey("when", [{ "light.x": "on", target: "light.y" }])),
    ).toEqual([["unknown_key", "/when/0/target"]]);
    expect(issues(withKey("when", [{ event: "doorbell", data: [] }]))).toEqual([
      ["wrong_type", "/when/0/data"],
    ]);
    expect(issues(withKey("when", ["advance"]))).toEqual([
      ["wrong_type", "/when/0"],
    ]);
  });

  it("checks targets in every written form", () => {
    const step = (target: unknown): unknown =>
      withKey("when", { action: "light.turn_on", target });
    expect(issues(step("light.x"))).toEqual([]);
    expect(issues(step(["light.x", "light.y"]))).toEqual([]);
    expect(
      issues(
        step({ entity_id: "light.x", device_id: ["d1"], area_id: "kitchen" }),
      ),
    ).toEqual([]);
    expect(issues(step("Light.X"))).toEqual([
      ["bad_entity_id", "/when/target"],
    ]);
    expect(issues(step([]))).toEqual([["empty_list", "/when/target"]]);
    expect(issues(step({}))).toEqual([["missing_key", "/when/target"]]);
    expect(issues(step({ entity_id: ["nope"] }))).toEqual([
      ["bad_entity_id", "/when/target/entity_id/0"],
    ]);
    expect(issues(step({ floor: "x" }))).toEqual([
      ["unknown_key", "/when/target/floor"],
    ]);
  });

  it("checks comparisons", () => {
    const state = (value: unknown): unknown =>
      withKey("then", [{ "sensor.x": { state: value } }]);
    const path = "/then/0/sensor.x/state";
    for (const good of [
      "on",
      3,
      null,
      [1, 2],
      { nested: "value" },
      { not: "on" },
      { in: ["a"] },
      { at_least: 1 },
      { at_most: 1 },
      { between: [1, 1] },
    ]) {
      expect(issues(state(good))).toEqual([]);
    }
    expect(issues(state({ between: [3, 1] }))).toEqual([
      ["bad_comparison", `${path}/between`],
    ]);
    expect(issues(state({ between: [1] }))).toEqual([
      ["bad_comparison", `${path}/between`],
    ]);
    expect(issues(state({ in: [] }))).toEqual([
      ["bad_comparison", `${path}/in`],
    ]);
    expect(issues(state({ in: "a" }))).toEqual([
      ["bad_comparison", `${path}/in`],
    ]);
    expect(issues(state({ at_least: "1" }))).toEqual([
      ["bad_comparison", `${path}/at_least`],
    ]);
    expect(issues(state({ not: 1, in: [1] }))).toEqual([
      ["bad_comparison", path],
    ]);
    expect(issues(state({ at_least: 1, extra: 2 }))).toEqual([
      ["bad_comparison", path],
    ]);
  });

  it("checks entity expectations: one entity key, a state or an attribute", () => {
    expect(
      issues(withKey("then", [{ "light.a": "on", "light.b": "on" }])),
    ).toEqual([["exclusive_keys", "/then/0"]]);
    expect(issues(withKey("then", [{ "light.a": {} }]))).toEqual([
      ["missing_key", "/then/0/light.a"],
    ]);
    expect(issues(withKey("then", [{ "light.a": [1] }]))).toEqual([
      ["wrong_type", "/then/0/light.a"],
    ]);
    expect(issues(withKey("then", [{ "light.a": { attributes: 3 } }]))).toEqual(
      [["wrong_type", "/then/0/light.a/attributes"]],
    );
    expect(
      issues(
        withKey("then", [
          { "light.a": { attributes: { b: { between: [2, 1] } } } },
        ]),
      ),
    ).toEqual([["bad_comparison", "/then/0/light.a/attributes/b/between"]]);
    expect(issues(withKey("then", [{ "light.a": "on", times: 1 }]))).toEqual([
      ["unknown_key", "/then/0/times"],
    ]);
    expect(issues(withKey("then", [{}]))).toEqual([["missing_key", "/then/0"]]);
    expect(issues(withKey("then", [{ nothing: 1 }]))).toEqual([
      ["unknown_key", "/then/0/nothing"],
    ]);
  });

  it("checks triggered, called and not_called", () => {
    expect(
      issues(
        withKey("then", [
          { triggered: "automation.a", times: 0 },
          {
            called: "notify.phone",
            target: "notify.x",
            data: { m: { in: ["a"] } },
            times: 2,
          },
          { not_called: "siren.turn_on", target: { area_id: "a" } },
        ]),
      ),
    ).toEqual([]);
    expect(
      issues(withKey("then", [{ triggered: "automation.a", times: -1 }])),
    ).toEqual([["wrong_type", "/then/0/times"]]);
    expect(
      issues(withKey("then", [{ triggered: "automation.a", times: 1.5 }])),
    ).toEqual([["wrong_type", "/then/0/times"]]);
    expect(
      issues(withKey("then", [{ triggered: "automation.a", data: {} }])),
    ).toEqual([["unknown_key", "/then/0/data"]]);
    expect(
      issues(withKey("then", [{ called: "a.b", triggered: "automation.a" }])),
    ).toEqual([["exclusive_keys", "/then/0"]]);
    expect(
      issues(withKey("then", [{ called: "a.b", not_called: "a.b" }])),
    ).toEqual([["exclusive_keys", "/then/0"]]);
    expect(issues(withKey("then", [{ not_called: "a.b", times: 1 }]))).toEqual([
      ["exclusive_keys", "/then/0/times"],
    ]);
    expect(issues(withKey("then", [{ called: "a.b", data: [] }]))).toEqual([
      ["wrong_type", "/then/0/data"],
    ]);
    expect(
      issues(withKey("then", [{ called: "a.b", data: { x: { in: [] } } }])),
    ).toEqual([["bad_comparison", "/then/0/data/x/in"]]);
  });

  it("checks the list of scenarios with the path of each issue", () => {
    const doc = {
      format: "domusops.scenario/0.1",
      scenarios: [base(), { ...base(), scenario: "t", then: [] }, 5],
    };
    delete (doc.scenarios[0] as Doc)["format"];
    delete (doc.scenarios[1] as Doc)["format"];
    expect(issues(doc)).toEqual([
      ["empty_list", "/scenarios/1/then"],
      ["wrong_type", "/scenarios/2"],
    ]);
    expect(issues({ format: "domusops.scenario/0.1", scenarios: [] })).toEqual([
      ["empty_list", "/scenarios"],
    ]);
    expect(
      issues({ format: "domusops.scenario/0.1", scenarios: [], extra: 1 }),
    ).toEqual([
      ["unknown_key", "/extra"],
      ["empty_list", "/scenarios"],
    ]);
  });

  it("escapes ~ and / in the path of a key", () => {
    expect(issues(withKey("given", { "a/b": 1 }))).toEqual([
      ["unknown_key", "/given/a~1b"],
    ]);
  });
});
