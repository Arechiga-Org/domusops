import { randomBytes } from "node:crypto";

export const LABEL_MARKER = "io.domusops.sandbox";
export const LABEL_ID = "io.domusops.sandbox.id";
export const LABEL_MODE = "io.domusops.sandbox.mode";
export const LABEL_DEADLINE = "io.domusops.sandbox.deadline";
export const LABEL_OWNER_HOST = "io.domusops.sandbox.owner-host";
export const LABEL_OWNER_PID = "io.domusops.sandbox.owner-pid";
export const LABEL_RELEASE = "io.domusops.sandbox.release";

export type Mode = "tied" | "background";

export const ID_RE = /^[0-9a-f]{12}$/;

export interface SandboxLabels {
  id: string;
  mode: Mode;
  /** ISO 8601 UTC. */
  deadline: string;
  /** Tied mode only. */
  owner: { host: string; pid: number } | null;
  release: string;
}

export function newSandboxId(): string {
  return randomBytes(6).toString("hex");
}

export function containerName(id: string): string {
  return `domusops-sandbox-${id}`;
}

export function buildLabels(labels: SandboxLabels): Record<string, string> {
  const out: Record<string, string> = {
    [LABEL_MARKER]: "1",
    [LABEL_ID]: labels.id,
    [LABEL_MODE]: labels.mode,
    [LABEL_DEADLINE]: labels.deadline,
    [LABEL_RELEASE]: labels.release,
  };
  if (labels.owner !== null) {
    out[LABEL_OWNER_HOST] = labels.owner.host;
    out[LABEL_OWNER_PID] = String(labels.owner.pid);
  }
  return out;
}

/**
 * Reads the labels of a container. Null unless the container carries the sandbox marker and a
 * complete, well-formed label set: anything else is not ours and is never acted on.
 */
export function parseLabels(
  labels: Readonly<Record<string, string>>,
): SandboxLabels | null {
  if (labels[LABEL_MARKER] !== "1") return null;
  const id = labels[LABEL_ID];
  const mode = labels[LABEL_MODE];
  const deadline = labels[LABEL_DEADLINE];
  const release = labels[LABEL_RELEASE];
  if (id === undefined || !ID_RE.test(id)) return null;
  if (mode !== "tied" && mode !== "background") return null;
  if (deadline === undefined || Number.isNaN(Date.parse(deadline))) return null;
  if (release === undefined) return null;

  let owner: SandboxLabels["owner"] = null;
  if (mode === "tied") {
    const host = labels[LABEL_OWNER_HOST];
    const pid = Number(labels[LABEL_OWNER_PID]);
    if (host === undefined || host === "") return null;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    owner = { host, pid };
  }
  return { id, mode, deadline, owner, release };
}
