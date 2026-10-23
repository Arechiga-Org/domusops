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
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  findCustomIntegrations,
  findInlineSecrets,
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
import {
  renderPackagesReadme,
  renderSopsConfig,
} from "../baseline/templates.js";
import { sha256 } from "../baseline/templates.js";
import {
  applySopsConfig,
  computeSopsConfig,
  readRecipients,
  SOPS_CONFIG_FILE,
} from "../baseline/sops-config.js";
import {
  checkExposure,
  encryptWithRoundtrip,
  secretsExposedStop,
  ENCRYPTED_FILE,
} from "../baseline/secrets.js";
import { lookupKey, resolveOrCreateKey } from "../baseline/key.js";
import { renderHook, renderWorkflow } from "../baseline/templates.js";
import { computeSkillFile, applySkillFile } from "../baseline/skill-file.js";
import {
  applyHooksPath,
  computeHooksPath,
  HOOKS_DIR,
} from "../baseline/hooks-path.js";
import {
  applyInstanceVersion,
  computeInstanceVersion,
  INSTANCE_VERSION_PATH,
} from "../baseline/instance-version.js";
import {
  applyPlaceholders,
  computePlaceholders,
  PLACEHOLDERS_PATH,
} from "../baseline/placeholders.js";
import {
  buildSummary,
  emptyFindings,
  printSummary,
  type ElementReport,
  type Findings,
  type KeyInfo,
} from "../report/summary.js";
import type { RunStop } from "../env/platform.js";

/**
 * `init`: computes the state of every baseline element and, with `--apply`, performs the
 * actions ([cli.md](../../../../specs/004-ha-bootstrap/contracts/cli.md) "init"). User Story 1
 * covers `repository`, `gitignore-block`, `packages-readme`, and `packages-loading`; later
 * stories (T028, T036, T041) extend this same function with the rest of the twelve elements.
 */
export function runInit(args: CliArgs): number {
  const stop = runScopeGuard(["git", "sops", "age"]);
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
  let key: KeyInfo | null = null;
  let membership: Membership | undefined;

  for (const id of APPLY_ORDER) {
    const report = computeElement(
      id,
      dir,
      record,
      args.apply,
      args.instanceVersion,
    );
    if (report === null) continue; // not yet implemented for this story
    elements.push(
      report.element.state === "blocked" && report.stop !== undefined
        ? {
            ...report.element,
            reason: `${report.stop.reason}: ${report.stop.message}`,
          }
        : report.element,
    );
    if (report.entry !== undefined) newEntries[id] = report.entry;
    else if (report.removeEntry === true) delete newEntries[id];
    if (report.key !== undefined) key = report.key;
    if (report.membership !== undefined) membership = report.membership;
    // An element-scope stop (data-model §1.2) is carried by its own `state: "blocked"` and a
    // `reason` that starts with the stop code; only a run-scope stop fills the top-level `stop`.
  }

  const findings: Findings = {
    ...emptyFindings(),
    tracked_excluded: findTrackedExcludedPaths(dir),
    custom_integrations: findCustomIntegrations(dir),
    nested_secrets_files: findNestedSecretsFiles(dir),
    inline_secrets: findInlineSecrets(dir),
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

  const nextSteps = buildNextSteps(elements, findings, mode, key, membership);
  const summary = buildSummary(
    mode,
    packageVersion(),
    resolve(dir),
    null,
    elements,
    findings,
    key,
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
  key?: KeyInfo | undefined;
  /**
   * Set when `.sops.yaml` already lists recipients: the local public key (null when this machine
   * has no age key yet) and whether it is one of them.
   */
  membership?: Membership | undefined;
}

interface Membership {
  localKey: string | null;
  isRecipient: boolean;
}

/** The key of this machine as the summary reports it. */
function keyInfoOf(resolved: {
  publicKey: string;
  created: boolean;
  path: string;
}): KeyInfo {
  return {
    found: !resolved.created,
    created: resolved.created,
    path: resolved.path,
    public: resolved.publicKey,
  };
}

/**
 * Who this machine is among the recipients that `.sops.yaml` already lists. With `apply` the key is
 * created when there is none; in a preview it is only looked up (FR-022).
 */
function membershipOf(
  recipients: readonly string[],
  apply: boolean,
): { key: KeyInfo | null; membership: Membership } {
  const resolved = apply ? resolveOrCreateKey() : lookupKey();
  return {
    key: resolved === null ? null : keyInfoOf(resolved),
    membership: {
      localKey: resolved?.publicKey ?? null,
      isRecipient: resolved !== null && recipients.includes(resolved.publicKey),
    },
  };
}

function computeElement(
  id: ElementId,
  dir: string,
  record: GenerationRecord | null,
  apply: boolean,
  instanceVersionOverride: string | undefined,
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
    case "sops-config": {
      const existingRecipients = readRecipients(dir);
      if (!apply) {
        if (existingRecipients.length === 0 && checkExposure(dir)) {
          return {
            element: {
              id,
              path: SOPS_CONFIG_FILE,
              state: "blocked",
              reason: "secrets.yaml is tracked or in its history",
            },
            stop: secretsExposedStop(),
          };
        }
        const result = computeSopsConfig(
          dir,
          existingRecipients,
          record,
          packageVersion(),
        );
        const who =
          existingRecipients.length > 0
            ? membershipOf(existingRecipients, false)
            : undefined;
        return {
          element: {
            id,
            path: SOPS_CONFIG_FILE,
            state: result.state,
            reason: result.reason,
          },
          key: who?.key ?? undefined,
          membership: who?.membership,
        };
      }
      if (existingRecipients.length > 0) {
        const result = applySopsConfig(
          dir,
          existingRecipients,
          record,
          packageVersion(),
        );
        const entry =
          result.state === "outdated"
            ? {
                path: SOPS_CONFIG_FILE,
                sha256: sha256(
                  renderSopsConfig(existingRecipients, packageVersion()),
                ),
                release: packageVersion(),
              }
            : undefined;
        const who = membershipOf(existingRecipients, true);
        return {
          element: {
            id,
            path: SOPS_CONFIG_FILE,
            state: result.state,
            reason: result.reason,
          },
          entry,
          key: who.key ?? undefined,
          membership: who.membership,
        };
      }
      if (checkExposure(dir)) {
        return {
          element: {
            id,
            path: SOPS_CONFIG_FILE,
            state: "blocked",
            reason: "secrets.yaml is tracked or in its history",
          },
          stop: secretsExposedStop(),
        };
      }
      const resolved = resolveOrCreateKey();
      const key = keyInfoOf(resolved);
      const result = applySopsConfig(
        dir,
        [resolved.publicKey],
        record,
        packageVersion(),
      );
      return {
        element: {
          id,
          path: SOPS_CONFIG_FILE,
          state: result.state,
          reason: result.reason,
        },
        entry: {
          path: SOPS_CONFIG_FILE,
          sha256: sha256(
            renderSopsConfig([resolved.publicKey], packageVersion()),
          ),
          release: packageVersion(),
        },
        key,
      };
    }
    case "encrypted-secrets": {
      const path = join(dir, ENCRYPTED_FILE);
      if (existsSync(path)) {
        return {
          element: {
            id,
            path: ENCRYPTED_FILE,
            state: "current",
            reason: "already present",
          },
        };
      }
      if (!apply && !checkExposure(dir)) {
        return {
          element: {
            id,
            path: ENCRYPTED_FILE,
            state: "missing",
            reason: "not present yet",
          },
        };
      }
      if (checkExposure(dir)) {
        return {
          element: {
            id,
            path: ENCRYPTED_FILE,
            state: "blocked",
            reason: "secrets.yaml is tracked or in its history",
          },
          stop: secretsExposedStop(),
        };
      }
      if (readRecipients(dir).length === 0) {
        // sops-config was blocked or is not yet applicable this run; nothing to encrypt against.
        return {
          element: {
            id,
            path: ENCRYPTED_FILE,
            state: "missing",
            reason: "waiting for .sops.yaml",
          },
        };
      }
      const result = encryptWithRoundtrip(dir);
      if (!result.ok) {
        return {
          element: {
            id,
            path: ENCRYPTED_FILE,
            state: "blocked",
            reason:
              result.stop?.message ??
              "the encrypted file did not decrypt back to the original",
          },
          stop: result.stop,
        };
      }
      return {
        element: {
          id,
          path: ENCRYPTED_FILE,
          state: "missing",
          reason: "encrypted from secrets.yaml",
        },
      };
    }
    case "hook": {
      const template = renderHook(packageVersion());
      const path = join(dir, ".githooks", "pre-commit");
      const result = apply
        ? applySkillFile(path, template, record, id, { executable: true })
        : computeSkillFile(path, template, record, id);
      const entry =
        apply && (result.state === "missing" || result.state === "outdated")
          ? {
              path: ".githooks/pre-commit",
              sha256: sha256(template),
              release: packageVersion(),
            }
          : undefined;
      return {
        element: {
          id,
          path: ".githooks/pre-commit",
          state: result.state,
          reason: result.reason,
        },
        entry,
      };
    }
    case "hooks-path": {
      const result = apply ? applyHooksPath(dir) : computeHooksPath(dir);
      return {
        element: {
          id,
          path: `${HOOKS_DIR} (core.hooksPath)`,
          state: result.state,
          reason: result.reason,
        },
        stop: result.stop,
      };
    }
    case "workflow": {
      const template = renderWorkflow(packageVersion());
      const path = join(dir, ".github", "workflows", "domusops.yml");
      const result = apply
        ? applySkillFile(path, template, record, id)
        : computeSkillFile(path, template, record, id);
      const entry =
        apply && (result.state === "missing" || result.state === "outdated")
          ? {
              path: ".github/workflows/domusops.yml",
              sha256: sha256(template),
              release: packageVersion(),
            }
          : undefined;
      return {
        element: {
          id,
          path: ".github/workflows/domusops.yml",
          state: result.state,
          reason: result.reason,
        },
        entry,
      };
    }
    case "instance-version": {
      const result = apply
        ? applyInstanceVersion(dir, instanceVersionOverride)
        : computeInstanceVersion(dir, instanceVersionOverride);
      return {
        element: {
          id,
          path: INSTANCE_VERSION_PATH,
          state: result.state,
          reason: result.reason,
        },
        stop: result.stop,
      };
    }
    case "placeholders": {
      const result = apply
        ? applyPlaceholders(dir, packageVersion())
        : computePlaceholders(dir, packageVersion());
      return {
        element: {
          id,
          path: PLACEHOLDERS_PATH,
          state: result.state,
          reason: result.reason,
        },
      };
    }
    default:
      return null;
  }
}

/** What a contributor whose key is not a recipient yet needs to do (FR-022); never a stop. */
function membershipSteps(membership: Membership | undefined): string[] {
  if (membership === undefined || membership.isRecipient) return [];
  if (membership.localKey === null) {
    return [
      "You have no age key yet; init --apply creates one so a recipient can add you.",
    ];
  }
  return [
    `Your key cannot decrypt secrets.sops.yaml yet. Ask an existing recipient to run: npx --yes @domusops/bootstrap@${packageVersion()} secrets add-key ${membership.localKey}`,
  ];
}

function buildNextSteps(
  elements: ElementReport[],
  findings: Findings,
  mode: "preview" | "apply",
  key: KeyInfo | null,
  membership: Membership | undefined,
): string[] {
  const steps: string[] = [];
  if (mode === "preview") {
    steps.push("Run again with --apply once you are happy with this preview.");
    steps.push(...membershipSteps(membership));
    return steps;
  }
  if (key !== null && key.created) {
    steps.push(
      `Back up the new key file at ${key.path}: losing it means losing access to the encrypted secrets.`,
    );
  }
  steps.push(...membershipSteps(membership));
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
  if (findings.inline_secrets.length > 0) {
    steps.push(
      "Move the inline secret values listed above into secrets.yaml and reference them with !secret.",
    );
  }
  return steps;
}
