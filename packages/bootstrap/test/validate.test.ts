import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  makeTempDir,
  makeThrowawayAgeKey,
  withoutOnPath,
} from "./support/tmp.js";
import { buildReference } from "./fixtures/build-reference.mjs";
import { encryptWithRoundtrip } from "../src/baseline/secrets.js";
import { writeSopsConfig } from "../src/baseline/sops-config.js";
import {
  buildPlaceholderSecrets,
  runValidate,
} from "../src/commands/validate.js";
import { EXIT_OK, EXIT_STOPPED } from "../src/exit-codes.js";
import type { CliArgs } from "../src/cli-args.js";

const cleanups: (() => void)[] = [];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ["PATH", "DOMUSOPS_CONTAINER", "SOPS_AGE_KEY_FILE"])
  savedEnv[k] = process.env[k];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

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

/**
 * Installs a fake "docker" on PATH that never runs a container: it finds the `-v host:/config`
 * mount, writes /config/secrets.yaml's content to `capturePath` (so the test can assert on the
 * exact placeholders `validate` generated), and prints `responseJson` to stdout.
 */
function fakeDocker(capturePath: string, responseJson: unknown): void {
  const { dir, cleanup } = makeTempDir("domusops-bootstrap-fakebin-");
  cleanups.push(cleanup);
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const mountArg = args.find((a) => a.includes(":/config"));
const hostDir = mountArg.split(":/config")[0];
const secrets = fs.readFileSync(hostDir + "/secrets.yaml", "utf8");
fs.writeFileSync(${JSON.stringify(capturePath)}, secrets);
process.stdout.write(${JSON.stringify(JSON.stringify(responseJson))});
`;
  const binPath = join(dir, "docker");
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);
  process.env["PATH"] = `${dir}:${process.env["PATH"] ?? ""}`;
  process.env["DOMUSOPS_CONTAINER"] = "docker";
}

function fixtureWithSecrets(): string {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  buildReference(dir);
  const { keyFile, publicKey } = makeThrowawayAgeKey();
  process.env["SOPS_AGE_KEY_FILE"] = keyFile;
  writeSopsConfig(dir, [publicKey]);
  writeFileSync(
    join(dir, "secrets.yaml"),
    "wifi_password: fake-1\nport_number: 1883\nis_enabled: true\nratio_value: 1.5\n",
  );
  encryptWithRoundtrip(dir);
  mkdirSync(join(dir, ".domusops"), { recursive: true });
  writeFileSync(join(dir, ".domusops", "instance-version"), "2026.9.3\n");
  return dir;
}

describe("buildPlaceholderSecrets (research R7)", () => {
  it("types each placeholder from SOPS's own type tag", () => {
    const dir = fixtureWithSecrets();
    const placeholders = buildPlaceholderSecrets(dir);
    expect(placeholders["wifi_password"]).toBe("domusops-placeholder");
    expect(placeholders["port_number"]).toBe(8080);
    expect(placeholders["is_enabled"]).toBe(false);
    expect(placeholders["ratio_value"]).toBe(0.0);
  });

  it("applies an override from .domusops/placeholders.yaml", () => {
    const dir = fixtureWithSecrets();
    writeFileSync(
      join(dir, ".domusops", "placeholders.yaml"),
      "wifi_password: my-custom-placeholder\n",
    );
    const placeholders = buildPlaceholderSecrets(dir);
    expect(placeholders["wifi_password"]).toBe("my-custom-placeholder");
  });

  it("rejects a malformed placeholders.yaml", () => {
    const dir = fixtureWithSecrets();
    writeFileSync(
      join(dir, ".domusops", "placeholders.yaml"),
      "- just\n- a\n- list\n",
    );
    expect(() => buildPlaceholderSecrets(dir)).toThrow(/placeholders\.yaml/);
  });
});

describe("validate (mocked container runtime)", () => {
  it("passes typed placeholders to the container and exits 0 on a clean result", () => {
    const dir = fixtureWithSecrets();
    const { dir: captureDir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const capturePath = join(captureDir, "captured-secrets.yaml");
    fakeDocker(capturePath, {
      total_errors: 0,
      total_warnings: 0,
      errors: {},
      warnings: {},
      components: [],
    });
    const code = runValidate(args(dir));
    expect(code).toBe(EXIT_OK);
    expect(existsSync(capturePath)).toBe(true);
    const captured = readFileSync(capturePath, "utf8");
    expect(captured).toContain("port_number: 8080");
    expect(captured).toContain("is_enabled: false");
  });

  it("exits with a problem code and prints the validator's own error message", () => {
    const dir = fixtureWithSecrets();
    const { dir: captureDir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    fakeDocker(join(captureDir, "capture.yaml"), {
      total_errors: 1,
      total_warnings: 0,
      errors: { frontend: ["Invalid config for 'frontend'"] },
      warnings: {},
      components: [],
    });
    const logs: string[] = [];
    const original = console.error;
    console.error = (msg: string) => logs.push(msg);
    let code: number;
    try {
      code = runValidate(args(dir));
    } finally {
      console.error = original;
    }
    expect(code).not.toBe(EXIT_OK);
    expect(logs.join("\n")).toContain("Invalid config for 'frontend'");
  });

  it("stops with no container runtime available, git still on PATH", () => {
    const dir = fixtureWithSecrets();
    delete process.env["DOMUSOPS_CONTAINER"];
    const code = withoutOnPath(["docker", "podman"], () =>
      runValidate(args(dir)),
    );
    expect(code).toBe(EXIT_STOPPED);
  });
});
