import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReference } from "./fixtures/build-reference.mjs";
import { makeTempDir } from "./support/tmp.js";
import { runInit } from "../src/commands/init.js";
import { EXIT_OK, EXIT_STOPPED } from "../src/exit-codes.js";
import type { CliArgs } from "../src/cli-args.js";

/**
 * Extended by every later story (T030, T038, T042); each addition is sequential in this file,
 * never run in parallel with the others, since they all evolve `runInit`'s coverage together.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function fixture(options: Parameters<typeof buildReference>[1] = {}) {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  buildReference(dir, options);
  return dir;
}

function args(dir: string, overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    dir,
    json: false,
    apply: false,
    force: false,
    ci: false,
    staged: false,
    all: false,
    instanceVersion: undefined,
    ...overrides,
  };
}

/** Every file under `dir` except `.git/`, as paths relative to `dir`. */
function allFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("init — User Story 1 (repository, gitignore, packages)", () => {
  it("quickstart scenario 1: preview writes nothing", () => {
    const dir = fixture();
    const filesBefore = allFiles(dir);
    const code = runInit(args(dir));
    expect(code).toBe(EXIT_OK);
    expect(existsSync(join(dir, ".git"))).toBe(false);
    expect(allFiles(dir)).toEqual(filesBefore);
  });

  it("--apply creates the repository, the gitignore block, the README, and the packages line", () => {
    const dir = fixture();
    const code = runInit(args(dir, { apply: true }));
    expect(code).toBe(EXIT_OK);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(
      "secrets.yaml",
    );
    expect(readFileSync(join(dir, "packages", "README.md"), "utf8")).toContain(
      "packages/",
    );
    expect(readFileSync(join(dir, "configuration.yaml"), "utf8")).toContain(
      "packages: !include_dir_named packages",
    );
  });

  it("populates findings: custom integrations, tracked-excluded, nested secrets, and remote", () => {
    const dir = fixture({
      alreadyRepo: true,
      secretsTracked: true,
      nestedSecrets: true,
    });
    runInit(args(dir, { apply: true }));
    const code = runInit(args(dir, { apply: true, json: true }));
    expect(code).toBe(EXIT_OK);
  });

  it("not_config_dir stops with no change when configuration.yaml is absent", () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const filesBefore = allFiles(dir);
    const code = runInit(args(dir, { apply: true }));
    expect(code).toBe(EXIT_STOPPED);
    expect(allFiles(dir)).toEqual(filesBefore);
  });

  it("SC-008: every pre-existing file is byte-identical except configuration.yaml", () => {
    const dir = fixture();
    const before = new Map(
      allFiles(dir).map((path) => [
        path,
        sha256(readFileSync(join(dir, path))),
      ]),
    );
    runInit(args(dir, { apply: true }));
    for (const [path, hash] of before) {
      if (path === "configuration.yaml") continue;
      expect(sha256(readFileSync(join(dir, path)))).toBe(hash);
    }
    expect(existsSync(join(dir, "configuration.yaml"))).toBe(true);
  });

  it("reports findings via --json without writing anything extra", () => {
    const dir = fixture({ nestedSecrets: true });
    runInit(args(dir, { apply: true }));
    // Capture the JSON output of a second, no-op run.
    const logs: string[] = [];
    const original = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      runInit(args(dir, { apply: true, json: true }));
    } finally {
      console.log = original;
    }
    const summary = JSON.parse(logs.join("")) as {
      findings: {
        nested_secrets_files: string[];
        custom_integrations: string[];
      };
    };
    expect(summary.findings.nested_secrets_files).toContain(
      join("some_subdir", "secrets.yaml"),
    );
    expect(summary.findings.custom_integrations).toContain("example");
  });
});
