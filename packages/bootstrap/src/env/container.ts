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

/**
 * Runs the instance's own `check_config` at `version`, against the copy at `hostConfigDir`.
 * `--user <uid>:<gid>` runs the container as the calling user rather than root: `check_config`
 * writes `__pycache__/*.pyc` next to any custom integration it imports, and on a real bind mount
 * (Linux; Docker Desktop's VM hides this) those would otherwise be root-owned and impossible for
 * the caller to clean up afterwards (`EACCES` on `rmSync`). `process.getuid`/`getgid` are POSIX
 * only, which is fine: native Windows is refused before this is ever called.
 */
export function runCheckConfig(
  runtime: ContainerRuntime,
  version: string,
  hostConfigDir: string,
): ExecResult {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  const userArgs =
    uid !== undefined && gid !== undefined ? ["--user", `${uid}:${gid}`] : [];
  return run(runtime, [
    "run",
    "--rm",
    ...userArgs,
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
