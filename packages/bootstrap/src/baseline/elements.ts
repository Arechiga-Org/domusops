/** The 12 baseline elements of data-model §1, their ownership, and the order `init` applies them. */

export type ElementId =
  | "repository"
  | "gitignore-block"
  | "packages-loading"
  | "packages-readme"
  | "sops-config"
  | "encrypted-secrets"
  | "placeholders"
  | "instance-version"
  | "hook"
  | "hooks-path"
  | "workflow"
  | "record";

export type ElementOwner = "skill" | "user";

export interface ElementMeta {
  id: ElementId;
  owner: ElementOwner;
  /** Display path, relative to the configuration directory (or a description for a non-file element). */
  path: string;
}

export const BASELINE_ELEMENTS: readonly ElementMeta[] = [
  { id: "repository", owner: "user", path: ".git/" },
  { id: "gitignore-block", owner: "skill", path: ".gitignore" },
  { id: "packages-readme", owner: "skill", path: "packages/README.md" },
  { id: "packages-loading", owner: "user", path: "configuration.yaml" },
  { id: "sops-config", owner: "skill", path: ".sops.yaml" },
  { id: "encrypted-secrets", owner: "user", path: "secrets.sops.yaml" },
  { id: "placeholders", owner: "user", path: ".domusops/placeholders.yaml" },
  { id: "instance-version", owner: "user", path: ".domusops/instance-version" },
  { id: "hook", owner: "skill", path: ".githooks/pre-commit" },
  { id: "hooks-path", owner: "user", path: "core.hooksPath (git config)" },
  { id: "workflow", owner: "skill", path: ".github/workflows/domusops.yml" },
  { id: "record", owner: "skill", path: ".domusops/generated.json" },
] as const;

/** [cli.md](../../../../specs/004-ha-bootstrap/contracts/cli.md) "Order of application". */
export const APPLY_ORDER: readonly ElementId[] = BASELINE_ELEMENTS.map(
  (e) => e.id,
);

export type ElementState =
  "missing" | "current" | "outdated" | "edited" | "blocked";

/** Data-model §1.1: the summary verb for a state, `would `-prefixed in preview when actionable. */
export function summaryVerb(
  state: ElementState,
  mode: "preview" | "apply",
): string {
  switch (state) {
    case "missing":
      return mode === "apply" ? "created" : "would create";
    case "outdated":
      return mode === "apply" ? "updated" : "would update";
    case "current":
      return "unchanged";
    case "edited":
      return "differs";
    case "blocked":
      return "blocked";
  }
}
