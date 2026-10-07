import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Research R16: `SKILL.md` pins `npx @domusops/bootstrap@~<major.minor>`. This test fails a minor
 * version bump until the skill is updated to match, so the two never silently drift apart.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILL_PATH = fileURLToPath(
  new URL("../../../skills/ha-bootstrap/SKILL.md", import.meta.url),
);

describe("SKILL.md version pin (research R16)", () => {
  it("matches @domusops/bootstrap's own major.minor version", () => {
    const pkg = JSON.parse(
      readFileSync(`${PACKAGE_ROOT}/package.json`, "utf8"),
    ) as {
      version: string;
    };
    const [major, minor] = pkg.version.split(".");
    const expectedRange = `@domusops/bootstrap@~${major}.${minor}`;

    const skill = readFileSync(SKILL_PATH, "utf8");
    const pins = [...skill.matchAll(/@domusops\/bootstrap@~(\d+\.\d+)/g)].map(
      (m) => m[1],
    );
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      expect(`@domusops/bootstrap@~${pin}`).toBe(expectedRange);
    }
  });
});
