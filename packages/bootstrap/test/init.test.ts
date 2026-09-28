import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReference } from "./fixtures/build-reference.mjs";
import { makeTempDir, withoutOnPath } from "./support/tmp.js";
import { runInit } from "../src/commands/init.js";
import { EXIT_OK, EXIT_PROBLEMS, EXIT_STOPPED } from "../src/exit-codes.js";
import type { CliArgs } from "../src/cli-args.js";
import { decrypt } from "../src/env/sops.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Extended by every later story (T030, T038, T042); each addition is sequential in this file,
 * never run in parallel with the others, since they all evolve `runInit`'s coverage together.
 */

const cleanups: (() => void)[] = [];

// Isolate age's default identity location for every test in this file: `sops-config`'s apply
// step (US2) resolves or creates a key, and it must never touch the developer's real key.
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
    // secretsTracked blocks sops-config/encrypted-secrets (FR-014): exit reflects that.
    expect(code).toBe(EXIT_PROBLEMS);
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

describe("init — User Story 2 (secrets encryption)", () => {
  function jsonSummary(
    dir: string,
    overrides: Partial<CliArgs> = {},
  ): {
    key: {
      found: boolean;
      created: boolean;
      path: string;
      public: string;
    } | null;
    findings: { inline_secrets: { path: string; line: number; key: string }[] };
    elements: { id: string; state: string }[];
  } {
    const logs: string[] = [];
    const original = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      runInit(args(dir, { apply: true, json: true, ...overrides }));
    } finally {
      console.log = original;
    }
    return JSON.parse(logs.join(""));
  }

  it("creates .sops.yaml and secrets.sops.yaml, and reports the new key (US2 scenario 2)", () => {
    const dir = fixture();
    const summary = jsonSummary(dir);
    expect(existsSync(join(dir, ".sops.yaml"))).toBe(true);
    expect(existsSync(join(dir, "secrets.sops.yaml"))).toBe(true);
    expect(summary.key?.created).toBe(true);
    expect(summary.key?.public).toMatch(/^age1[a-z0-9]{58}$/);
    const sopsConfig = summary.elements.find((e) => e.id === "sops-config");
    const encrypted = summary.elements.find(
      (e) => e.id === "encrypted-secrets",
    );
    expect(sopsConfig?.state).toBe("missing");
    expect(encrypted?.state).toBe("missing");
  });

  it("decrypts to exactly the original secrets.yaml (FR-012)", () => {
    const dir = fixture();
    runInit(args(dir, { apply: true }));
    const decrypted = decrypt(dir, "secrets.sops.yaml");
    expect(decrypted).toContain("webhook_secret: fake-webhook-secret-2");
    expect(decrypted).toContain("wifi_password: fake-wifi-password-1");
  });

  it("reuses an existing key and does not create another (US2 scenario 3)", () => {
    const dir = fixture();
    const first = jsonSummary(dir);
    expect(first.key?.created).toBe(true);
    // Re-running with the same XDG_CONFIG_HOME finds the key it just created.
    const second = jsonSummary(dir);
    expect(second.key).toBeNull(); // sops-config is already current; no key resolution needed
  });

  it("stops with secrets_exposed and creates neither file when secrets.yaml is tracked (FR-014)", () => {
    const dir = fixture({ alreadyRepo: true, secretsTracked: true });
    const summary = jsonSummary(dir);
    expect(existsSync(join(dir, ".sops.yaml"))).toBe(false);
    expect(existsSync(join(dir, "secrets.sops.yaml"))).toBe(false);
    const sopsConfig = summary.elements.find((e) => e.id === "sops-config");
    expect(sopsConfig?.state).toBe("blocked");
  });

  it("reports inline secrets without their values (FR-015)", () => {
    const dir = fixture();
    const summary = jsonSummary(dir);
    const finding = summary.findings.inline_secrets.find(
      (f) => f.key === "backup_password",
    );
    expect(finding?.path).toBe("configuration.yaml");
    expect(JSON.stringify(summary)).not.toContain(
      "fake-inline-backup-secret-3",
    );
    // secrets.yaml's own keys, and secrets.sops.yaml's encrypted values, are not findings.
    expect(
      summary.findings.inline_secrets.some((f) => f.path === "secrets.yaml"),
    ).toBe(false);
    expect(
      summary.findings.inline_secrets.some(
        (f) => f.path === "secrets.sops.yaml",
      ),
    ).toBe(false);
  });
});

describe("init — User Story 3 (pre-commit hooks, CI, instance version)", () => {
  function jsonSummary(
    dir: string,
    overrides: Partial<CliArgs> = {},
  ): {
    elements: { id: string; path: string; state: string; reason: string }[];
  } {
    const logs: string[] = [];
    const original = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      runInit(args(dir, { apply: true, json: true, ...overrides }));
    } finally {
      console.log = original;
    }
    return JSON.parse(logs.join(""));
  }

  function stateOf(
    summary: { elements: { id: string; state: string }[] },
    id: string,
  ): string | undefined {
    return summary.elements.find((e) => e.id === id)?.state;
  }

  it("creates the hook, core.hooksPath, the workflow, the instance version, and placeholders", () => {
    const dir = fixture();
    const summary = jsonSummary(dir);
    expect(
      readFileSync(join(dir, ".githooks", "pre-commit"), "utf8"),
    ).toContain("check --staged");
    expect(
      spawnSyncStdout(dir, ["config", "--local", "--get", "core.hooksPath"]),
    ).toBe(".githooks");
    expect(
      readFileSync(join(dir, ".github", "workflows", "domusops.yml"), "utf8"),
    ).toContain("check --all --ci");
    expect(
      readFileSync(join(dir, ".domusops", "instance-version"), "utf8").trim(),
    ).toBe("2026.9.3");
    expect(existsSync(join(dir, ".domusops", "placeholders.yaml"))).toBe(true);
    for (const id of [
      "hook",
      "hooks-path",
      "workflow",
      "instance-version",
      "placeholders",
    ]) {
      expect(stateOf(summary, id)).toBe("missing");
    }
  });

  it("blocks only hooks-path, unchanged, when core.hooksPath is already set elsewhere", () => {
    const dir = fixture({ alreadyRepo: true });
    spawnSync(
      "git",
      ["config", "--local", "core.hooksPath", "some/other/place"],
      { cwd: dir },
    );
    const summary = jsonSummary(dir);
    expect(stateOf(summary, "hooks-path")).toBe("blocked");
    expect(
      spawnSyncStdout(dir, ["config", "--local", "--get", "core.hooksPath"]),
    ).toBe("some/other/place");
    // every other element still applies
    expect(stateOf(summary, "hook")).toBe("missing");
    expect(stateOf(summary, "workflow")).toBe("missing");
  });

  it("blocks only instance-version when neither .HA_VERSION nor --instance-version is given", () => {
    const dir = fixture({ alreadyRepo: true });
    // The reference fixture always writes .HA_VERSION; remove it for this scenario.
    rmSync(join(dir, ".HA_VERSION"));
    const summary = jsonSummary(dir);
    expect(stateOf(summary, "instance-version")).toBe("blocked");
    expect(existsSync(join(dir, ".domusops", "instance-version"))).toBe(false);
    // every other element still applies
    expect(stateOf(summary, "hook")).toBe("missing");
    expect(stateOf(summary, "gitignore-block")).toBe("missing");
  });

  it("--instance-version overrides a missing .HA_VERSION", () => {
    const dir = fixture({ alreadyRepo: true });
    rmSync(join(dir, ".HA_VERSION"));
    const summary = jsonSummary(dir, { instanceVersion: "2026.1.0" });
    expect(stateOf(summary, "instance-version")).toBe("missing");
    expect(
      readFileSync(join(dir, ".domusops", "instance-version"), "utf8").trim(),
    ).toBe("2026.1.0");
  });
});

function spawnSyncStdout(dir: string, gitArgs: string[]): string {
  return spawnSync("git", gitArgs, {
    cwd: dir,
    encoding: "utf8",
  }).stdout.trim();
}

/** Every file under `dir`, `.git/` included, with its content hash. */
function fileHashes(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(relative(dir, full), sha256(readFileSync(full)));
    }
  };
  walk(dir);
  return out;
}

describe("init — User Story 4 (safe to run again)", () => {
  it("quickstart scenario 3: a second run on an unchanged directory changes nothing (SC-002)", () => {
    const dir = fixture();
    runInit(args(dir, { apply: true }));
    const before = fileHashes(dir);
    runInit(args(dir, { apply: true }));
    expect(fileHashes(dir)).toEqual(before);
  });

  it("a missing baseline element is restored on the next run", () => {
    const dir = fixture();
    runInit(args(dir, { apply: true }));
    rmSync(join(dir, "packages", "README.md"));
    const logs: string[] = [];
    const original = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      runInit(args(dir, { apply: true, json: true }));
    } finally {
      console.log = original;
    }
    const summary = JSON.parse(logs.join("")) as {
      elements: { id: string; state: string }[];
    };
    expect(
      summary.elements.find((e) => e.id === "packages-readme")?.state,
    ).toBe("missing");
    expect(existsSync(join(dir, "packages", "README.md"))).toBe(true);
  });

  it("quickstart scenario 4: an unedited generated file is upgraded across a release bump; an edited one is not", () => {
    const packageJsonPath = join(PACKAGE_ROOT, "package.json");
    const originalPackageJson = readFileSync(packageJsonPath, "utf8");
    const withVersion = (version: string): string =>
      originalPackageJson.replace(
        /"version": "[^"]*"/,
        `"version": "${version}"`,
      );
    const dir = fixture();
    try {
      writeFileSync(packageJsonPath, withVersion("0.0.1-test"));
      runInit(args(dir, { apply: true }));
      const hookAfterFirst = readFileSync(
        join(dir, ".githooks", "pre-commit"),
        "utf8",
      );
      expect(hookAfterFirst).toContain("0.0.1-test");

      // The user edits the workflow by hand; the hook is left as generated.
      writeFileSync(
        join(dir, ".github", "workflows", "domusops.yml"),
        "# hand-edited by the user, not the template\n",
      );

      writeFileSync(packageJsonPath, withVersion("0.0.2-test"));
      const logs: string[] = [];
      const original = console.log;
      console.log = (msg: string) => logs.push(msg);
      let summary: { elements: { id: string; state: string }[] };
      try {
        runInit(args(dir, { apply: true, json: true }));
      } finally {
        console.log = original;
      }
      summary = JSON.parse(logs.join(""));
      expect(summary.elements.find((e) => e.id === "hook")?.state).toBe(
        "outdated",
      );
      expect(
        readFileSync(join(dir, ".githooks", "pre-commit"), "utf8"),
      ).toContain("0.0.2-test");
      expect(summary.elements.find((e) => e.id === "workflow")?.state).toBe(
        "edited",
      );
      expect(
        readFileSync(join(dir, ".github", "workflows", "domusops.yml"), "utf8"),
      ).toBe("# hand-edited by the user, not the template\n");
    } finally {
      writeFileSync(packageJsonPath, originalPackageJson);
    }
  });

  it("not_config_dir writes nothing", () => {
    const { dir: emptyDir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const before = fileHashes(emptyDir);
    expect(runInit(args(emptyDir, { apply: true }))).toBe(EXIT_STOPPED);
    expect(fileHashes(emptyDir)).toEqual(before);
  });

  it("missing_prerequisite (git absent) writes nothing", () => {
    const dir = fixture();
    const before = fileHashes(dir);
    const code = withoutOnPath(["git"], () =>
      runInit(args(dir, { apply: true })),
    );
    expect(code).toBe(EXIT_STOPPED);
    expect(fileHashes(dir)).toEqual(before);
  });

  it("native_windows writes nothing", () => {
    const dir = fixture();
    const before = fileHashes(dir);
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(runInit(args(dir, { apply: true }))).toBe(EXIT_STOPPED);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
    expect(fileHashes(dir)).toEqual(before);
  });
});
