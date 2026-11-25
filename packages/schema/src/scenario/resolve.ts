import {
  DEFAULT_SCENARIO_DATE,
  DEFAULT_SCENARIO_TIME,
  DEFAULT_SCENARIO_TIMEOUT_SECONDS,
  MAX_SCENARIO_TIMEOUT_SECONDS,
  MIN_SCENARIO_TIMEOUT_SECONDS,
  type ResolvedScenario,
  type ScenarioFile,
  type ScenarioIssue,
} from "./format.js";

export type SuiteIssue = ScenarioIssue & { file: string };

export type ResolvedSuite =
  | { ok: true; scenarios: ResolvedScenario[] }
  | { ok: false; issues: SuiteIssue[] };

export interface ResolveOptions {
  /**
   * The run's time limit for a scenario that states none, in real seconds, within the range a
   * scenario's own `timeout` may take. `resolveSuite` throws a `RangeError` for any other value.
   */
  defaultTimeout?: number;
}

const place = (file: string, path: string): string =>
  path === "" ? file : `${file} at ${path}`;

/**
 * Resolves the scenarios of every file of a suite: names are unique across files, and each
 * scenario gets its starting point with the defaults filled and its time limit. Files and
 * scenarios keep the order they were given in.
 */
export function resolveSuite(
  files: { file: string; document: ScenarioFile }[],
  options: ResolveOptions = {},
): ResolvedSuite {
  const { defaultTimeout } = options;
  if (
    defaultTimeout !== undefined &&
    !(
      defaultTimeout >= MIN_SCENARIO_TIMEOUT_SECONDS &&
      defaultTimeout <= MAX_SCENARIO_TIMEOUT_SECONDS
    )
  ) {
    throw new RangeError(
      `defaultTimeout is a number of seconds, ${MIN_SCENARIO_TIMEOUT_SECONDS} to ${MAX_SCENARIO_TIMEOUT_SECONDS}`,
    );
  }
  const issues: SuiteIssue[] = [];
  const scenarios: ResolvedScenario[] = [];
  const seen = new Map<string, string>();
  for (const { file, document } of files) {
    for (const draft of document.scenarios) {
      const first = seen.get(draft.name);
      if (first !== undefined) {
        issues.push({
          file,
          path: `${draft.path}/scenario`,
          code: "duplicate_scenario",
          message: `scenario \`${draft.name}\` is defined at ${first} and at ${place(file, draft.path)}`,
        });
        continue;
      }
      seen.set(draft.name, place(file, draft.path));
      // `use`, `stand_ins` and `absent_actions` arrive with US5 and the runner: until then the
      // checker refuses them (`unknown_key`), so these are empty and every `use` would be
      // unknown. The grammar grows by story (plan decision 9).
      for (const name of draft.given.use) {
        issues.push({
          file,
          path: `${draft.path}/given/use`,
          code: "unknown_starting_point",
          message: `no starting point is named \`${name}\``,
        });
      }
      scenarios.push({
        name: draft.name,
        ...(draft.description === undefined
          ? {}
          : { description: draft.description }),
        file,
        path: draft.path,
        given: {
          date: draft.given.date ?? DEFAULT_SCENARIO_DATE,
          time: draft.given.time ?? DEFAULT_SCENARIO_TIME,
          entities: draft.given.entities,
          standIns: draft.given.standIns,
          absentActions: [...new Set(draft.given.absentActions)],
        },
        steps: draft.steps,
        timeout:
          draft.timeout ??
          options.defaultTimeout ??
          DEFAULT_SCENARIO_TIMEOUT_SECONDS,
        settle: draft.settle,
      });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, scenarios };
}
