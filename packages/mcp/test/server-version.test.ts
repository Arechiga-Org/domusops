import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, readVersion } from "../src/server.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("the version the server reports (spec FR-001, FR-002, SC-001)", () => {
  it("is the installed package's version, not a hard-coded one", async () => {
    const server = createServer({ env: {} });
    const client = new Client({ name: "server-version-test", version: "0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      expect(client.getServerVersion()).toEqual({
        name: "domusops-mcp",
        version: pkg.version,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("a package.json the server cannot take a version from (research R1)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0)
      rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  /** Writes `content` to a fresh package.json, or only names one when `content` is undefined. */
  function packageFile(content?: string): { file: URL; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "domusops-mcp-version-"));
    dirs.push(dir);
    const path = join(dir, "package.json");
    if (content !== undefined) writeFileSync(path, content);
    return { file: pathToFileURL(path), path };
  }

  it("reads the version when there is one", () => {
    const { file } = packageFile(JSON.stringify({ version: "9.8.7" }));
    expect(readVersion(file)).toBe("9.8.7");
  });

  it("refuses a missing file and names it", () => {
    const { file, path } = packageFile();
    expect(() => readVersion(file)).toThrow(`cannot read ${path}`);
  });

  it("refuses a file that is not valid JSON and names it", () => {
    const { file, path } = packageFile('{"version": "0.1');
    expect(() => readVersion(file)).toThrow(`${path} is not valid JSON`);
  });

  it.each([
    ["no version", "{}"],
    ["an empty version", JSON.stringify({ version: "" })],
    ["a version that is not a string", JSON.stringify({ version: 1 })],
    ["a document that is not an object", "null"],
  ])("refuses %s and names the file, with no fallback", (_, content) => {
    const { file, path } = packageFile(content);
    expect(() => readVersion(file)).toThrow(`${path} has no version`);
  });
});
