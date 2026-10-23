import { packageVersion } from "../src/cli-support.js";
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
import { writeRecord } from "../src/baseline/record.js";
import { sha256 } from "../src/baseline/templates.js";
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
    writeSopsConfig(dir, [publicKey], packageVersion());
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
    writeSopsConfig(dir, [publicKey], packageVersion());

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
    writeSopsConfig(dir, [recipient.publicKey], packageVersion());
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
    writeSopsConfig(dir, [recipient.publicKey], packageVersion());
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-7\n");

    expect(encryptWithRoundtrip(dir).ok).toBe(false);
    expect(existsSync(join(dir, "secrets.sops.yaml"))).toBe(false);
  });

  it("decrypt writes secrets.yaml at mode 0600", () => {
    saveEnv();
    const { keyFile, publicKey } = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [publicKey], packageVersion());
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
    writeSopsConfig(dir, [key1.publicKey], packageVersion());
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
    writeSopsConfig(dir, [key1.publicKey], packageVersion());
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
    writeSopsConfig(dir, [key1.publicKey, key2.publicKey], packageVersion());
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
    writeSopsConfig(dir, [key1.publicKey], packageVersion());
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

describe("secrets add-key / remove-key on a .sops.yaml edited by hand (FR-021)", () => {
  const REFUSAL =
    ".sops.yaml was changed outside DomusOps, so it is left as it is. To change its recipients, edit the `age` list in .sops.yaml by hand, then run: sops updatekeys secrets.sops.yaml";

  /** A configuration with two recipients, a record, and a `.sops.yaml` that has been edited. */
  function editedFixture(): {
    dir: string;
    key1: ReturnType<typeof makeThrowawayAgeKey>;
    key2: ReturnType<typeof makeThrowawayAgeKey>;
    files: () => Record<string, string>;
  } {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey, key2.publicKey], packageVersion());
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-9\n");
    encryptWithRoundtrip(dir);
    // The record says what init wrote.
    const content = readFileSync(join(dir, ".sops.yaml"), "utf8");
    writeRecord(dir, {
      format: "domusops.bootstrap/0.1",
      release: packageVersion(),
      elements: {
        "sops-config": {
          path: ".sops.yaml",
          sha256: sha256(content),
          release: packageVersion(),
        },
      },
    });
    // The user then adds a rule of their own.
    writeFileSync(
      join(dir, ".sops.yaml"),
      `${content}  - path_regex: (^|/)extra\\.sops\\.yaml$\n    age: ${key1.publicKey}\n`,
    );
    const files = (): Record<string, string> => ({
      sops: readFileSync(join(dir, ".sops.yaml"), "utf8"),
      encrypted: readFileSync(join(dir, "secrets.sops.yaml"), "utf8"),
      record: readFileSync(join(dir, ".domusops", "generated.json"), "utf8"),
    });
    return { dir, key1, key2, files };
  }

  function captureError(run: () => number): { code: number; stderr: string } {
    const lines: string[] = [];
    const original = console.error;
    console.error = (message: string) => lines.push(message);
    try {
      return { code: run(), stderr: lines.join("\n") };
    } finally {
      console.error = original;
    }
  }

  it("add-key refuses, says why, and changes nothing", () => {
    const { dir, key1, files } = editedFixture();
    const stranger = makeThrowawayAgeKey();
    const before = files();
    const result = captureError(() =>
      runSecrets("add-key", [stranger.publicKey], args(dir)),
    );
    expect(result.code).toBe(EXIT_PROBLEMS);
    expect(result.stderr).toBe(REFUSAL);
    expect(files()).toEqual(before);
    expect(readRecipients(dir)).toContain(key1.publicKey);
  });

  it("remove-key refuses, says why, and changes nothing", () => {
    const { dir, key2, files } = editedFixture();
    const before = files();
    const result = captureError(() =>
      runSecrets("remove-key", [key2.publicKey], args(dir)),
    );
    expect(result.code).toBe(EXIT_PROBLEMS);
    expect(result.stderr).toBe(REFUSAL);
    expect(files()).toEqual(before);
  });

  it("proceeds on an unedited file whose record is from an earlier release", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey], "0.0.1");
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-10\n");
    encryptWithRoundtrip(dir);
    writeRecord(dir, {
      format: "domusops.bootstrap/0.1",
      release: "0.0.1",
      elements: {
        "sops-config": {
          path: ".sops.yaml",
          sha256: sha256(readFileSync(join(dir, ".sops.yaml"), "utf8")),
          release: "0.0.1",
        },
      },
    });
    expect(runSecrets("add-key", [key2.publicKey], args(dir))).toBe(EXIT_OK);
    expect(readRecipients(dir)).toEqual([key1.publicKey, key2.publicKey]);
  });

  it("proceeds with no record when the file is what DomusOps would write", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey], packageVersion());
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-11\n");
    encryptWithRoundtrip(dir);
    expect(runSecrets("add-key", [key2.publicKey], args(dir))).toBe(EXIT_OK);
  });

  it("refuses with no record when the file differs from what DomusOps would write", () => {
    saveEnv();
    const key1 = makeThrowawayAgeKey();
    const key2 = makeThrowawayAgeKey();
    process.env["SOPS_AGE_KEY_FILE"] = key1.keyFile;
    const dir = fixtureDir();
    writeSopsConfig(dir, [key1.publicKey], packageVersion());
    writeFileSync(join(dir, "secrets.yaml"), "wifi_password: fake-value-12\n");
    encryptWithRoundtrip(dir);
    const before = readFileSync(join(dir, ".sops.yaml"), "utf8");
    writeFileSync(join(dir, ".sops.yaml"), `# mine\n${before}`);
    const result = captureError(() =>
      runSecrets("add-key", [key2.publicKey], args(dir)),
    );
    expect(result.code).toBe(EXIT_PROBLEMS);
    expect(result.stderr).toBe(REFUSAL);
    expect(readRecipients(dir)).toEqual([key1.publicKey]);
  });
});
