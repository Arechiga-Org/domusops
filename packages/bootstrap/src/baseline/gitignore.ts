import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lsFilesTracked, lsFilesTrackedExcluded } from "../env/git.js";
import type { ElementState } from "./elements.js";
import { elementState, type GenerationRecord } from "./record.js";
import { gitignoreBlockBounds, renderGitignoreBlock } from "./templates.js";

/**
 * `gitignore-block` (data-model §1): the marked block in `.gitignore` (research R4). Skill-owned:
 * tracked by the generation record like any other, but the record holds the hash of the block
 * alone, never the surrounding file, so the user's own `.gitignore` content is untouched.
 */

export interface GitignoreResult {
  state: ElementState;
  reason: string;
}

function reasonFor(state: ElementState): string {
  switch (state) {
    case "missing":
      return "no DomusOps exclusion block yet";
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

/** `custom_components/` and `www/community/` drop out when the user already tracks files there. */
function omitSet(dir: string): Set<string> {
  const tracked = lsFilesTracked(dir, ["custom_components/", "www/community/"]);
  const omit = new Set<string>();
  if (tracked.has("custom_components/")) omit.add("custom_components/");
  if (tracked.has("www/community/")) omit.add("www/community/");
  return omit;
}

export function currentGitignoreTemplate(dir: string): string {
  return renderGitignoreBlock(omitSet(dir));
}

function readGitignore(dir: string): string | null {
  const path = join(dir, ".gitignore");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function actualBlock(dir: string): string | null {
  const text = readGitignore(dir);
  if (text === null) return null;
  const bounds = gitignoreBlockBounds(text);
  return bounds === null ? null : text.slice(bounds.start, bounds.end);
}

function gitignoreStep(
  dir: string,
  record: GenerationRecord | null,
  apply: boolean,
): GitignoreResult {
  const template = currentGitignoreTemplate(dir);
  const actual = actualBlock(dir);
  const entry = record?.elements["gitignore-block"];
  const state = elementState(entry, template, actual);
  if (apply && (state === "missing" || state === "outdated")) {
    const text = readGitignore(dir) ?? "";
    const bounds = gitignoreBlockBounds(text);
    const path = join(dir, ".gitignore");
    if (bounds === null) {
      const prefix =
        text.length === 0
          ? ""
          : text.endsWith("\n\n")
            ? text
            : text.endsWith("\n")
              ? `${text}\n`
              : `${text}\n\n`;
      writeFileSync(path, `${prefix}${template}`);
    } else {
      writeFileSync(
        path,
        text.slice(0, bounds.start) + template + text.slice(bounds.end),
      );
    }
  }
  return { state, reason: reasonFor(state) };
}

export function computeGitignoreBlock(
  dir: string,
  record: GenerationRecord | null,
): GitignoreResult {
  return gitignoreStep(dir, record, false);
}

export function applyGitignoreBlock(
  dir: string,
  record: GenerationRecord | null,
): GitignoreResult {
  return gitignoreStep(dir, record, true);
}

/** Tracked files the exclusion block, as it will be written, would exclude (spec FR-007). */
export function findTrackedExcludedPaths(dir: string): string[] {
  return lsFilesTrackedExcluded(dir, currentGitignoreTemplate(dir)).sort();
}
