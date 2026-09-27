import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir, makeThrowawayAgeKey } from "./support/tmp.js";
import { runCheck } from "../src/commands/check.js";
import { writeSopsConfig } from "../src/baseline/sops-config.js";
import { encryptWithRoundtrip } from "../src/baseline/secrets.js";
import { EXIT_OK, EXIT_PROBLEMS } from "../src/exit-codes.js";
import type { CliArgs } from "../src/cli-args.js";

const cleanups: (() => void)[] = [];
const savedSopsAgeKeyFile = process.env["SOPS_AGE_KEY_FILE"];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  if (savedSopsAgeKeyFile === undefined)
    delete process.env["SOPS_AGE_KEY_FILE"];
  else process.env["SOPS_AGE_KEY_FILE"] = savedSopsAgeKeyFile;
});

function repo(): string {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  spawnSync("git", ["init", "--quiet"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "t@example.invalid"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir });
  return dir;
}

function stage(dir: string, path: string, content: string): void {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  spawnSync("git", ["add", path], { cwd: dir });
}

function args(dir: string, overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    dir,
    json: true,
    apply: false,
    force: false,
    ci: false,
    staged: true,
    all: false,
    instanceVersion: undefined,
    ...overrides,
  };
}

function runAndCapture(a: CliArgs): { code: number; output: string } {
  const logs: string[] = [];
  const original = console.log;
  console.log = (msg: string) => logs.push(msg);
  let code: number;
  try {
    code = runCheck(a);
  } finally {
    console.log = original;
  }
  return { code, output: logs.join("\n") };
}

describe("check (research R8)", () => {
  it("yaml-syntax blocks malformed YAML", () => {
    const dir = repo();
    stage(dir, "configuration.yaml", "a:\n  b: 1\n bad_indent: true\n");
    const { code, output } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("yaml-syntax");
  });

  it("plaintext-secrets blocks a staged secrets.yaml", () => {
    const dir = repo();
    stage(dir, "secrets.yaml", "wifi_password: whatever\n");
    const { code, output } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("plaintext-secrets");
    expect(output).not.toContain("whatever");
  });

  it("unencrypted-sops blocks a *.sops.yaml with a plain value", () => {
    const dir = repo();
    stage(
      dir,
      "secrets.sops.yaml",
      "wifi_password: not-encrypted\nsops:\n  version: 3\n",
    );
    const { code, output } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("unencrypted-sops");
  });

  it("unencrypted-sops passes a genuinely encrypted file", () => {
    const { keyFile, publicKey } = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = keyFile;
    const dir = repo();
    writeSopsConfig(dir, [publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-1\n");
    encryptWithRoundtrip(dir);
    spawnSync("git", ["add", "secrets.sops.yaml", ".sops.yaml"], { cwd: dir });
    const { code } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_OK);
  });

  it("secret-value blocks a staged file containing a local secrets.yaml value", () => {
    const dir = repo();
    writeFileSync(
      join(dir, "secrets.yaml"),
      "wifi_password: shared-value-12345\n",
    );
    stage(dir, "notes.yaml", "reminder: shared-value-12345\n");
    const { code, output } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("secret-value");
    expect(output).not.toContain("shared-value-12345");
  });

  it("secret-value is skipped in --ci mode (no plaintext file there)", () => {
    const dir = repo();
    writeFileSync(
      join(dir, "secrets.yaml"),
      "wifi_password: shared-value-99999\n",
    );
    stage(dir, "notes.yaml", "reminder: shared-value-99999\n");
    const { code } = runAndCapture(args(dir, { ci: true }));
    expect(code).toBe(EXIT_OK);
  });

  it("private-key blocks a staged age identity", () => {
    const dir = repo();
    stage(
      dir,
      "oops.txt",
      "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ\n",
    );
    const { code, output } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("private-key");
    expect(output).not.toContain("AGE-SECRET-KEY-1QQQQ");
  });

  it("private-key blocks a staged PEM private key", () => {
    const dir = repo();
    stage(
      dir,
      "id_rsa",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----\n",
    );
    const { code, output } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("private-key");
  });

  it("a clean change is not blocked", () => {
    const dir = repo();
    stage(
      dir,
      "automations.yaml",
      "- id: '1'\n  alias: Example\n  trigger: []\n  action: []\n",
    );
    const { code } = runAndCapture(args(dir));
    expect(code).toBe(EXIT_OK);
  });

  it("check --all scans every tracked file, not just staged ones", () => {
    const dir = repo();
    stage(dir, "configuration.yaml", "a: 1\n");
    spawnSync("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: whatever\n");
    spawnSync("git", ["add", "-f", "secrets.yaml"], { cwd: dir });
    spawnSync("git", ["commit", "--quiet", "-m", "oops, committed a secret"], {
      cwd: dir,
    });
    const { code, output } = runAndCapture(
      args(dir, { staged: false, all: true }),
    );
    expect(code).toBe(EXIT_PROBLEMS);
    expect(output).toContain("plaintext-secrets");
  });
});
