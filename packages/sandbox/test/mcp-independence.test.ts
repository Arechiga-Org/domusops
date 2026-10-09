import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MCP = fileURLToPath(new URL("../../mcp", import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

describe("the existing tools are used as they are", () => {
  it("needs nothing from the sandbox in @domusops/mcp", () => {
    const files = [join(MCP, "package.json"), ...sources(join(MCP, "src"))];
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /domusops[/-]sandbox/,
      );
    }
  });
});
