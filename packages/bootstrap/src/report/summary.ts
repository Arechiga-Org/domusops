import type { RunStop } from "../env/platform.js";
import type { ElementId, ElementState } from "../baseline/elements.js";
import { summaryVerb } from "../baseline/elements.js";

/** Data-model §3: the run summary `init` prints at the end of every run. */

export interface ElementReport {
  id: ElementId;
  path: string;
  state: ElementState;
  reason: string;
}

export interface Findings {
  tracked_excluded: string[];
  inline_secrets: { path: string; line: number; key: string }[];
  custom_integrations: string[];
  nested_secrets_files: string[];
  ui_dashboards: boolean;
  remote: "none" | "github" | "other";
}

export function emptyFindings(): Findings {
  return {
    tracked_excluded: [],
    inline_secrets: [],
    custom_integrations: [],
    nested_secrets_files: [],
    ui_dashboards: false,
    remote: "none",
  };
}

export interface KeyInfo {
  found: boolean;
  created: boolean;
  path: string;
  public: string;
}

export interface Summary {
  format: "domusops.bootstrap-summary/0.1";
  mode: "preview" | "apply";
  release: string;
  target: string;
  stop: (RunStop & { reason: string }) | null;
  elements: ElementReport[];
  findings: Findings;
  key: KeyInfo | null;
  next_steps: string[];
}

export function buildSummary(
  mode: "preview" | "apply",
  release: string,
  target: string,
  stop: RunStop | null,
  elements: ElementReport[],
  findings: Findings,
  key: KeyInfo | null,
  nextSteps: string[],
): Summary {
  return {
    format: "domusops.bootstrap-summary/0.1",
    mode,
    release,
    target,
    stop,
    elements,
    findings,
    key,
    next_steps: nextSteps,
  };
}

const HOME = process.env["HOME"] ?? "";

function displayPath(path: string): string {
  return HOME !== "" && path.startsWith(HOME)
    ? `~${path.slice(HOME.length)}`
    : path;
}

export function printSummary(summary: Summary, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (summary.stop !== null) {
    console.log(`Stopped: ${summary.stop.reason}`);
    console.log(summary.stop.message);
    for (const detail of summary.stop.details ?? [])
      console.log(`  - ${detail}`);
    return;
  }
  const width = Math.max(
    0,
    ...summary.elements.map((e) => summaryVerb(e.state, summary.mode).length),
  );
  for (const element of summary.elements) {
    const verb = summaryVerb(element.state, summary.mode).padEnd(width);
    console.log(`${verb}  ${element.path}  ${element.reason}`);
  }
  const f = summary.findings;
  if (f.tracked_excluded.length > 0) {
    console.log(
      `\nAlready tracked but excluded by the baseline: ${f.tracked_excluded.join(", ")}`,
    );
  }
  if (f.nested_secrets_files.length > 0) {
    console.log(
      `Secrets files outside the root, not encrypted: ${f.nested_secrets_files.join(", ")}`,
    );
  }
  if (f.inline_secrets.length > 0) {
    for (const s of f.inline_secrets) {
      console.log(
        `Possible inline secret: ${s.path}:${s.line} (key "${s.key}")`,
      );
    }
  }
  if (f.custom_integrations.length > 0) {
    console.log(
      `Custom integrations (not schema-checked by validate): ${f.custom_integrations.join(", ")}`,
    );
  }
  if (f.ui_dashboards) {
    console.log("UI-mode dashboards live in .storage/ and are not versioned.");
  }
  if (f.remote !== "github") {
    console.log("The generated workflow only runs on GitHub.");
  }
  if (summary.key !== null) {
    const k = summary.key;
    console.log(
      `\nKey: ${k.created ? "created" : "found"} at ${displayPath(k.path)} (public: ${k.public})`,
    );
  }
  if (summary.next_steps.length > 0) {
    console.log("\nNext steps:");
    summary.next_steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  }
}

export interface CheckHit {
  path: string;
  line: number | null;
  rule: string;
  message: string;
}

export interface CheckResult {
  format: "domusops.bootstrap-check/0.1";
  hits: CheckHit[];
}

export function buildCheckResult(hits: CheckHit[]): CheckResult {
  return { format: "domusops.bootstrap-check/0.1", hits };
}

export function printCheckResult(result: CheckResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const hit of result.hits) {
    const loc = hit.line === null ? hit.path : `${hit.path}:${hit.line}`;
    console.log(`${loc}: ${hit.rule}: ${hit.message}`);
  }
}
