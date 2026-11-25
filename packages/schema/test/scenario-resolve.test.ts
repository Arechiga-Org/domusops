import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIO_DATE,
  DEFAULT_SCENARIO_TIME,
  DEFAULT_SCENARIO_TIMEOUT_SECONDS,
  normalizeScenarioDocument,
  resolveSuite,
} from "../src/index.js";

const scenario = (name: string, extra: Record<string, unknown> = {}) => ({
  scenario: name,
  given: {},
  when: { "binary_sensor.x": "on" },
  then: [{ "light.x": "on" }],
  ...extra,
});

const file = (name: string, ...scenarios: Record<string, unknown>[]) => ({
  file: name,
  document: normalizeScenarioDocument({
    format: "domusops.scenario/0.1",
    scenarios,
  }),
});

describe("resolveSuite", () => {
  it("returns the scenarios in file order, then position", () => {
    const result = resolveSuite([
      file("scenarios/b.yaml", scenario("b1"), scenario("b2")),
      file("scenarios/a.yaml", scenario("a1")),
    ]);
    if (!result.ok) throw new Error("not ok");
    expect(result.scenarios.map((s) => [s.file, s.name, s.path])).toEqual([
      ["scenarios/b.yaml", "b1", "/scenarios/0"],
      ["scenarios/b.yaml", "b2", "/scenarios/1"],
      ["scenarios/a.yaml", "a1", "/scenarios/0"],
    ]);
  });

  it("fills the date, time, time limit and settle from the defaults", () => {
    const result = resolveSuite([file("a.yaml", scenario("a"))]);
    if (!result.ok) throw new Error("not ok");
    expect(result.scenarios[0]).toMatchObject({
      given: {
        date: DEFAULT_SCENARIO_DATE,
        time: DEFAULT_SCENARIO_TIME,
        entities: [],
        standIns: [],
        absentActions: [],
      },
      timeout: DEFAULT_SCENARIO_TIMEOUT_SECONDS,
      settle: 5,
    });
    expect(DEFAULT_SCENARIO_DATE).toBe("2026-04-15");
    expect(new Date(`${DEFAULT_SCENARIO_DATE}T00:00:00Z`).getUTCDay()).toBe(3);
  });

  it("keeps a stated date and time, and prefers the scenario's own time limit", () => {
    const own = file(
      "a.yaml",
      scenario("a", {
        given: { date: "2027-01-02", time: "07:00" },
        timeout: 90,
      }),
      scenario("b"),
    );
    const result = resolveSuite([own], { defaultTimeout: 600 });
    if (!result.ok) throw new Error("not ok");
    expect(result.scenarios.map((s) => s.timeout)).toEqual([90, 600]);
    expect(result.scenarios[0]?.given).toMatchObject({
      date: "2027-01-02",
      time: "07:00:00",
    });
  });

  it("refuses two scenarios with one name, in a file or across files, naming both places", () => {
    const within = resolveSuite([
      file("a.yaml", scenario("same"), scenario("same")),
    ]);
    expect(within).toEqual({
      ok: false,
      issues: [
        {
          file: "a.yaml",
          path: "/scenarios/1/scenario",
          code: "duplicate_scenario",
          message: expect.stringContaining("a.yaml at /scenarios/0") as string,
        },
      ],
    });
    const across = resolveSuite([
      file("a.yaml", scenario("same")),
      file("sub/b.yaml", scenario("other"), scenario("same")),
    ]);
    if (across.ok) throw new Error("expected issues");
    expect(across.issues).toHaveLength(1);
    expect(across.issues[0]).toMatchObject({
      file: "sub/b.yaml",
      path: "/scenarios/1/scenario",
      code: "duplicate_scenario",
    });
    expect(across.issues[0]?.message).toContain("a.yaml at /scenarios/0");
    expect(across.issues[0]?.message).toContain("sub/b.yaml at /scenarios/1");
  });

  it("applies a default time limit within the range of a scenario's own, and throws outside it", () => {
    const files = [file("a.yaml", scenario("a"))];
    for (const good of [30, 600, 3600]) {
      const result = resolveSuite(files, { defaultTimeout: good });
      expect(result.ok && result.scenarios[0]?.timeout).toBe(good);
    }
    for (const bad of [0, -1, 29, 3601, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveSuite(files, { defaultTimeout: bad })).toThrow(
        RangeError,
      );
    }
  });

  it("names a one-scenario file by its path alone", () => {
    const single = {
      file: "one.yaml",
      document: normalizeScenarioDocument({
        format: "domusops.scenario/0.1",
        ...scenario("same"),
      }),
    };
    const result = resolveSuite([single, file("b.yaml", scenario("same"))]);
    if (result.ok) throw new Error("expected issues");
    expect(result.issues[0]?.message).toContain("one.yaml and");
  });
});
