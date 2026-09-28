import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReference } from "./fixtures/build-reference.mjs";
import { makeTempDir, makeThrowawayAgeKey } from "./support/tmp.js";
import { encryptWithRoundtrip } from "../src/baseline/secrets.js";
import { writeSopsConfig } from "../src/baseline/sops-config.js";
import { runValidate } from "../src/commands/validate.js";
import { EXIT_OK, EXIT_PROBLEMS } from "../src/exit-codes.js";
import type { CliArgs } from "../src/cli-args.js";

/**
 * Runs the real `check_config` in a real container, against the real, pinned instance image
 * (research R9, quickstart scenarios 7-8; SC-004, SC-007). Excluded from the default `pnpm test`
 * (vitest.config.ts); run explicitly with `pnpm --filter @domusops/bootstrap
 * test:bootstrap:container`, and by the `bootstrap-validate` CI job (T048). Needs Docker or
 * Podman on PATH and a network pull of the image the first time.
 */
const PINNED_INSTANCE_VERSION = "2026.9.3";

const cleanups: (() => void)[] = [];
const savedEnv: Record<string, string | undefined> = {
  SOPS_AGE_KEY_FILE: process.env["SOPS_AGE_KEY_FILE"],
};
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function bootstrappedFixture(
  options: Parameters<typeof buildReference>[1] = {},
): string {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  // validate copies git's view of the directory (tracked + untracked-not-ignored, research R9),
  // so the fixture needs to at least be a repository for anything to reach the container.
  buildReference(dir, { alreadyRepo: true, ...options });
  const { keyFile, publicKey } = makeThrowawayAgeKey();
  process.env["SOPS_AGE_KEY_FILE"] = keyFile;
  writeSopsConfig(dir, [publicKey]);
  encryptWithRoundtrip(dir);
  mkdirSync(join(dir, ".domusops"), { recursive: true });
  writeFileSync(
    join(dir, ".domusops", "instance-version"),
    `${PINNED_INSTANCE_VERSION}\n`,
  );
  return dir;
}

function args(dir: string): CliArgs {
  return {
    dir,
    json: false,
    apply: false,
    force: false,
    ci: false,
    staged: false,
    all: false,
    instanceVersion: undefined,
  };
}

describe("validate against a real container runtime and the pinned instance image", () => {
  it("passes on the reference fixture, reporting the custom integration as a warning (SC-004)", () => {
    const dir = bootstrappedFixture();
    const code = runValidate(args(dir));
    expect(code).toBe(EXIT_OK);
  }, 120_000);

  it("fails with the validator's own message on an injected configuration error (SC-007)", () => {
    const dir = bootstrappedFixture({ configError: true });
    const logs: string[] = [];
    const original = console.error;
    console.error = (msg: string) => logs.push(msg);
    let code: number;
    try {
      code = runValidate(args(dir));
    } finally {
      console.error = original;
    }
    expect(code).toBe(EXIT_PROBLEMS);
    expect(logs.join("\n")).toContain("this_key_does_not_exist");
  }, 120_000);
});
