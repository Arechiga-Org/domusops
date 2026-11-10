import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

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
