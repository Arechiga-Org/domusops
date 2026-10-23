import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReference } from "./fixtures/build-reference.mjs";
import { makeTempDir, makeThrowawayAgeKey } from "./support/tmp.js";
import { encryptWithRoundtrip } from "../src/baseline/secrets.js";
import { writeSopsConfig } from "../src/baseline/sops-config.js";
import { packageVersion } from "../src/cli-support.js";
import { runInit } from "../src/commands/init.js";
import { EXIT_OK } from "../src/exit-codes.js";
import type { CliArgs } from "../src/cli-args.js";

/**
 * `init` tells a contributor whose key is not a recipient yet how to get added (FR-022,
 * specs/007-debt-paydown R18). Only throwaway keys and a throwaway configuration directory.
 */

const cleanups: (() => void)[] = [];
const ENV_KEYS = [
  "SOPS_AGE_KEY",
  "SOPS_AGE_KEY_FILE",
  "SOPS_AGE_KEY_CMD",
  "XDG_CONFIG_HOME",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ["SOPS_AGE_KEY", "SOPS_AGE_KEY_FILE", "SOPS_AGE_KEY_CMD"])
    delete process.env[k];
  const { dir, cleanup } = makeTempDir("domusops-bootstrap-xdg-");
  cleanups.push(cleanup);
  process.env["XDG_CONFIG_HOME"] = dir;
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

interface Summary {
  key: { found: boolean; created: boolean; public: string } | null;
  next_steps: string[];
  elements: { id: string; state: string }[];
}

function run(dir: string, apply: boolean): { code: number; summary: Summary } {
  const args: CliArgs = {
    dir,
    json: true,
    apply,
    force: false,
    ci: false,
    staged: false,
    all: false,
    instanceVersion: undefined,
  };
  const logs: string[] = [];
  const original = console.log;
  console.log = (message: string) => logs.push(message);
  let code: number;
  try {
    code = runInit(args);
  } finally {
    console.log = original;
  }
  return { code, summary: JSON.parse(logs.join("")) as Summary };
}

/**
 * A clone of a configuration that a colleague already set up: `.sops.yaml` lists only their key and
 * `secrets.sops.yaml` is encrypted for it, so this machine's key cannot decrypt it.
 */
function clonedFor(colleague: { keyFile: string; publicKey: string }): string {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  buildReference(dir, {});
  spawnSync("git", ["init", "--quiet"], { cwd: dir });
  const previous = process.env["SOPS_AGE_KEY_FILE"];
  process.env["SOPS_AGE_KEY_FILE"] = colleague.keyFile;
  try {
    writeSopsConfig(dir, [colleague.publicKey], packageVersion());
    expect(encryptWithRoundtrip(dir).ok).toBe(true);
  } finally {
    if (previous === undefined) delete process.env["SOPS_AGE_KEY_FILE"];
    else process.env["SOPS_AGE_KEY_FILE"] = previous;
  }
  return dir;
}

const addKeyLine = (publicKey: string): string =>
  `Your key cannot decrypt secrets.sops.yaml yet. Ask an existing recipient to run: npx --yes @domusops/bootstrap@${packageVersion()} secrets add-key ${publicKey}`;

describe("init when .sops.yaml already lists recipients", () => {
  it("--apply creates this machine's key, reports it, and says how to be added", () => {
    const colleague = makeThrowawayAgeKey();
    const dir = clonedFor(colleague);

    const { code, summary } = run(dir, true);

    expect(code).toBe(EXIT_OK);
    expect(summary.key?.created).toBe(true);
    const mine = summary.key?.public ?? "";
    expect(mine).toMatch(/^age1/);
    expect(mine).not.toBe(colleague.publicKey);
    expect(summary.next_steps).toContain(addKeyLine(mine));
  });

  it("--apply leaves the recipient list as it was", () => {
    const colleague = makeThrowawayAgeKey();
    const dir = clonedFor(colleague);
    run(dir, true);
    expect(readFileSync(join(dir, ".sops.yaml"), "utf8")).toContain(
      colleague.publicKey,
    );
  });

  it("a preview with a key reports it and says how to be added, creating nothing", () => {
    const colleague = makeThrowawayAgeKey();
    const mine = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = mine.keyFile;
    const dir = clonedFor(colleague);

    const { summary } = run(dir, false);

    expect(summary.key).toMatchObject({
      found: true,
      created: false,
      public: mine.publicKey,
    });
    expect(summary.next_steps).toContain(addKeyLine(mine.publicKey));
  });

  it("a preview with no key yet says that --apply creates one, and creates nothing", () => {
    const colleague = makeThrowawayAgeKey();
    const dir = clonedFor(colleague);

    const { code, summary } = run(dir, false);

    expect(code).toBe(EXIT_OK);
    expect(summary.key).toBeNull();
    expect(summary.next_steps).toContain(
      "You have no age key yet; init --apply creates one so a recipient can add you.",
    );
    expect(
      existsSync(
        join(process.env["XDG_CONFIG_HOME"] ?? "", "sops", "age", "keys.txt"),
      ),
    ).toBe(false);
  });

  it("adds no line when this machine's key is already a recipient", () => {
    const mine = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = mine.keyFile;
    const dir = clonedFor(mine);

    for (const apply of [false, true]) {
      const { code, summary } = run(dir, apply);
      expect(code).toBe(EXIT_OK);
      expect(summary.key?.public).toBe(mine.publicKey);
      expect(
        summary.next_steps.filter((line) => line.includes("add-key")),
      ).toEqual([]);
      expect(
        summary.next_steps.filter((line) => line.includes("no age key")),
      ).toEqual([]);
    }
  });
});
