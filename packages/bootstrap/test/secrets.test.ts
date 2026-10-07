import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir, makeThrowawayAgeKey } from "./support/tmp.js";
import {
  checkExposure,
  encryptWithRoundtrip,
  secretsExposedStop,
} from "../src/baseline/secrets.js";
import { resolveOrCreateKey } from "../src/baseline/key.js";
import { runSecrets } from "../src/commands/secrets.js";
import {
  writeSopsConfig,
  readRecipients,
} from "../src/baseline/sops-config.js";
import { decrypt } from "../src/env/sops.js";
import { isValidPublicKey } from "../src/env/age.js";
import type { CliArgs } from "../src/cli-args.js";
import { EXIT_OK, EXIT_PROBLEMS } from "../src/exit-codes.js";
import { spawnSync } from "node:child_process";

const cleanups: (() => void)[] = [];
const envKeys = [
  "SOPS_AGE_KEY",
  "SOPS_AGE_KEY_FILE",
  "SOPS_AGE_KEY_CMD",
  "XDG_CONFIG_HOME",
] as const;
let savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function saveEnv(): void {
  savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
}

function fixtureDir(): string {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
}

function initGitRepo(dir: string): void {
  spawnSync("git", ["init", "--quiet"], { cwd: dir });
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

describe("resolveOrCreateKey (spec FR-011)", () => {
  it("creates a key when none exists (US2 acceptance scenario 2)", () => {
    saveEnv();
    delete process.env["SOPS_AGE_KEY"];
    delete process.env["SOPS_AGE_KEY_FILE"];
    delete process.env["SOPS_AGE_KEY_CMD"];
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    process.env["XDG_CONFIG_HOME"] = dir;
    const result = resolveOrCreateKey();
    expect(result.created).toBe(true);
    expect(isValidPublicKey(result.publicKey)).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
  });

  it("uses an existing key and does not create another (US2 acceptance scenario 3)", () => {
    saveEnv();
    const { keyFile, publicKey } = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = keyFile;
    const result = resolveOrCreateKey();
    expect(result.created).toBe(false);
    expect(result.publicKey).toBe(publicKey);
    expect(result.path).toBe(keyFile);
  });
});

describe("encryptWithRoundtrip / decryptToPlaintext (FR-012, FR-013)", () => {
  it("round-trips exactly, mode 0600", () => {
    saveEnv();
    const { keyFile, publicKey } = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [publicKey]);
    writeFileSync(
      join(dir, "secrets.yaml"),
      "wifi_password: fake-value-1\nport: 8080\n",
    );

    const result = encryptWithRoundtrip(dir);
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, "secrets.sops.yaml"))).toBe(true);

    const decrypted = decrypt(dir, "secrets.sops.yaml");
    expect(decrypted).toContain("wifi_password: fake-value-1");
    expect(decrypted).toContain("port: 8080");
  });

  it("encrypts an empty mapping when no secrets.yaml exists (spec edge case)", () => {
    saveEnv();
    const { keyFile, publicKey } = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [publicKey]);

    const result = encryptWithRoundtrip(dir);
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, "secrets.yaml"))).toBe(false);
    expect(decrypt(dir, "secrets.sops.yaml").trim()).toBe("{}");
  });

  it("leaves the previous secrets.sops.yaml untouched when the round trip cannot decrypt", () => {
    saveEnv();
    const recipient = makeThrowawayAgeKey();
    const stranger = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = stranger.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [recipient.publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-6\n");
    writeFileSync(join(dir, "secrets.sops.yaml"), "previous: kept\n");

    const result = encryptWithRoundtrip(dir);
    expect(result.ok).toBe(false);
    expect(readFileSync(join(dir, "secrets.sops.yaml"), "utf8")).toBe(
      "previous: kept\n",
    );
  });

  it("removes a new secrets.sops.yaml that failed the round trip, when there was none before", () => {
    saveEnv();
    const recipient = makeThrowawayAgeKey();
    const stranger = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = stranger.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [recipient.publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-7\n");

    expect(encryptWithRoundtrip(dir).ok).toBe(false);
    expect(existsSync(join(dir, "secrets.sops.yaml"))).toBe(false);
  });

  it("decrypt writes secrets.yaml at mode 0600", () => {
    saveEnv();
    const { keyFile, publicKey } = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-2\n");
    encryptWithRoundtrip(dir);
    const code = runSecrets("decrypt", [], args(dir, { force: true }));
    expect(code).toBe(EXIT_OK);
    expect(statSync(join(dir, "secrets.yaml")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "secrets.yaml"), "utf8")).toContain(
      "fake-value-2",
    );
  });
});

describe("checkExposure (spec FR-014)", () => {
  it("flags a tracked secrets.yaml without rewriting history", () => {
    const dir = fixtureDir();
    initGitRepo(dir);
    spawnSync("git", ["config", "user.email", "t@example.invalid"], {
      cwd: dir,
    });
    spawnSync("git", ["config", "user.name", "T"], { cwd: dir });
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: exposed\n");
    spawnSync("git", ["add", "secrets.yaml"], { cwd: dir });
    spawnSync("git", ["commit", "--quiet", "-m", "add secrets"], { cwd: dir });

    expect(checkExposure(dir)).toBe(true);
    expect(secretsExposedStop().reason).toBe("secrets_exposed");

    const logBefore = spawnSync("git", ["log", "--oneline"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    // The check itself never touches history.
    const logAfter = spawnSync("git", ["log", "--oneline"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    expect(logAfter).toBe(logBefore);
  });

  it("is clean when secrets.yaml was never tracked", () => {
    const dir = fixtureDir();
    initGitRepo(dir);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: never-tracked\n");
    expect(checkExposure(dir)).toBe(false);
  });
});

describe("secrets add-key / remove-key (spec FR-028)", () => {
  it("lets a second key decrypt without the first key's private material (quickstart scenario 9)", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-3\n");
    encryptWithRoundtrip(dir);

    const addCode = runSecrets("add-key", [key2.publicKey], args(dir));
    expect(addCode).toBe(EXIT_OK);
    expect(readRecipients(dir)).toEqual([key1.publicKey, key2.publicKey]);

    process.env["SOPS_AGE_KEY_FILE"] = key2.keyFile;
    const decrypted = decrypt(dir, "secrets.sops.yaml");
    expect(decrypted).toContain("fake-value-3");
  });

  it("refuses to remove the last recipient", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-4\n");
    encryptWithRoundtrip(dir);

    const code = runSecrets("remove-key", [key1.publicKey], args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(readRecipients(dir)).toEqual([key1.publicKey]);
  });

  it("removes a key that is not the last one", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey, key2.publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-5\n");
    encryptWithRoundtrip(dir);

    const code = runSecrets("remove-key", [key2.publicKey], args(dir));
    expect(code).toBe(EXIT_OK);
    expect(readRecipients(dir)).toEqual([key1.publicKey]);
  });

  it("add-key rolls .sops.yaml back when the keys cannot be re-wrapped", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    const stranger = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey]);
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-8\n");
    encryptWithRoundtrip(dir);
    const before = readFileSync(join(dir, ".sops.yaml"), "utf8");

    // The caller's key is not a recipient, so `sops updatekeys` cannot unwrap the data key.
    process.env["SOPS_AGE_KEY_FILE"] = stranger.keyFile;
    const code = runSecrets("add-key", [key2.publicKey], args(dir));
    expect(code).toBe(EXIT_PROBLEMS);
    expect(readFileSync(join(dir, ".sops.yaml"), "utf8")).toBe(before);
    expect(readRecipients(dir)).toEqual([key1.publicKey]);
  });
});
