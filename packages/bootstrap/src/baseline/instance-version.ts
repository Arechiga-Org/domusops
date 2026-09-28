import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunStop } from "../env/platform.js";

/** `instance-version` (data-model §1, research R11). */

export const INSTANCE_VERSION_PATH = ".domusops/instance-version";
const INSTANCE_VERSION_PATTERN = /^\d{4}\.\d{1,2}\.\d+(b\d+)?$/;

export interface InstanceVersionResult {
  state: "missing" | "current" | "blocked";
  reason: string;
  stop?: RunStop;
  /** The version that would be (or was) written, when `state` is `"missing"`. */
  version?: string;
}

export function versionUnknownStop(): RunStop {
  return {
    reason: "version_unknown",
    message:
      "No .domusops/instance-version exists and no .HA_VERSION was found to read it from. " +
      "Pass --instance-version <YYYY.M.P> (for example 2026.9.3). Every other element still " +
      "applies.",
  };
}

function instanceVersionStep(
  dir: string,
  override: string | undefined,
  apply: boolean,
): InstanceVersionResult {
  const path = join(dir, INSTANCE_VERSION_PATH);
  if (existsSync(path)) return { state: "current", reason: "already recorded" };

  const haVersionPath = join(dir, ".HA_VERSION");
  const fromFile = existsSync(haVersionPath)
    ? readFileSync(haVersionPath, "utf8").trim()
    : null;
  const candidate = override ?? fromFile ?? undefined;
  if (candidate === undefined || !INSTANCE_VERSION_PATTERN.test(candidate)) {
    return {
      state: "blocked",
      reason: "no instance version available",
      stop: versionUnknownStop(),
    };
  }
  if (apply) {
    mkdirSync(join(dir, ".domusops"), { recursive: true });
    writeFileSync(path, `${candidate}\n`);
  }
  return {
    state: "missing",
    reason:
      override !== undefined ? "from --instance-version" : "from .HA_VERSION",
    version: candidate,
  };
}

export function computeInstanceVersion(
  dir: string,
  override: string | undefined,
): InstanceVersionResult {
  return instanceVersionStep(dir, override, false);
}

export function applyInstanceVersion(
  dir: string,
  override: string | undefined,
): InstanceVersionResult {
  return instanceVersionStep(dir, override, true);
}

/** The recorded version, for `validate` to read; `null` when missing or the wrong shape. */
export function readRecordedInstanceVersion(dir: string): string | null {
  const path = join(dir, INSTANCE_VERSION_PATH);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  return INSTANCE_VERSION_PATTERN.test(text) ? text : null;
}
