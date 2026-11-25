import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTLE_SECONDS,
  checkScenarioDocument,
  normalizeScenarioDocument,
  type ScenarioDraft,
} from "../src/index.js";

const one = (doc: Record<string, unknown>): ScenarioDraft => {
  const full = { format: "domusops.scenario/0.1", ...doc };
  expect(checkScenarioDocument(full)).toEqual([]);
  const [scenario] = normalizeScenarioDocument(full).scenarios;
  if (scenario === undefined) throw new Error("no scenario");
  return scenario;
};

const doc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  scenario: "s",
  given: {},
  when: { "binary_sensor.x": "on" },
  then: [{ "light.x": "on" }],
  ...extra,
});

describe("normalizeScenarioDocument", () => {
  it("turns an entity value into a state and attributes", () => {
    const scenario = one(
      doc({
        given: {
          "switch.a": "on",
          "sensor.b": {
            state: 21.5,
            unit: "C",
            attributes: { state: "kept", extra: 1 },
          },
        },
      }),
    );
    expect(scenario.given.entities).toEqual([
      ["switch.a", { state: "on", attributes: {} }],
      [
        "sensor.b",
        { state: 21.5, attributes: { unit: "C", state: "kept", extra: 1 } },
      ],
    ]);
  });

  it("keeps the date and time as written, normalising the time to seconds", () => {
    expect(one(doc({ given: { time: "03:00" } })).given).toMatchObject({
      time: "03:00:00",
    });
    expect(
      one(doc({ given: { date: "2028-02-29", time: "07:30:15" } })).given,
    ).toMatchObject({
      date: "2028-02-29",
      time: "07:30:15",
    });
    // The defaults depend on `use`, so `resolveSuite` fills them.
    const bare = one(doc()).given;
    expect(bare).not.toHaveProperty("date");
    expect(bare).not.toHaveProperty("time");
    expect(bare).toMatchObject({ use: [], standIns: [], absentActions: [] });
  });

  it("turns a single when step into a one-item list and then into a final expect step", () => {
    const { steps } = one(doc());
    expect(steps.map((s) => s.kind)).toEqual(["states", "expect"]);
    expect(steps[0]).toMatchObject({ path: "/when" });
    expect(steps[1]).toMatchObject({ path: "/then" });
  });

  it("types every kind of step and gives each its JSON Pointer path", () => {
    const { steps } = one(
      doc({
        when: [
          { "binary_sensor.a": "off", "sensor.b": 3 },
          {
            action: "light.turn_on",
            target: { entity_id: "light.x", area_id: ["kitchen"] },
            data: { brightness_pct: 40 },
          },
          { action: "light.turn_off", target: "light.y" },
          { action: "scene.reload" },
          { event: "doorbell_pressed", data: { door: "front" } },
        ],
      }),
    );
    expect(steps).toEqual([
      {
        kind: "states",
        entities: [
          ["binary_sensor.a", { state: "off", attributes: {} }],
          ["sensor.b", { state: 3, attributes: {} }],
        ],
        path: "/when/0",
      },
      {
        kind: "action",
        action: "light.turn_on",
        target: { entity_id: ["light.x"], area_id: ["kitchen"] },
        data: { brightness_pct: 40 },
        path: "/when/1",
      },
      {
        kind: "action",
        action: "light.turn_off",
        target: { entity_id: ["light.y"] },
        data: {},
        path: "/when/2",
      },
      { kind: "action", action: "scene.reload", data: {}, path: "/when/3" },
      {
        kind: "event",
        eventType: "doorbell_pressed",
        data: { door: "front" },
        path: "/when/4",
      },
      expect.objectContaining({ kind: "expect", path: "/then" }),
    ]);
  });

  it("turns a bare value into an equal comparison and a mapping into state and attributes", () => {
    const { steps } = one(
      doc({
        then: [
          { "light.a": "on" },
          {
            "sensor.p": {
              state: { at_least: 100 },
              unit: "W",
              attributes: { n: { not: 1 } },
            },
          },
          {
            "sensor.q": {
              level: { between: [1, 2] },
              kind: { in: ["a", "b"] },
              none: null,
            },
          },
        ],
      }),
    );
    const last = steps.at(-1);
    if (last?.kind !== "expect") throw new Error("no expect step");
    expect(last.expectations).toEqual([
      {
        kind: "entity",
        entityId: "light.a",
        state: { eq: "on" },
        attributes: [],
        within: 0,
        settle: DEFAULT_SETTLE_SECONDS,
        at: "then[0]",
        path: "/then/0",
      },
      {
        kind: "entity",
        entityId: "sensor.p",
        state: { at_least: 100 },
        attributes: [
          ["unit", { eq: "W" }],
          ["n", { not: 1 }],
        ],
        within: 0,
        settle: DEFAULT_SETTLE_SECONDS,
        at: "then[1]",
        path: "/then/1",
      },
      {
        kind: "entity",
        entityId: "sensor.q",
        attributes: [
          ["level", { between: [1, 2] }],
          ["kind", { in: ["a", "b"] }],
          ["none", { eq: null }],
        ],
        within: 0,
        settle: DEFAULT_SETTLE_SECONDS,
        at: "then[2]",
        path: "/then/2",
      },
    ]);
  });

  it("types triggered and called, and turns not_called into called with times 0", () => {
    const { steps } = one(
      doc({
        then: [
          { triggered: "automation.a", times: 1 },
          { triggered: "automation.b" },
          {
            called: "notify.phone",
            target: "notify.x",
            data: { message: { in: ["a"] }, title: "t" },
            times: 2,
          },
          { called: "light.turn_on" },
          { not_called: "siren.turn_on", target: { area_id: "hall" } },
        ],
      }),
    );
    const last = steps.at(-1);
    if (last?.kind !== "expect") throw new Error("no expect step");
    const common = { within: 0, settle: DEFAULT_SETTLE_SECONDS };
    expect(last.expectations).toEqual([
      {
        kind: "triggered",
        automation: "automation.a",
        times: 1,
        ...common,
        at: "then[0]",
        path: "/then/0",
      },
      {
        kind: "triggered",
        automation: "automation.b",
        ...common,
        at: "then[1]",
        path: "/then/1",
      },
      {
        kind: "called",
        action: "notify.phone",
        target: { entity_id: ["notify.x"] },
        data: [
          ["message", { in: ["a"] }],
          ["title", { eq: "t" }],
        ],
        times: 2,
        ...common,
        at: "then[2]",
        path: "/then/2",
      },
      {
        kind: "called",
        action: "light.turn_on",
        data: [],
        ...common,
        at: "then[3]",
        path: "/then/3",
      },
      {
        kind: "called",
        action: "siren.turn_on",
        target: { area_id: ["hall"] },
        data: [],
        times: 0,
        ...common,
        at: "then[4]",
        path: "/then/4",
      },
    ]);
  });

  it("inherits the scenario's settle, then the default; an expectation's own wins", () => {
    const expectations = (extra: Record<string, unknown>, then: unknown[]) => {
      const { steps } = one(doc({ ...extra, then }));
      const last = steps.at(-1);
      if (last?.kind !== "expect") throw new Error("no expect step");
      return last.expectations.map((e) => e.settle);
    };
    expect(expectations({}, [{ "light.x": "on" }])).toEqual([
      DEFAULT_SETTLE_SECONDS,
    ]);
    expect(expectations({ settle: 2 }, [{ "light.x": "on" }])).toEqual([2]);
    expect(
      expectations({ settle: 2 }, [
        { "light.x": "on", settle: 9 },
        { "light.y": "on" },
      ]),
    ).toEqual([9, 2]);
  });

  it("carries the scenario's own timeout and description", () => {
    const scenario = one(doc({ timeout: 60, description: "Words." }));
    expect(scenario).toMatchObject({
      timeout: 60,
      description: "Words.",
      name: "s",
      path: "",
    });
    expect(one(doc())).not.toHaveProperty("timeout");
  });

  it("gives each scenario of a list its own path", () => {
    const file = normalizeScenarioDocument({
      format: "domusops.scenario/0.1",
      scenarios: [doc({ scenario: "a" }), doc({ scenario: "b" })],
    });
    expect(file.scenarios.map((s) => [s.name, s.path])).toEqual([
      ["a", "/scenarios/0"],
      ["b", "/scenarios/1"],
    ]);
    expect(file.scenarios[1]?.steps.map((s) => s.path)).toEqual([
      "/scenarios/1/when",
      "/scenarios/1/then",
    ]);
    expect(file.startingPoints).toEqual([]);
  });
});
