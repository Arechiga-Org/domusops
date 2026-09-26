#!/usr/bin/env node
/**
 * @domusops/mcp entrypoint: serves the MCP tools over stdio. Stdout carries protocol traffic only;
 * diagnostics go to stderr and never include the access token.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[domusops-mcp] failed to start: ${message}`);
  process.exit(1);
});
