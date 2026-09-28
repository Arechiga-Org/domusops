import { isOnPath } from "./exec.js";
import type { RunStop } from "./platform.js";

/** One external program the CLI depends on, and how to install it per platform (spec FR-004). */
export interface Prerequisite {
  name: string;
  probe: string;
  macos: string;
  debian: string;
  fallback: string;
}

const GIT: Prerequisite = {
  name: "git",
  probe: "git",
  macos: "brew install git",
  debian: "sudo apt install git",
  fallback: "https://git-scm.com/downloads",
};

const SOPS: Prerequisite = {
  name: "sops",
  probe: "sops",
  macos: "brew install sops",
  debian:
    "sudo apt install sops (or download the .deb from the sops releases page)",
  fallback: "https://github.com/getsops/sops/releases",
};

const AGE: Prerequisite = {
  name: "age-keygen",
  probe: "age-keygen",
  macos: "brew install age",
  debian: "sudo apt install age",
  fallback: "https://github.com/FiloSottile/age/releases",
};

const DOCKER: Prerequisite = {
  name: "docker",
  probe: "docker",
  macos: "brew install --cask docker",
  debian: "sudo apt install docker.io",
  fallback: "https://docs.docker.com/get-docker/",
};

const PODMAN: Prerequisite = {
  name: "podman",
  probe: "podman",
  macos: "brew install podman",
  debian: "sudo apt install podman",
  fallback: "https://podman.io/docs/installation",
};

export const PREREQUISITES = {
  git: GIT,
  sops: SOPS,
  age: AGE,
  docker: DOCKER,
  podman: PODMAN,
} as const;

export type PrereqName = keyof typeof PREREQUISITES;

/** Which of `names` are missing from `PATH`, in the order given. */
export function checkPrerequisites(
  names: readonly PrereqName[],
): Prerequisite[] {
  const missing: Prerequisite[] = [];
  for (const name of names) {
    const prereq = PREREQUISITES[name];
    if (!isOnPath(prereq.probe)) missing.push(prereq);
  }
  return missing;
}

/** True when at least one of `docker` or `podman` is on `PATH`. */
export function hasContainerRuntime(): boolean {
  return isOnPath(DOCKER.probe) || isOnPath(PODMAN.probe);
}

function installLine(p: Prerequisite): string {
  return (
    `${p.name}: macOS — \`${p.macos}\`; Debian/Ubuntu — \`${p.debian}\`; ` +
    `otherwise see ${p.fallback}`
  );
}

export function missingPrerequisiteStop(
  missing: readonly Prerequisite[],
): RunStop {
  return {
    reason: "missing_prerequisite",
    message:
      "One or more required programs are not installed. Nothing was changed.",
    details: missing.map(installLine),
  };
}
