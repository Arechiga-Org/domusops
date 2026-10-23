import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A random identifier of this user's machine, kept in a file, that tied instances record as their
 * owner's machine. Unlike the host name, which changes with the network, it stays put, so cleanup
 * can still tell that an instance was started here (specs/007-debt-paydown data-model §1).
 */
const ID_FORMAT = /^[0-9a-f]{32}$/;

export function machineIdPath(): string {
  const base = process.env["XDG_STATE_HOME"];
  return join(
    base !== undefined && base !== ""
      ? base
      : join(homedir(), ".local", "state"),
    "domusops",
    "machine-id",
  );
}

/** The stored identifier, or null when there is none or the file does not hold one. */
export function readMachineId(): string | null {
  try {
    const text = readFileSync(machineIdPath(), "utf8").trim();
    return ID_FORMAT.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** Blocks the thread for `ms`; the file reads here are synchronous, so the wait has to be too. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const READ_ATTEMPTS = 20;
const READ_PAUSE_MS = 10;

/**
 * The identifier, created on first use. The file is created exclusively, so two first uses agree on
 * whichever won. The winner creates the file before it writes to it, so a loser that reads in
 * between finds it empty: it reads again, a few times, before giving up. A file that exists but
 * holds something else is never overwritten (null), and an unwritable location gives null as well:
 * the caller then records no machine and the 0.1.0 rule (the host name) applies. `pause` is a seam
 * for tests.
 */
export function ensureMachineId(
  pause: (ms: number) => void = sleepSync,
): string | null {
  const existing = readMachineId();
  if (existing !== null) return existing;
  const path = machineIdPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const created = randomBytes(16).toString("hex");
    writeFileSync(path, `${created}\n`, { flag: "wx", mode: 0o600 });
    return created;
  } catch (error) {
    // Another process created it first: that one wins. Anything else is no identifier.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
      const winner = readMachineId();
      if (winner !== null) return winner;
      pause(READ_PAUSE_MS);
    }
    return null;
  }
}
