import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPlaceholders } from "./templates.js";

/** `placeholders` (data-model §1): user-owned, created once, empty, and never rewritten. */

export const PLACEHOLDERS_PATH = ".domusops/placeholders.yaml";

export interface PlaceholdersResult {
  state: "missing" | "current";
  reason: string;
}

function placeholdersStep(dir: string, apply: boolean): PlaceholdersResult {
  const path = join(dir, PLACEHOLDERS_PATH);
  if (existsSync(path)) return { state: "current", reason: "already present" };
  if (apply) {
    mkdirSync(join(dir, ".domusops"), { recursive: true });
    writeFileSync(path, renderPlaceholders());
  }
  return { state: "missing", reason: "not present yet" };
}

export function computePlaceholders(dir: string): PlaceholdersResult {
  return placeholdersStep(dir, false);
}

export function applyPlaceholders(dir: string): PlaceholdersResult {
  return placeholdersStep(dir, true);
}
