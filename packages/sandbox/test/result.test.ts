import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_MESSAGE,
  RESULT_FORMAT,
  STEP_NAMES,
  readResult,
  runContext,
  stepMessage,
  type RunResult,
} from "../src/results/result.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../schema/run-result.schema.json", import.meta.url),
    "utf8",
  ),
) as object;
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function passed(): RunResult {
  return {
    format: RESULT_FORMAT,
    channel: "stable",
    release: "2026.10.1",
    outcome: "passed",
    steps: STEP_NAMES.map((name) => ({ name, status: "passed", ms: 10 })),
    startedAt: "2026-10-08T10:00:00Z",
    finishedAt: "2026-10-08T10:01:00Z",
    runner: "linux-x64",
    sandboxVersion: "0.1.0",
    ciRunUrl: "https://github.com/owner/repo/actions/runs/1",
  };
}

function failedAt(name: (typeof STEP_NAMES)[number]): RunResult {
  let failed = false;
  return {
    ...passed(),
    outcome: "failed",
    failedStep: name,
    steps: STEP_NAMES.map((step) => {
      if (step === "teardown") return { name: step, status: "passed", ms: 1 };
      if (failed) return { name: step, status: "skipped" };
      if (step === name) {
        failed = true;
        return { name: step, status: "failed", ms: 1, message: "it broke" };
      }
      return { name: step, status: "passed", ms: 1 };
    }),
  };
}

function accepted(result: unknown): boolean {
  return validate(result) === true;
}

describe("the run result schema", () => {
  it("accepts a passed run and a failed run", () => {
    expect(accepted(passed())).toBe(true);
    expect(accepted(failedAt("time"))).toBe(true);
  });

  it("accepts a run that could not start, without a release for a resolve failure", () => {
    const rest = Object.fromEntries(
      Object.entries(passed()).filter(([name]) => name !== "release"),
    ) as RunResult;
    expect(
      accepted({
        ...rest,
        outcome: "could-not-run",
        failedStep: "resolve",
        steps: [],
      }),
    ).toBe(true);
    expect(
      accepted({
        ...passed(),
        outcome: "could-not-run",
        failedStep: "pull",
        steps: [],
      }),
    ).toBe(true);
  });

  it("accepts no beta in progress only for the beta channel and without a release", () => {
    const rest = Object.fromEntries(
      Object.entries(passed()).filter(([name]) => name !== "release"),
    ) as RunResult;
    const none = {
      ...rest,
      channel: "beta",
      outcome: "no-beta-in-progress",
      steps: [],
    };
    expect(accepted(none)).toBe(true);
    expect(accepted({ ...none, channel: "stable" })).toBe(false);
    expect(accepted({ ...none, release: "2026.11.0b1" })).toBe(false);
  });

  it.each([
    [
      "a missing release on a passed run",
      (r: Record<string, unknown>) => delete r["release"],
    ],
    [
      "a failedStep on a passed run",
      (r: Record<string, unknown>) => (r["failedStep"] = "time"),
    ],
    ["an unknown field", (r: Record<string, unknown>) => (r["token"] = "x")],
    [
      "a wrong format",
      (r: Record<string, unknown>) => (r["format"] = "other/1"),
    ],
    [
      "a release that is not a release",
      (r: Record<string, unknown>) => (r["release"] = "latest"),
    ],
    [
      "fewer than eight steps",
      (r: Record<string, unknown>) => (r["steps"] = []),
    ],
    [
      "a local time",
      (r: Record<string, unknown>) => (r["startedAt"] = "2026-10-08T10:00:00"),
    ],
    [
      "a run URL that is not https",
      (r: Record<string, unknown>) => (r["ciRunUrl"] = "http://x/y"),
    ],
  ])("rejects %s", (_label, break_) => {
    const result = passed() as unknown as Record<string, unknown>;
    break_(result);
    expect(accepted(result)).toBe(false);
  });

  it("rejects a failed run without a failedStep, or one blaming resolve", () => {
    const without = Object.fromEntries(
      Object.entries(failedAt("time")).filter(
        ([name]) => name !== "failedStep",
      ),
    ) as RunResult;
    expect(accepted(without)).toBe(false);
    expect(accepted({ ...failedAt("time"), failedStep: "resolve" })).toBe(
      false,
    );
  });

  it("rejects a could-not-run that blames a step, or keeps steps", () => {
    const base = {
      ...passed(),
      outcome: "could-not-run",
      failedStep: "pull",
      steps: [],
    };
    expect(accepted(base)).toBe(true);
    expect(accepted({ ...base, failedStep: "time" })).toBe(false);
    expect(accepted({ ...base, steps: passed().steps })).toBe(false);
  });

  it("accepts a could-not-run result with a reason, and rejects a long one", () => {
    const base = {
      ...passed(),
      outcome: "could-not-run",
      failedStep: "pull",
      steps: [],
      message: "image_unavailable",
    };
    expect(accepted(base)).toBe(true);
    expect(accepted({ ...base, message: "x".repeat(MAX_MESSAGE + 1) })).toBe(
      false,
    );
  });

  it("rejects a message longer than 300 characters", () => {
    const result = failedAt("time");
    const step = result.steps.find((s) => s.name === "time");
    if (step === undefined) throw new Error("unreachable");
    step.message = "x".repeat(MAX_MESSAGE + 1);
    expect(accepted(result)).toBe(false);
    step.message = "x".repeat(MAX_MESSAGE);
    expect(accepted(result)).toBe(true);
  });
});

describe("step messages", () => {
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmNkZWYxMjM0NTYifQ.c2lnbmF0dXJlMTIzNDU2";

  it("hides a named secret and anything shaped like a token", () => {
    const text = stepMessage(
      `bad ${token} and Bearer abc123def456 and hunter2hunter2`,
      ["hunter2hunter2"],
    );
    expect(text).not.toContain(token);
    expect(text).not.toContain("abc123def456");
    expect(text).not.toContain("hunter2hunter2");
  });

  it("makes one line of at most 300 characters", () => {
    const text = stepMessage(`first\nsecond\t${"y".repeat(500)}`);
    expect(text).not.toMatch(/[\n\t]/);
    expect(text).toHaveLength(MAX_MESSAGE);
    expect(text.endsWith("…")).toBe(true);
  });

  it("leaves a short message alone", () => {
    expect(stepMessage("automation did not fire")).toBe(
      "automation did not fire",
    );
  });
});

describe("the run context", () => {
  it("builds the run URL only from a complete GitHub Actions environment", () => {
    expect(
      runContext({
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "42",
      }).ciRunUrl,
    ).toBe("https://github.com/owner/repo/actions/runs/42");
    expect(runContext({}).ciRunUrl).toBeUndefined();
    expect(
      runContext({
        GITHUB_SERVER_URL: "http://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "42",
      }).ciRunUrl,
    ).toBeUndefined();
    expect(
      runContext({
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "x y",
      }).ciRunUrl,
    ).toBeUndefined();
  });

  it("reads the package version and names the runner", () => {
    const context = runContext({});
    expect(context.sandboxVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(context.runner).toBe(`${process.platform}-${process.arch}`);
  });
});

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("reading a result file", () => {
  const write = (text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "domusops-read-"));
    directories.push(dir);
    const file = join(dir, "r.json");
    writeFileSync(file, text);
    return file;
  };

  it("returns a well-formed result", () => {
    const run = passed();
    expect(readResult(write(JSON.stringify(run)))).toEqual(run);
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["another format", '{"format":"x"}'],
    ["no outcome", JSON.stringify({ ...passed(), outcome: undefined })],
    [
      "a release that is not a release",
      JSON.stringify({ ...passed(), release: "| x |" }),
    ],
    [
      "an unknown failed step",
      JSON.stringify({ ...failedAt("time"), failedStep: "x|y" }),
    ],
    [
      "a start that is not an instant",
      JSON.stringify({ ...passed(), startedAt: "yesterday" }),
    ],
    [
      "a finish that is not an instant",
      JSON.stringify({ ...passed(), finishedAt: "2026-10-08" }),
    ],
    [
      "a message that is too long",
      JSON.stringify({ ...passed(), message: "x".repeat(MAX_MESSAGE + 1) }),
    ],
    [
      "a link that breaks markdown",
      JSON.stringify({ ...passed(), ciRunUrl: "https://x.test/a)b" }),
    ],
    [
      "a link that is not https",
      JSON.stringify({ ...passed(), ciRunUrl: "javascript:alert(1)" }),
    ],
  ])("refuses %s", (_label, text) => {
    expect(() => readResult(write(text))).toThrow(/result/);
  });
});
