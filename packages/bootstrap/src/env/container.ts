import { isOnPath, run, type ExecResult } from "./exec.js";

/**
 * Container runtime detection and the one command `validate` runs in it (research R9), verified
 * against the real `ghcr.io/home-assistant/home-assistant` image: `--entrypoint python` (the
 * image ships both `python` and `python3`) running `-m homeassistant --script check_config`.
 */

export type ContainerRuntime = "docker" | "podman";

/** `docker` then `podman`, or `DOMUSOPS_CONTAINER` to force one (spec FR-027). */
export function detectRuntime(): ContainerRuntime | null {
  const override = process.env["DOMUSOPS_CONTAINER"];
  if (override === "docker" || override === "podman") return override;
  if (isOnPath("docker")) return "docker";
  if (isOnPath("podman")) return "podman";
  return null;
}

export const IMAGE_PREFIX = "ghcr.io/home-assistant/home-assistant";

/** Runs the instance's own `check_config` at `version`, against the copy at `hostConfigDir`. */
export function runCheckConfig(
  runtime: ContainerRuntime,
  version: string,
  hostConfigDir: string,
): ExecResult {
  return run(runtime, [
    "run",
    "--rm",
    "-v",
    `${hostConfigDir}:/config`,
    "--entrypoint",
    "python",
    `${IMAGE_PREFIX}:${version}`,
    "-m",
    "homeassistant",
    "--script",
    "check_config",
    "--config",
    "/config",
    "--json",
  ]);
}
