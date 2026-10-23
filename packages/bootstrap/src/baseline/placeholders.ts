import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPlaceholders } from "./templates.js";

/** `placeholders` (data-model §1): user-owned, created once, empty, and never rewritten. */

export const PLACEHOLDERS_PATH = ".domusops/placeholders.yaml";

export interface PlaceholdersResult {
  state: "missing" | "current";
  reason: string;
}

function placeholdersStep(
  dir: string,
  apply: boolean,
  release: string,
): PlaceholdersResult {
  const path = join(dir, PLACEHOLDERS_PATH);
  if (existsSync(path)) return { state: "current", reason: "already present" };
  if (apply) {
    mkdirSync(join(dir, ".domusops"), { recursive: true });
    writeFileSync(path, renderPlaceholders(release));
  }
  return { state: "missing", reason: "not present yet" };
}

export function computePlaceholders(
  dir: string,
  release: string,
): PlaceholdersResult {
  return placeholdersStep(dir, false, release);
}

export function applyPlaceholders(
  dir: string,
  release: string,
): PlaceholdersResult {
  return placeholdersStep(dir, true, release);
}
