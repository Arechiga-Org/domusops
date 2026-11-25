import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  checkScenarioDocument,
  scenarioJsonSchema,
  scenarioReportJsonSchema,
} from "../src/index.js";

const root = new URL("./fixtures/scenarios/", import.meta.url);

function fixtures(kind: "valid" | "invalid"): [string, unknown][] {
  const dir = new URL(`${kind}/`, root);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [
      name,
      JSON.parse(readFileSync(new URL(name, dir), "utf8")) as unknown,
    ]);
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
const validate = ajv.compile(scenarioJsonSchema);

describe("scenarioJsonSchema", () => {
  it("has fixtures of both kinds", () => {
    expect(fixtures("valid").length).toBeGreaterThan(3);
    expect(fixtures("invalid").length).toBeGreaterThan(10);
  });

  it.each(fixtures("valid"))(
    "checker and JSON Schema both accept %s",
    (_name, doc) => {
      expect(checkScenarioDocument(doc)).toEqual([]);
      expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it.each(fixtures("invalid"))(
    "checker and JSON Schema both refuse %s",
    (_name, doc) => {
      expect(checkScenarioDocument(doc).length).toBeGreaterThan(0);
      expect(validate(doc)).toBe(false);
    },
  );

  describe("scenarioReportJsonSchema", () => {
    const check = ajv.compile(scenarioReportJsonSchema);
    type Row = Record<string, unknown>;
    const row = (doc: Row, index: number): Row => {
      const found = (doc["scenarios"] as Row[])[index];
      if (found === undefined) throw new Error("no such row");
      return found;
    };
    const failure = (doc: Row): Row => {
      const found = (row(doc, 1)["failures"] as Row[])[0];
      if (found === undefined) throw new Error("no failure");
      return found;
    };
    const report = (): Row => ({
      format: "domusops.scenario-report/0.1",
      runner: { name: "@domusops/sandbox", version: "0.2.0" },
      started_at: "2026-11-19T18:02:11Z",
      duration_ms: 41230,
      outcome: "failed",
      counts: { passed: 1, failed: 1, could_not_run: 0, not_run: 0 },
      releases: [{ channel: "stable", release: "2026.11.2" }],
      config: { secrets: "none-referenced", placeholder_keys: [] },
      scenarios: [
        {
          scenario: "hallway_night_motion",
          file: "scenarios/hallway.yaml",
          release: "2026.11.2",
          outcome: "passed",
          start: "2026-04-15T03:00:00+00:00 Wednesday",
          duration_ms: 18410,
          expectations: { passed: 3, failed: 0 },
        },
        {
          scenario: "hallway_off_after_five_minutes",
          file: "scenarios/hallway.yaml",
          release: "2026.11.2",
          outcome: "failed",
          duration_ms: 19970,
          expectations: { passed: 1, failed: 1 },
          failures: [
            {
              at: "when[3].then[0]",
              line: 14,
              subject: "light.hallway",
              check: "state",
              expected: "off",
              actual: "on",
              read_at: "2026-04-15T03:06:00+00:00",
            },
          ],
          activity: { triggered: {}, called: {}, more: 0 },
        },
      ],
    });

    it("accepts the example of the contract, with and without config", () => {
      expect(check(report()), JSON.stringify(check.errors)).toBe(true);
      expect(check({ ...report(), config: null })).toBe(true);
    });

    it("accepts could-not-run and not-run rows", () => {
      const doc = report();
      doc["scenarios"] = [
        {
          scenario: "a",
          file: "a.yaml",
          release: null,
          outcome: "could_not_run",
          duration_ms: 0,
          reason: { code: "runtime_missing", message: "no container runtime" },
        },
        {
          scenario: "b",
          file: "a.yaml",
          release: null,
          outcome: "not_run",
          duration_ms: 0,
        },
      ];
      expect(check(doc), JSON.stringify(check.errors)).toBe(true);
    });

    it("refuses details on the wrong outcome", () => {
      const withFailures = report();
      row(withFailures, 0)["failures"] = row(withFailures, 1)["failures"];
      expect(check(withFailures)).toBe(false);
      const noReason = report();
      row(noReason, 0)["outcome"] = "could_not_run";
      expect(check(noReason)).toBe(false);
      const reasonOnFailed = report();
      row(reasonOnFailed, 1)["reason"] = { code: "not_ready", message: "x" };
      expect(check(reasonOnFailed)).toBe(false);
    });

    it("refuses a check name, a code or a long instance error it does not know", () => {
      const badCheck = report();
      failure(badCheck)["check"] = "exists";
      expect(check(badCheck)).toBe(false);
      const badCode = report();
      (badCode["scenarios"] as Row[])[0] = {
        ...row(badCode, 0),
        outcome: "could_not_run",
        reason: { code: "nope", message: "x" },
      };
      expect(check(badCode)).toBe(false);
      const long = report();
      row(long, 1)["instance_errors"] = [
        { logger: "l", message: "x".repeat(301) },
      ];
      expect(check(long)).toBe(false);
      row(long, 1)["instance_errors"] = [
        { logger: "l", message: "x".repeat(300) },
      ];
      expect(check(long)).toBe(true);
    });
  });

  it.each([
    ["scenario.schema.json", scenarioJsonSchema],
    ["scenario-report.schema.json", scenarioReportJsonSchema],
  ])("ships schema/%s as written from its constant", (name, constant) => {
    // Regenerate with `pnpm --filter @domusops/schema write-schemas` after a build.
    const written = JSON.parse(
      readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8"),
    ) as unknown;
    expect(written).toEqual(JSON.parse(JSON.stringify(constant)));
  });

  it("names the format and compiles as a 2020-12 schema", () => {
    expect(scenarioJsonSchema.title).toBe("domusops.scenario/0.1");
    expect(scenarioJsonSchema.$schema).toContain("2020-12");
    expect(scenarioReportJsonSchema.title).toBe("domusops.scenario-report/0.1");
    expect(() => ajv.compile(scenarioReportJsonSchema)).not.toThrow();
  });
});
