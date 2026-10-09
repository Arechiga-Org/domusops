import { describe, expect, it } from "vitest";
import {
  RESULT_FORMAT,
  STEP_NAMES,
  type RunResult,
} from "../src/results/result.js";
import {
  TABLE_END,
  TABLE_START,
  applyResults,
  emptySupportedVersions,
  gateVerdict,
  renderSupportedVersions,
  replaceTableBlock,
} from "../src/results/table.js";

const RUN = "https://github.com/owner/repo/actions/runs/7";

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    format: RESULT_FORMAT,
    channel: "stable",
    release: "2026.10.1",
    outcome: "passed",
    steps: STEP_NAMES.map((name) => ({ name, status: "passed", ms: 1 })),
    startedAt: "2026-10-08T10:00:00Z",
    finishedAt: "2026-10-08T10:01:00Z",
    runner: "linux-x64",
    sandboxVersion: "0.1.0",
    ciRunUrl: RUN,
    ...overrides,
  };
}

describe("the supported-versions table", () => {
  it("shows every channel as not yet checked before any run", () => {
    expect(renderSupportedVersions(emptySupportedVersions())).toBe(
      [
        "| Channel         | Release | Result          | Checked |",
        "| --------------- | ------- | --------------- | ------- |",
        "| Current stable  | —       | Not yet checked | —       |",
        "| Previous stable | —       | Not yet checked | —       |",
        "| Current beta    | —       | Not yet checked | —       |",
      ].join("\n"),
    );
  });

  it("renders each outcome with a link to the run that produced it", () => {
    const noRelease = Object.fromEntries(
      Object.entries(result()).filter(([name]) => name !== "release"),
    ) as RunResult;
    const doc = applyResults(emptySupportedVersions(), [
      result(),
      result({
        channel: "previous-stable",
        release: "2026.9.3",
        outcome: "failed",
        failedStep: "time",
      }),
      {
        ...noRelease,
        channel: "beta",
        outcome: "no-beta-in-progress",
        steps: [],
      },
    ]);
    const table = renderSupportedVersions(doc);
    expect(table).toContain(`[2026-10-08](${RUN})`);
    expect(table).toMatch(/Current stable\s+\| 2026\.10\.1\s+\| Passed/);
    expect(table).toMatch(
      /Previous stable\s+\| 2026\.9\.3\s+\| Failed \(time\)/,
    );
    expect(table).toMatch(/Current beta\s+\| —\s+\| No beta in progress/);
  });

  it("renders a run that could not happen with the step it stopped at", () => {
    const doc = applyResults(emptySupportedVersions(), [
      result({
        outcome: "could-not-run",
        failedStep: "pull",
        steps: [],
      }),
    ]);
    expect(renderSupportedVersions(doc)).toContain("Could not run (pull)");
  });

  it("replaces only the channels it is given and keeps channel order", () => {
    const first = applyResults(emptySupportedVersions(), [
      result({ channel: "beta", release: "2026.11.0b1" }),
      result(),
    ]);
    expect(first.rows.map((row) => row.channel)).toEqual(["stable", "beta"]);
    const second = applyResults(first, [result({ release: "2026.10.2" })]);
    expect(second.rows.map((row) => row.release)).toEqual([
      "2026.10.2",
      "2026.11.0b1",
    ]);
  });

  it("refuses a result that cannot back a published claim", () => {
    const local = Object.fromEntries(
      Object.entries(result()).filter(([name]) => name !== "ciRunUrl"),
    ) as RunResult;
    expect(() => applyResults(emptySupportedVersions(), [local])).toThrow(
      /ciRunUrl/,
    );
    expect(() =>
      applyResults(emptySupportedVersions(), [result({ channel: "exact" })]),
    ).toThrow(/exact/);
  });
});

describe("the README block", () => {
  const readme = `# Title\n\nbefore\n\n${TABLE_START}\n\nold\n\n${TABLE_END}\n\nafter\n`;

  it("replaces what is between the markers and nothing else", () => {
    const out = replaceTableBlock(readme, "| a |");
    expect(out).toBe(
      `# Title\n\nbefore\n\n${TABLE_START}\n\n| a |\n\n${TABLE_END}\n\nafter\n`,
    );
    expect(replaceTableBlock(out, "| a |")).toBe(out);
  });

  it.each([
    ["no markers", "# Title\n"],
    ["only a start", `${TABLE_START}\n`],
    ["the end first", `${TABLE_END}\n${TABLE_START}\n`],
    ["two blocks", `${readme}${readme}`],
  ])("refuses a README with %s", (_label, text) => {
    expect(() => replaceTableBlock(text, "| a |")).toThrow(/exactly one/);
  });
});

describe("the merge gate", () => {
  it("passes when both stable channels pass, whatever the beta did", () => {
    expect(
      gateVerdict([
        result(),
        result({ channel: "previous-stable", release: "2026.9.3" }),
        result({ channel: "beta", outcome: "failed", failedStep: "time" }),
      ]),
    ).toEqual({ ok: true, problems: [] });
  });

  it("fails for a stable channel that failed, could not run, or has no result", () => {
    const verdict = gateVerdict([
      result({ outcome: "failed", failedStep: "websocket" }),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toEqual([
      "stable: failed at websocket.",
      "previous-stable: no result was produced.",
    ]);
    expect(
      gateVerdict([
        result({ outcome: "could-not-run", failedStep: "pull", steps: [] }),
        result({ channel: "previous-stable" }),
      ]).problems,
    ).toEqual(["stable: could-not-run at pull."]);
  });
});
