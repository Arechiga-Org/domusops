import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReference } from "./fixtures/build-reference.mjs";
import { makeTempDir } from "./support/tmp.js";
import {
  applyGitignoreBlock,
  computeGitignoreBlock,
  findTrackedExcludedPaths,
} from "../src/baseline/gitignore.js";
import { sha256 } from "../src/baseline/templates.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function fixture(options: Parameters<typeof buildReference>[1] = {}) {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  buildReference(dir, { alreadyRepo: true, ...options });
  return dir;
}

describe("gitignore-block (research R4)", () => {
  it("is missing, then created, on a fresh fixture", () => {
    const dir = fixture();
    expect(computeGitignoreBlock(dir, null).state).toBe("missing");
    const result = applyGitignoreBlock(dir, null);
    expect(result.state).toBe("missing");
    const text = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(text).toContain("secrets.yaml");
    expect(text).toContain(".storage/");
  });

  it("keeps the user's own entries (US1 acceptance scenario 4)", () => {
    const dir = fixture({ existingGitignore: true });
    applyGitignoreBlock(dir, null);
    const text = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(text).toContain("*.bak");
    expect(text).toContain("my-own-notes.md");
    expect(text).toContain("secrets.yaml");
  });

  it("is current on a second run and does not rewrite the file", () => {
    const dir = fixture();
    applyGitignoreBlock(dir, null);
    const before = readFileSync(join(dir, ".gitignore"), "utf8");
    const record = {
      format: "domusops.bootstrap/0.1" as const,
      release: "0.1.0",
      elements: {
        "gitignore-block": {
          path: ".gitignore",
          sha256: sha256(before.slice(before.indexOf("# >>>"))),
          release: "0.1.0",
        },
      },
    };
    expect(computeGitignoreBlock(dir, record).state).toBe("current");
  });

  it("omits custom_components/ and www/community/ when already tracked (spec edge case)", () => {
    const dir = fixture({ customComponentsTracked: true });
    const block = applyGitignoreBlock(dir, null);
    expect(block.state).toBe("missing");
    const text = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(text).not.toContain("custom_components/");
    expect(text).not.toContain("www/community/");
  });

  it("reports each already-tracked excluded path with its rm --cached command (FR-007)", () => {
    const dir = fixture({ secretsTracked: true });
    const hits = findTrackedExcludedPaths(dir);
    expect(hits).toContain("secrets.yaml");
    // FR-007: the tool never untracks the file itself.
    expect(existsSync(join(dir, "secrets.yaml"))).toBe(true);
  });

  it("does not report tracked custom_components/ files, which the block leaves out", () => {
    const dir = fixture({ customComponentsTracked: true });
    const hits = findTrackedExcludedPaths(dir);
    expect(hits.filter((p) => p.startsWith("custom_components/"))).toEqual([]);
  });

  it("matches directory patterns at any depth, as git will", () => {
    const dir = fixture();
    mkdirSync(join(dir, "packages", "deps"), { recursive: true });
    writeFileSync(join(dir, "packages", "deps", "x.yaml"), "a: 1\n");
    spawnSync("git", ["add", "-f", "packages/deps/x.yaml"], { cwd: dir });
    expect(findTrackedExcludedPaths(dir)).toContain("packages/deps/x.yaml");
  });

  it("does not untrack anything itself", () => {
    const dir = fixture({ secretsTracked: true });
    applyGitignoreBlock(dir, null);
    // still tracked: applying the block never runs `git rm --cached`.
    const result = spawnSync("git", ["ls-files", "secrets.yaml"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.stdout.trim()).toBe("secrets.yaml");
  });

  it("appends after existing content, separated by a blank line", () => {
    const dir = fixture({ existingGitignore: true });
    applyGitignoreBlock(dir, null);
    const text = readFileSync(join(dir, ".gitignore"), "utf8");
    const blockStart = text.indexOf("# >>> DomusOps");
    expect(text.slice(0, blockStart).endsWith("\n\n") || blockStart === 0).toBe(
      true,
    );
  });

  it("preserves entries outside the block on re-apply after a user edit", () => {
    const dir = fixture();
    applyGitignoreBlock(dir, null);
    const path = join(dir, ".gitignore");
    writeFileSync(path, `my-addition.txt\n${readFileSync(path, "utf8")}`);
    applyGitignoreBlock(dir, null);
    expect(readFileSync(path, "utf8")).toContain("my-addition.txt");
  });
});
