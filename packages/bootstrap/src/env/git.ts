import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";

/**
 * Git plumbing shared by every baseline element and by `check`/`validate`. Every function takes
 * the configuration directory as `dir` and runs git with that as its working directory.
 */

function git(
  dir: string,
  args: readonly string[],
  opts: { sensitive?: boolean } = {},
) {
  return run("git", args, { cwd: dir, sensitive: opts.sensitive });
}

export function isRepo(dir: string): boolean {
  return git(dir, ["rev-parse", "--is-inside-work-tree"]).code === 0;
}

export function init(dir: string): void {
  const result = git(dir, ["init", "--quiet"]);
  if (result.code !== 0) {
    throw new Error(`git init failed in ${dir}: ${result.stderr.trim()}`);
  }
}

/** Every file git tracks, as paths relative to `dir`. */
export function lsFilesAll(dir: string): string[] {
  const result = git(dir, ["ls-files", "-z"]);
  return splitNul(result.stdout);
}

/** Every file present but not tracked and not ignored (for `validate`'s temporary copy, R9). */
export function lsFilesUntrackedNotIgnored(dir: string): string[] {
  const result = git(dir, ["ls-files", "-z", "--others", "--exclude-standard"]);
  return splitNul(result.stdout);
}

export function isTracked(dir: string, path: string): boolean {
  return git(dir, ["ls-files", "--error-unmatch", "--", path]).code === 0;
}

/** Converts a single `.gitignore`-style pattern (no `!` negation) to a matcher. */
function matchesPattern(relPath: string, pattern: string): boolean {
  if (pattern.endsWith("/")) {
    const dir = pattern.slice(0, -1);
    return relPath === dir || relPath.startsWith(`${dir}/`);
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  if (pattern.includes("/")) return re.test(relPath);
  const base = relPath.split("/").pop() ?? relPath;
  return re.test(base);
}

/**
 * Which of `patterns` (gitignore-style, as written into the exclusion block, research R4) match
 * at least one currently tracked file, each with the paths that matched (spec FR-007).
 */
export function lsFilesTracked(
  dir: string,
  patterns: readonly string[],
): Map<string, string[]> {
  const all = lsFilesAll(dir);
  const hits = new Map<string, string[]>();
  for (const pattern of patterns) {
    const matches = all.filter((path) => matchesPattern(path, pattern));
    if (matches.length > 0) hits.set(pattern, matches);
  }
  return hits;
}

/**
 * Staged file paths that still exist after the commit (`git diff --cached --name-only`, deletions
 * left out), for `check --staged` (research R8): removing a file is never a finding, and it is how
 * a committed `secrets.yaml` gets untracked.
 */
export function diffCachedNames(dir: string): string[] {
  const result = git(dir, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=d",
    "-z",
  ]);
  return splitNul(result.stdout);
}

/** The staged content of `path` (`git show :path`); may contain a secret (research R8). */
export function showStagedBlob(dir: string, path: string): string {
  const result = git(dir, ["show", `:${path}`], { sensitive: true });
  if (result.code !== 0) return "";
  return result.stdout;
}

/** The tracked, working-tree content of `path`; `null` when it is not tracked. */
export function showTrackedFile(dir: string, path: string): string | null {
  if (!isTracked(dir, path)) return null;
  const result = git(dir, ["show", `HEAD:${path}`], { sensitive: true });
  return result.code === 0 ? result.stdout : null;
}

/** Every commit (any branch) that ever touched `path` (spec FR-014's history check). */
export function logAllTouching(dir: string, path: string): string[] {
  const result = git(dir, ["log", "--all", "--format=%H", "--", path]);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

export function getLocalConfig(dir: string, key: string): string | null {
  const result = git(dir, ["config", "--local", "--get", key]);
  return result.code === 0 ? result.stdout.trim() : null;
}

export function setLocalConfig(dir: string, key: string, value: string): void {
  const result = git(dir, ["config", "--local", key, value]);
  if (result.code !== 0) {
    throw new Error(
      `git config --local ${key} failed in ${dir}: ${result.stderr.trim()}`,
    );
  }
}

function splitNul(text: string): string[] {
  return text.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Tracked files that the given `.gitignore`-syntax rules would exclude (`git ls-files -ci
 * --exclude-from`, research R4): git's own matcher, so depth, anchoring, and wildcards behave
 * exactly as they will once the block is in `.gitignore`.
 */
export function lsFilesTrackedExcluded(dir: string, rules: string): string[] {
  const scratch = mkdtempSync(join(tmpdir(), "domusops-ignore-"));
  try {
    const file = join(scratch, "rules");
    writeFileSync(file, rules);
    const result = git(dir, [
      "ls-files",
      "-z",
      "--cached",
      "--ignored",
      `--exclude-from=${file}`,
    ]);
    return splitNul(result.stdout);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
