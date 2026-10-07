import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { ElementState } from "./elements.js";
import {
  elementState,
  type GenerationRecord,
  type RecordEntry,
} from "./record.js";
import { sha256 } from "./templates.js";

/**
 * The common shape of every skill-owned generated file (`packages-readme`, `sops-config`,
 * `hook`, `workflow`): a whole file whose expected content is a deterministic template, tracked
 * by the generation record (data-model §1.1).
 */
export interface SkillFileResult {
  state: ElementState;
  reason: string;
}

function reasonFor(state: ElementState): string {
  switch (state) {
    case "missing":
      return "not present yet";
    case "current":
      return "matches the current baseline";
    case "outdated":
      return "unedited, from an earlier release; upgraded";
    case "edited":
      return "edited by the user; left untouched";
    case "blocked":
      return "blocked";
  }
}

export function computeSkillFile(
  path: string,
  currentTemplate: string,
  record: GenerationRecord | null,
  elementId: string,
): SkillFileResult {
  const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
  const entry: RecordEntry | undefined = record?.elements[elementId];
  const state = elementState(entry, currentTemplate, actual);
  return { state, reason: reasonFor(state) };
}

/** Writes `content` when the state calls for it (`missing` or `outdated`); a no-op otherwise. */
export function applySkillFile(
  path: string,
  currentTemplate: string,
  record: GenerationRecord | null,
  elementId: string,
  options: { executable?: boolean } = {},
): SkillFileResult {
  const result = computeSkillFile(path, currentTemplate, record, elementId);
  if (result.state === "missing" || result.state === "outdated") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, currentTemplate, "utf8");
    // Git runs a hook only when it is executable.
    if (options.executable === true) chmodSync(path, 0o755);
  }
  return result;
}

/** The record entry to write for a skill-owned file just applied, at the given release. */
export function recordEntryFor(
  path: string,
  content: string,
  release: string,
): RecordEntry {
  return { path, sha256: sha256(content), release };
}
