import { CHANNEL_NAMES, type Channel } from "../release/versions.js";
import type { EarlyStep, Outcome, RunResult, StepName } from "./result.js";

export const SUPPORTED_VERSIONS_FORMAT =
  "domusops.supported-versions/0.1" as const;
export const TABLE_START = "<!-- domusops:supported-versions:start -->";
export const TABLE_END = "<!-- domusops:supported-versions:end -->";

/** What the last recorded run of one channel found. */
export interface SupportedRow {
  channel: Channel;
  /** `null` when no beta was in progress. */
  release: string | null;
  outcome: Outcome;
  failedStep?: StepName | EarlyStep;
  /** ISO 8601 UTC time the run finished. */
  checkedAt: string;
  ciRunUrl: string;
}

/** The file `docs/supported-versions.json`: the only source of the README table. */
export interface SupportedVersions {
  format: typeof SUPPORTED_VERSIONS_FORMAT;
  rows: SupportedRow[];
}

export function emptySupportedVersions(): SupportedVersions {
  return { format: SUPPORTED_VERSIONS_FORMAT, rows: [] };
}

const LABELS: Record<Channel, string> = {
  stable: "Current stable",
  "previous-stable": "Previous stable",
  beta: "Current beta",
};

/** The row a CI run adds. Throws for a run that cannot back a published claim. */
export function rowFromResult(result: RunResult): SupportedRow {
  if (result.channel === "exact") {
    throw new Error("A run of an exact release does not belong in the table.");
  }
  if (result.ciRunUrl === undefined) {
    throw new Error(
      `The ${result.channel} result has no ciRunUrl: only a CI run can back the table.`,
    );
  }
  const row: SupportedRow = {
    channel: result.channel,
    release: result.release ?? null,
    outcome: result.outcome,
    checkedAt: result.finishedAt,
    ciRunUrl: result.ciRunUrl,
  };
  if (result.failedStep !== undefined) row.failedStep = result.failedStep;
  return row;
}

/** Replaces the rows of the channels in `results`, keeping the others, in channel order. */
export function applyResults(
  current: SupportedVersions,
  results: readonly RunResult[],
): SupportedVersions {
  const byChannel = new Map<Channel, SupportedRow>(
    current.rows.map((row) => [row.channel, row]),
  );
  for (const result of results) {
    const row = rowFromResult(result);
    // A run that could not start says nothing about the release, so it must not erase the last
    // result that did.
    const previous = byChannel.get(row.channel);
    if (row.outcome === "could-not-run" && previous !== undefined) continue;
    byChannel.set(row.channel, row);
  }
  const rows = CHANNEL_NAMES.flatMap((channel) => {
    const row = byChannel.get(channel);
    return row === undefined ? [] : [row];
  });
  return { format: SUPPORTED_VERSIONS_FORMAT, rows };
}

function describeOutcome(row: SupportedRow): string {
  switch (row.outcome) {
    case "passed":
      return "Passed";
    case "failed":
      return `Failed (${row.failedStep ?? "unknown"})`;
    case "could-not-run":
      return `Could not run (${row.failedStep ?? "unknown"})`;
    case "no-beta-in-progress":
      return "No beta in progress";
  }
}

function cells(channel: Channel, row: SupportedRow | undefined): string[] {
  if (row === undefined) return [LABELS[channel], "—", "Not yet checked", "—"];
  return [
    LABELS[channel],
    row.release ?? "—",
    describeOutcome(row),
    `[${row.checkedAt.slice(0, 10)}](${row.ciRunUrl})`,
  ];
}

/** The README table: one row per channel, columns padded the way Prettier pads them. */
export function renderSupportedVersions(doc: SupportedVersions): string {
  const rows = CHANNEL_NAMES.map((channel) =>
    cells(
      channel,
      doc.rows.find((row) => row.channel === channel),
    ),
  );
  const header = ["Channel", "Release", "Result", "Checked"];
  const widths = header.map((title, column) =>
    Math.max(3, title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (values: readonly string[]): string =>
    `| ${values.map((value, column) => value.padEnd(widths[column] ?? 0)).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/** Puts `table` between the two markers of `readme` and leaves every other character alone. */
export function replaceTableBlock(readme: string, table: string): string {
  const start = readme.indexOf(TABLE_START);
  const end = readme.indexOf(TABLE_END);
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    readme.indexOf(TABLE_START, start + 1) !== -1 ||
    readme.indexOf(TABLE_END, end + 1) !== -1
  ) {
    throw new Error(
      `The README needs exactly one ${TABLE_START} followed by one ${TABLE_END}.`,
    );
  }
  return `${readme.slice(0, start + TABLE_START.length)}\n\n${table}\n\n${readme.slice(end)}`;
}

/** Channels whose failure blocks a merge; the beta only informs. */
export const REQUIRED_CHANNELS: readonly Channel[] = [
  "stable",
  "previous-stable",
];

export interface GateVerdict {
  ok: boolean;
  problems: string[];
  /** Channels that may fail without failing the gate but should not go unnoticed. */
  warnings: string[];
}

/** The merge gate: every required channel needs a result, and the result must have passed. */
export function gateVerdict(results: readonly RunResult[]): GateVerdict {
  const problems: string[] = [];
  for (const channel of REQUIRED_CHANNELS) {
    const result = results.find((candidate) => candidate.channel === channel);
    if (result === undefined) {
      problems.push(`${channel}: no result was produced.`);
    } else if (result.outcome !== "passed") {
      const where =
        result.failedStep === undefined ? "" : ` at ${result.failedStep}`;
      problems.push(`${channel}: ${result.outcome}${where}.`);
    }
  }
  const warnings: string[] = [];
  if (!results.some((candidate) => candidate.channel === "beta")) {
    warnings.push("beta: no result was produced.");
  }
  return { ok: problems.length === 0, problems, warnings };
}
