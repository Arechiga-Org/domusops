import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, posix } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What each package puts on the registry (specs/007-debt-paydown FR-010, FR-011, FR-012): a README,
 * the sources the source maps point at, no tests, and no map that references a file the package
 * does not contain. It packs without publishing and needs no network; the `dist/` it reads is built
 * by `pnpm typecheck`, which the gate runs before the tests. A `dist/` left over from another
 * branch can hold maps of sources that no longer exist; delete it and build again.
 */
// The repository root; vitest runs from it, and this file sits two levels below it.
const root = join(__dirname, "..", "..");
const packagesDir = join(root, "packages");
const names = readdirSync(packagesDir).filter((name) =>
  existsSync(join(packagesDir, name, "package.json")),
);

interface Packed {
  files: string[];
}

function pack(name: string): Packed {
  const cwd = join(packagesDir, name);
  if (!existsSync(join(cwd, "dist"))) {
    throw new Error(
      `packages/${name} has no dist/: run pnpm typecheck first (it builds dist/)`,
    );
  }
  const out = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const [entry] = JSON.parse(out) as { files: { path: string }[] }[];
  if (entry === undefined)
    throw new Error(`npm pack listed nothing for ${name}`);
  return { files: entry.files.map((file) => file.path) };
}

describe("what each package publishes", () => {
  it("covers the four packages", () => {
    expect(names.sort()).toEqual(["bootstrap", "mcp", "sandbox", "schema"]);
  });

  describe.each(names)("%s", (name) => {
    const { files } = pack(name);
    const listed = new Set(files);

    it("ships a README", () => {
      expect(listed.has("README.md")).toBe(true);
    });

    it("ships its sources and none of its tests", () => {
      expect(files.some((file) => file.startsWith("src/"))).toBe(true);
      expect(files.filter((file) => /^(test|tests)\//.test(file))).toEqual([]);
    });

    it("has every source its source maps reference inside the package", () => {
      const maps = files.filter((file) => file.endsWith(".map"));
      expect(maps.length).toBeGreaterThan(0);
      const missing: string[] = [];
      for (const map of maps) {
        const parsed = JSON.parse(
          readFileSync(join(packagesDir, name, map), "utf8"),
        ) as { sources?: string[]; sourcesContent?: unknown[] };
        parsed.sources?.forEach((source, at) => {
          // A source embedded in the map needs no file.
          if (typeof parsed.sourcesContent?.[at] === "string") return;
          const target = normalize(posix.join(posix.dirname(map), source));
          if (!listed.has(target)) missing.push(`${map} -> ${target}`);
        });
      }
      expect(missing).toEqual([]);
    });
  });
});
