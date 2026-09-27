import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunStop } from "../env/platform.js";
import type { GenerationRecord } from "./record.js";
import {
  applySkillFile,
  computeSkillFile,
  type SkillFileResult,
} from "./skill-file.js";
import { renderPackagesReadme } from "./templates.js";
import {
  findChildKey,
  findTopKey,
  indentAt,
  isBlockMap,
  parse,
  sliceOf,
} from "../yaml/ha-yaml.js";

/**
 * `packages-loading` (data-model §1): the `packages: !include_dir_named packages` line under
 * `homeassistant:` in `configuration.yaml`. User-owned: once any form is present, it is left
 * alone (research R5). Every edit is a text-level splice; the document is never re-serialised.
 */

export interface PackagesLoadingResult {
  state: "missing" | "current" | "blocked";
  reason: string;
  stop?: RunStop;
}

function packagesLoadingStep(
  dir: string,
  apply: boolean,
): PackagesLoadingResult {
  const path = join(dir, "configuration.yaml");
  const text = readFileSync(path, "utf8");
  const { doc, errors } = parse(text);
  if (errors.length > 0) {
    return {
      state: "blocked",
      reason:
        "configuration.yaml has a YAML syntax error; fix it before packages can be added",
    };
  }

  const top = findTopKey(doc, "homeassistant");
  if (top === null) {
    if (apply) {
      const prefix =
        text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
      writeFileSync(
        path,
        `${prefix}homeassistant:\n  packages: !include_dir_named packages\n`,
      );
    }
    return {
      state: "missing",
      reason: "no homeassistant: key; added it with packages loading",
    };
  }

  if (!isBlockMap(top.valueNode)) {
    return {
      state: "blocked",
      reason:
        "homeassistant: is not a block mapping (an !include or a flow mapping)",
      stop: {
        reason: "packages_elsewhere",
        message:
          "homeassistant: is declared as an !include or a flow mapping. Add " +
          "`packages: !include_dir_named packages` inside it yourself, wherever it lives.",
      },
    };
  }

  const packages = findChildKey(top.valueNode, "packages");
  if (packages !== null) {
    const keyRange = (packages.keyNode as { range?: readonly number[] }).range;
    const valueRange = (
      packages.valueNode as { range?: readonly number[] } | null
    )?.range;
    const start = keyRange?.[0] ?? 0;
    const end = valueRange?.[1] ?? keyRange?.[1] ?? start;
    const declared = text.slice(start, end).trim();
    return {
      state: "current",
      reason: `packages already declared: ${declared}`,
    };
  }

  const first = top.valueNode.items[0];
  const offset =
    first === undefined
      ? ((top.keyNode as { range?: readonly number[] }).range?.[1] ??
        text.length)
      : ((first.key as { range?: readonly number[] }).range?.[0] ?? 0);
  const indent = first === undefined ? "  " : indentAt(text, offset);
  const insertion =
    first === undefined
      ? `\n${indent}packages: !include_dir_named packages`
      : `packages: !include_dir_named packages\n${indent}`;
  if (apply) {
    writeFileSync(path, text.slice(0, offset) + insertion + text.slice(offset));
  }
  return {
    state: "missing",
    reason: "added packages loading to the existing homeassistant: block",
  };
}

export function computePackagesLoading(dir: string): PackagesLoadingResult {
  return packagesLoadingStep(dir, false);
}

export function applyPackagesLoading(dir: string): PackagesLoadingResult {
  return packagesLoadingStep(dir, true);
}

/** Only for tests/inspection: the raw content a caller might want to diff (research R5/SC-008). */
export function sliceConfig(dir: string, range: readonly number[]): string {
  const text = readFileSync(join(dir, "configuration.yaml"), "utf8");
  return sliceOf(text, { range });
}

/** `packages-readme`: a static template, so it uses the generic skill-owned-file machinery. */
export function computePackagesReadme(
  dir: string,
  record: GenerationRecord | null,
): SkillFileResult {
  return computeSkillFile(
    join(dir, "packages", "README.md"),
    renderPackagesReadme(),
    record,
    "packages-readme",
  );
}

export function applyPackagesReadme(
  dir: string,
  record: GenerationRecord | null,
): SkillFileResult {
  return applySkillFile(
    join(dir, "packages", "README.md"),
    renderPackagesReadme(),
    record,
    "packages-readme",
  );
}
