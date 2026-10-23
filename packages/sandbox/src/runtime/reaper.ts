import type { Runtime } from "./docker.js";
import { parseLabels, type SandboxLabels } from "./labels.js";
import { hostname } from "node:os";
import { readMachineId } from "./machine-id.js";

export type ReapReason = "deadline passed" | "owner process gone";

export interface Removal {
  id: string;
  containerId: string;
  reason: ReapReason;
}

export interface ReapOptions {
  now?: () => number;
  host?: string;
  /** This machine's identifier; null when there is none. Read from the state file when omitted. */
  machine?: string | null;
  isAlive?: (pid: number) => boolean;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True for a tied instance whose owner may still be using it: alive on this machine, or on another
 * one, where nothing can be checked. An instance that records its machine is compared by that
 * identifier, which survives a change of host name; one that does not (started by 0.1.0, or where
 * no identifier could be kept) is compared by host name, as 0.1.0 did (data-model §2).
 */
export function ownerMayBeAlive(
  instance: Pick<SandboxLabels, "mode" | "owner">,
  host: string,
  isAlive: (pid: number) => boolean,
  machine: string | null = null,
): boolean {
  const { mode, owner } = instance;
  if (mode !== "tied" || owner === null) return false;
  const here =
    owner.machine !== undefined
      ? machine !== null && owner.machine === machine
      : owner.host === host;
  return !here || isAlive(owner.pid);
}

/** The data-model decision table, for one labelled container. Null means keep. */
export function decide(
  labels: SandboxLabels,
  now: number,
  host: string,
  isAlive: (pid: number) => boolean,
  machine: string | null = null,
): ReapReason | null {
  if (Date.parse(labels.deadline) <= now) return "deadline passed";
  if (
    labels.mode === "tied" &&
    labels.owner !== null &&
    !ownerMayBeAlive(labels, host, isAlive, machine)
  ) {
    return "owner process gone";
  }
  return null;
}

/**
 * Removes the sandbox instances that are over: past their deadline, or tied to a process on this
 * host that no longer exists. Acts only on containers carrying the sandbox marker label with a
 * complete label set; everything else is left alone. Returns what it removed and why.
 */
export async function reap(
  runtime: Runtime,
  options: ReapOptions = {},
): Promise<Removal[]> {
  const now = (options.now ?? Date.now)();
  const host = options.host ?? hostname();
  const isAlive = options.isAlive ?? processAlive;
  // Only read, never created: no instance can name a machine this one has no identifier for.
  const machine =
    options.machine !== undefined ? options.machine : readMachineId();
  const removed: Removal[] = [];
  for (const container of await runtime.list()) {
    const labels = parseLabels(container.labels);
    if (labels === null) continue;
    const reason = decide(labels, now, host, isAlive, machine);
    if (reason === null) continue;
    try {
      await runtime.remove(container.id);
      removed.push({ id: labels.id, containerId: container.id, reason });
    } catch {
      // One stuck container must not keep the rest from being reaped.
    }
  }
  return removed;
}
