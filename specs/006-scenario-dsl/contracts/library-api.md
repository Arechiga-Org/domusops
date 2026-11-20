# Contract: library API additions

Additions to `@domusops/schema` and `@domusops/sandbox`. Nothing that exists changes (FR-031).

## `@domusops/schema`

```ts
export const SCENARIO_FORMAT = "domusops.scenario/0.1";
export const SCENARIO_REPORT_FORMAT = "domusops.scenario-report/0.1";
export const DEFAULT_SCENARIO_DATE = "2026-04-15"; // a Wednesday
export const DEFAULT_SCENARIO_TIME = "12:00:00";
export const DEFAULT_SCENARIO_TIMEOUT_SECONDS = 300;
export const DEFAULT_SETTLE_SECONDS = 5;
export const STAND_IN_KINDS: readonly string[]; // the harness's device kinds

export interface ScenarioIssue {
  path: string; // JSON Pointer into the document
  code: ScenarioIssueCode;
  message: string;
}

/** Every issue of one parsed document; empty when it is valid. Pure, no I/O. */
export function checkScenarioDocument(value: unknown): ScenarioIssue[];

/** The scenarios and starting points of a valid document, normalised (data-model §1). */
export function normalizeScenarioDocument(value: unknown): ScenarioFile;

/**
 * Applies `use` references across the files of a suite; returns issues for unknown references,
 * cycles and duplicate names, or each scenario's resolved starting point.
 */
export function resolveSuite(
  files: { file: string; document: ScenarioFile }[],
):
  | { ok: true; scenarios: ResolvedScenario[] }
  | { ok: false; issues: (ScenarioIssue & { file: string })[] };

/** Compares an expected value with an actual one by the rule of research R10. */
export function compareValue(
  expected: Comparison,
  actual: unknown,
): { ok: true } | { ok: false; reason?: "not_a_number" };

export const scenarioJsonSchema: object;
export const scenarioReportJsonSchema: object;
// Also shipped as schema/scenario.schema.json and schema/scenario-report.schema.json, written
// from the two constants, for editors:
// # yaml-language-server: $schema=https://unpkg.com/@domusops/schema@0.3/schema/scenario.schema.json
export type {
  ScenarioFile,
  ResolvedScenario,
  Comparison,
  Step,
  Expectation,
  ScenarioReport,
};
```

## `@domusops/sandbox`

```ts
export interface LoadOptions {
  /** The configuration directory; scenarios default to `<config>/scenarios`. */
  config: string;
  /** Other files or directories to read instead of the default directory. */
  paths?: string[];
  /** Keep only scenarios with these names. */
  names?: string[];
}

export interface LoadedSuite {
  scenarios: LoadedScenario[];
  files: string[];
}

/** A resolved scenario whose scenario, steps and expectations also carry `line` (data-model §1). */
export interface LoadedScenario extends ResolvedScenario {
  line: number;
}

/** Finds, parses, checks and resolves. No instance is started. Throws `ScenarioFileError`. */
export function loadScenarios(options: LoadOptions): Promise<LoadedSuite>;

export class ScenarioFileError extends Error {
  readonly issues: {
    file: string;
    line: number;
    column: number;
    code: string;
    message: string;
  }[];
}

export interface RunOptions {
  suite: LoadedSuite;
  /** Loaded into each instance as `startSandbox` loads it (`{ dir, secretsFile? }`). */
  config: ConfigSource;
  /** Channels or exact releases; default `["stable"]`. */
  targets?: ({ channel: Channel } | { release: string })[];
  /** Seconds per scenario that sets no `timeout`, from the start of its instance. Default 300. */
  scenarioTimeout?: number;
  /** Instances at once. Default 1. */
  parallel?: number;
  /** Told each scenario's result as it ends. */
  onResult?: (result: ScenarioResult) => void;
}

/** Runs every scenario on every target, one fresh instance each (research R1). */
export function runScenarios(options: RunOptions): Promise<ScenarioReport>;

/** The readable report of research R14. */
export function renderReport(report: ScenarioReport): string;

/** The exit status of a report: 0, 1 or 3 (contracts/cli.md). */
export function exitStatus(report: ScenarioReport): 0 | 1 | 3;
```

`runScenarios` never accepts an address or a token: every instance comes from `startSandbox`
(FR-018). A config that fails the instance's check makes every scenario on that release could
not run with `config_invalid`, after one attempt; it is not retried per scenario.

### Handle addition

```ts
interface Sandbox {
  // ...existing members unchanged...
  /** Fires an event on the instance's bus, as an integration would. */
  fireEvent(eventType: string, data?: Record<string, unknown>): Promise<void>;
}
```

`eventType` matches `^[a-z0-9_]+$`; the call posts to `/api/events/<eventType>`.
