import type { Runtime } from "./docker.js";

interface Guarded {
  runtime: Runtime;
  containerId: string;
}

const guarded = new Set<Guarded>();
let installed = false;

function removeAll(): void {
  for (const entry of guarded) entry.runtime.removeSync(entry.containerId);
  guarded.clear();
}

function onSignal(signal: NodeJS.Signals): void {
  removeAll();
  uninstall();
  // With our listeners gone, re-raising applies the signal's default action, or runs whatever
  // other handlers the host program registered.
  process.kill(process.pid, signal);
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on("exit", removeAll);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

function uninstall(): void {
  if (!installed) return;
  installed = false;
  process.off("exit", removeAll);
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

/**
 * Removes the container if this process exits or is interrupted before the guard is released.
 * One set of process listeners serves every guarded container. Returns the release function.
 */
export function guardContainer(
  runtime: Runtime,
  containerId: string,
): () => void {
  const entry: Guarded = { runtime, containerId };
  guarded.add(entry);
  install();
  return () => {
    guarded.delete(entry);
    if (guarded.size === 0) uninstall();
  };
}
