import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/env/exec.js";

/** A temporary directory that cleans itself up; never the developer's real filesystem. */
export function makeTempDir(prefix = "domusops-bootstrap-"): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A throwaway age identity for tests, so a test never touches the developer's own key. Requires
 * `age-keygen` on `PATH`.
 */
export function makeThrowawayAgeKey(): { keyFile: string; publicKey: string } {
  const { dir } = makeTempDir("domusops-bootstrap-age-");
  const keyFile = join(dir, "keys.txt");
  const result = run("age-keygen", ["-o", keyFile]);
  if (result.code !== 0) {
    throw new Error(`age-keygen failed: ${result.stderr.trim()}`);
  }
  const match = /Public key:\s*(age1[a-z0-9]+)/.exec(result.stderr);
  const publicKey = match?.[1];
  if (publicKey === undefined) {
    throw new Error("age-keygen did not report a public key on stderr");
  }
  return { keyFile, publicKey };
}

/**
 * Runs `fn` with a `PATH` that hides every binary named in `names`, by pointing `PATH` at a
 * temporary directory containing symlinks to everything on the real `PATH` except those names.
 */
export function withoutOnPath<T>(names: readonly string[], fn: () => T): T {
  const realPath = process.env["PATH"] ?? "";
  const dirs = realPath.split(":").filter((d) => d.length > 0);
  const { dir, cleanup } = makeTempDir("domusops-bootstrap-path-");
  try {
    const seen = new Set<string>();
    for (const d of dirs) {
      let entries: string[];
      try {
        entries = run("ls", [d])
          .stdout.split("\n")
          .filter((e) => e.length > 0);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (names.includes(entry) || seen.has(entry)) continue;
        seen.add(entry);
        run("ln", ["-s", join(d, entry), join(dir, entry)]);
      }
    }
    const savedPath = process.env["PATH"];
    process.env["PATH"] = dir;
    try {
      return fn();
    } finally {
      process.env["PATH"] = savedPath;
    }
  } finally {
    cleanup();
  }
}
