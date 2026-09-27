import { existsSync } from "node:fs";
import { join } from "node:path";
import { getLocalConfig, setLocalConfig } from "../env/git.js";
import type { RunStop } from "../env/platform.js";

/** `hooks-path` (data-model §1): the local `core.hooksPath` git setting (research R2). */

export const HOOKS_DIR = ".githooks";

export interface HooksPathResult {
  state: "missing" | "current" | "blocked";
  reason: string;
  stop?: RunStop;
}

export function hooksConflictStop(): RunStop {
  return {
    reason: "hooks_conflict",
    message:
      "core.hooksPath is already set to something else, or .git/hooks/pre-commit already " +
      "exists. The DomusOps hook was not installed; add `npx --yes @domusops/bootstrap check " +
      "--staged` to your existing hook yourself.",
  };
}

function hooksPathStep(dir: string, apply: boolean): HooksPathResult {
  const current = getLocalConfig(dir, "core.hooksPath");
  if (current === HOOKS_DIR) return { state: "current", reason: "already set" };
  if (current !== null) {
    return {
      state: "blocked",
      reason: `core.hooksPath is already set to ${current}`,
      stop: hooksConflictStop(),
    };
  }
  if (existsSync(join(dir, ".git", "hooks", "pre-commit"))) {
    return {
      state: "blocked",
      reason: "a .git/hooks/pre-commit already exists",
      stop: hooksConflictStop(),
    };
  }
  if (apply) setLocalConfig(dir, "core.hooksPath", HOOKS_DIR);
  return { state: "missing", reason: "core.hooksPath not set yet" };
}

export function computeHooksPath(dir: string): HooksPathResult {
  return hooksPathStep(dir, false);
}

export function applyHooksPath(dir: string): HooksPathResult {
  return hooksPathStep(dir, true);
}
