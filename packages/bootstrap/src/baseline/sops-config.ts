import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { GenerationRecord } from "./record.js";
import {
  applySkillFile,
  computeSkillFile,
  type SkillFileResult,
} from "./skill-file.js";
import { renderSopsConfig } from "./templates.js";

export const SOPS_CONFIG_FILE = ".sops.yaml";

interface SopsYamlShape {
  creation_rules?: { age?: string }[];
}

/** The recipients currently declared in `.sops.yaml`'s one creation rule (research R6). */
export function readRecipients(dir: string): string[] {
  const path = join(dir, SOPS_CONFIG_FILE);
  if (!existsSync(path)) return [];
  const doc = parseYaml(readFileSync(path, "utf8")) as SopsYamlShape | null;
  const raw = doc?.creation_rules?.[0]?.age ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function writeSopsConfig(
  dir: string,
  recipients: readonly string[],
): void {
  writeFileSync(
    join(dir, SOPS_CONFIG_FILE),
    renderSopsConfig(recipients),
    "utf8",
  );
}

export function computeSopsConfig(
  dir: string,
  recipients: readonly string[],
  record: GenerationRecord | null,
): SkillFileResult {
  return computeSkillFile(
    join(dir, SOPS_CONFIG_FILE),
    renderSopsConfig(recipients),
    record,
    "sops-config",
  );
}

export function applySopsConfig(
  dir: string,
  recipients: readonly string[],
  record: GenerationRecord | null,
): SkillFileResult {
  return applySkillFile(
    join(dir, SOPS_CONFIG_FILE),
    renderSopsConfig(recipients),
    record,
    "sops-config",
  );
}
