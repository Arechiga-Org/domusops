import { resolve } from "node:path";
import type { CliArgs } from "../cli-args.js";
import { EXIT_OK, EXIT_PROBLEMS, EXIT_STOPPED } from "../exit-codes.js";
import {
  isConfigDir,
  notConfigDirStop,
  packageVersion,
  runScopeGuard,
} from "../cli-support.js";
import { init as gitInit, isRepo } from "../env/git.js";
import type { ElementId } from "../baseline/elements.js";
import { APPLY_ORDER } from "../baseline/elements.js";
import {
  applyGitignoreBlock,
  computeGitignoreBlock,
  findTrackedExcludedPaths,
} from "../baseline/gitignore.js";
import {
  applyPackagesLoading,
  applyPackagesReadme,
  computePackagesLoading,
  computePackagesReadme,
} from "../baseline/packages.js";
import {
  findCustomIntegrations,
  findNestedSecretsFiles,
  findRemote,
  hasUiDashboards,
} from "../baseline/findings.js";
import {
  readRecord,
  writeRecord,
  type GenerationRecord,
  type RecordEntry,
} from "../baseline/record.js";
import { currentGitignoreTemplate } from "../baseline/gitignore.js";
import { renderPackagesReadme } from "../baseline/templates.js";
import { sha256 } from "../baseline/templates.js";
import {
  buildSummary,
  emptyFindings,
  printSummary,
  type ElementReport,
  type Findings,
} from "../report/summary.js";
import type { RunStop } from "../env/platform.js";

/**
 * `init`: computes the state of every baseline element and, with `--apply`, performs the
 * actions ([cli.md](../../../../specs/004-ha-bootstrap/contracts/cli.md) "init"). User Story 1
 * covers `repository`, `gitignore-block`, `packages-readme`, and `packages-loading`; later
 * stories (T028, T036, T041) extend this same function with the rest of the twelve elements.
 */
export function runInit(args: CliArgs): number {
  const stop = runScopeGuard(["git"]);
  if (stop !== null) {
    printSummary(
      buildSummary(
        args.apply ? "apply" : "preview",
        packageVersion(),
        resolve(args.dir),
        stop,
        [],
        emptyFindings(),
        null,
        [],
      ),
      args.json,
    );
    return EXIT_STOPPED;
  }
  if (!isConfigDir(args.dir)) {
    const cfgStop = notConfigDirStop();
    printSummary(
      buildSummary(
        args.apply ? "apply" : "preview",
        packageVersion(),
        resolve(args.dir),
        cfgStop,
        [],
        emptyFindings(),
        null,
        [],
      ),
      args.json,
    );
    return EXIT_STOPPED;
  }

  const dir = args.dir;
  const mode: "preview" | "apply" = args.apply ? "apply" : "preview";
  const record = readRecord(dir);
  const newEntries: Record<string, RecordEntry> = {
    ...(record?.elements ?? {}),
  };
  const elements: ElementReport[] = [];

  for (const id of APPLY_ORDER) {
    const report = computeElement(id, dir, record, args.apply);
    if (report === null) continue; // not yet implemented for this story
    elements.push(report.element);
    if (report.entry !== undefined) newEntries[id] = report.entry;
    else if (report.removeEntry === true) delete newEntries[id];
    // An element-scope stop (data-model §1.2) is already carried by its own `state: "blocked"`
    // and `reason`; only a run-scope stop occupies the summary's top-level `stop` field.
  }

  const findings: Findings = {
    ...emptyFindings(),
    tracked_excluded: findTrackedExcludedPaths(dir),
    custom_integrations: findCustomIntegrations(dir),
    nested_secrets_files: findNestedSecretsFiles(dir),
    ui_dashboards: hasUiDashboards(dir),
    remote: findRemote(dir),
  };

  if (args.apply) {
    const changed = elements.some(
      (e) => e.state === "missing" || e.state === "outdated",
    );
    if (changed) {
      writeRecord(dir, {
        format: "domusops.bootstrap/0.1",
        release: packageVersion(),
        elements: newEntries,
      });
    }
  }

  const nextSteps = buildNextSteps(elements, findings, mode);
  const summary = buildSummary(
    mode,
    packageVersion(),
    resolve(dir),
    null,
    elements,
    findings,
    null,
    nextSteps,
  );
  printSummary(summary, args.json);
  const hasBlocked = elements.some((e) => e.state === "blocked");
  return hasBlocked ? EXIT_PROBLEMS : EXIT_OK;
}

interface ComputedElement {
  element: ElementReport;
  entry?: RecordEntry | undefined;
  removeEntry?: boolean;
  stop?: RunStop | undefined;
}

function computeElement(
  id: ElementId,
  dir: string,
  record: GenerationRecord | null,
  apply: boolean,
): ComputedElement | null {
  switch (id) {
    case "repository": {
      const already = isRepo(dir);
      if (!already && apply) gitInit(dir);
      return {
        element: {
          id,
          path: ".git/",
          state: already ? "current" : "missing",
          reason: already
            ? "already a repository"
            : apply
              ? "initialized"
              : "not yet a repository",
        },
      };
    }
    case "gitignore-block": {
      const result = apply
        ? applyGitignoreBlock(dir, record)
        : computeGitignoreBlock(dir, record);
      const entry =
        apply && (result.state === "missing" || result.state === "outdated")
          ? {
              path: ".gitignore",
              sha256: sha256(currentGitignoreTemplate(dir)),
              release: packageVersion(),
            }
          : undefined;
      return {
        element: {
          id,
          path: ".gitignore",
          state: result.state,
          reason: result.reason,
        },
        entry,
      };
    }
    case "packages-readme": {
      const result = apply
        ? applyPackagesReadme(dir, record)
        : computePackagesReadme(dir, record);
      const entry =
        apply && (result.state === "missing" || result.state === "outdated")
          ? {
              path: "packages/README.md",
              sha256: sha256(renderPackagesReadme()),
              release: packageVersion(),
            }
          : undefined;
      return {
        element: {
          id,
          path: "packages/README.md",
          state: result.state,
          reason: result.reason,
        },
        entry,
      };
    }
    case "packages-loading": {
      const result = apply
        ? applyPackagesLoading(dir)
        : computePackagesLoading(dir);
      return {
        element: {
          id,
          path: "configuration.yaml",
          state: result.state,
          reason: result.reason,
        },
        stop: result.stop,
      };
    }
    default:
      return null;
  }
}

function buildNextSteps(
  elements: ElementReport[],
  findings: Findings,
  mode: "preview" | "apply",
): string[] {
  if (mode === "preview") {
    return ["Run again with --apply once you are happy with this preview."];
  }
  const steps: string[] = [];
  const anyChange = elements.some(
    (e) => e.state === "missing" || e.state === "outdated",
  );
  if (anyChange) {
    steps.push("Review the changes with `git status` and `git diff`.");
    steps.push("Make your first commit once you are happy with what changed.");
  }
  if (findings.tracked_excluded.length > 0) {
    steps.push(
      "Untrack the files the baseline now excludes: `git rm --cached <path>` for each one listed above.",
    );
  }
  return steps;
}
