import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReference } from "./fixtures/build-reference.mjs";
import { makeTempDir } from "./support/tmp.js";
import {
  applyPackagesLoading,
  computePackagesLoading,
} from "../src/baseline/packages.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function fixture(
  packagesForm: "absent" | "block" | "declared" | "flow-map" | "include-tag",
) {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  buildReference(dir, { packagesForm });
  return dir;
}

// The bytes of configuration.yaml outside the homeassistant: block, unaffected by any branch
// (SC-008): a stable marker present in every variant the fixture builder writes.
const STABLE_MARKER = "automation: !include automations.yaml";

describe("packages-loading (research R5)", () => {
  it("branch 1: no homeassistant key — appends both lines at the end", () => {
    const dir = fixture("absent");
    const before = readFileSync(join(dir, "configuration.yaml"), "utf8");
    expect(computePackagesLoading(dir).state).toBe("missing");
    const result = applyPackagesLoading(dir);
    expect(result.state).toBe("missing");
    const after = readFileSync(join(dir, "configuration.yaml"), "utf8");
    expect(after).toContain(
      "homeassistant:\n  packages: !include_dir_named packages",
    );
    expect(after.startsWith(before)).toBe(true);
  });

  it("branch 2: a block mapping without packages — inserts as the first child", () => {
    const dir = fixture("block");
    expect(computePackagesLoading(dir).state).toBe("missing");
    const result = applyPackagesLoading(dir);
    expect(result.state).toBe("missing");
    const after = readFileSync(join(dir, "configuration.yaml"), "utf8");
    const haIndex = after.indexOf("homeassistant:");
    const packagesIndex = after.indexOf(
      "packages: !include_dir_named packages",
    );
    const nameIndex = after.indexOf("name: Home");
    expect(haIndex).toBeGreaterThanOrEqual(0);
    expect(packagesIndex).toBeGreaterThan(haIndex);
    expect(packagesIndex).toBeLessThan(nameIndex);
  });

  it("branch 3: any existing packages key — leaves it and reports the declared form", () => {
    const dir = fixture("declared");
    const before = readFileSync(join(dir, "configuration.yaml"), "utf8");
    const result = applyPackagesLoading(dir);
    expect(result.state).toBe("current");
    expect(result.reason).toContain("!include_dir_merge_named packages");
    const after = readFileSync(join(dir, "configuration.yaml"), "utf8");
    expect(after).toBe(before);
  });

  it("branch 4a: a flow mapping — leaves it, stops with packages_elsewhere", () => {
    const dir = fixture("flow-map");
    const before = readFileSync(join(dir, "configuration.yaml"), "utf8");
    const result = applyPackagesLoading(dir);
    expect(result.state).toBe("blocked");
    expect(result.stop?.reason).toBe("packages_elsewhere");
    const after = readFileSync(join(dir, "configuration.yaml"), "utf8");
    expect(after).toBe(before);
  });

  it("branch 4b: an !include tag — leaves it, stops with packages_elsewhere", () => {
    const dir = fixture("include-tag");
    const before = readFileSync(join(dir, "configuration.yaml"), "utf8");
    const result = applyPackagesLoading(dir);
    expect(result.state).toBe("blocked");
    expect(result.stop?.reason).toBe("packages_elsewhere");
    const after = readFileSync(join(dir, "configuration.yaml"), "utf8");
    expect(after).toBe(before);
  });

  it("SC-008: every other byte of configuration.yaml is unchanged, in every branch", () => {
    for (const form of [
      "absent",
      "block",
      "declared",
      "flow-map",
      "include-tag",
    ] as const) {
      const dir = fixture(form);
      applyPackagesLoading(dir);
      const after = readFileSync(join(dir, "configuration.yaml"), "utf8");
      expect(after).toContain(STABLE_MARKER);
    }
  });
});
