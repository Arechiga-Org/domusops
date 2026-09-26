import { DETAIL_LEVELS } from "@domusops/schema";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errors, SnapshotError } from "./errors.js";
import type { Timeouts } from "./ha/client.js";
import { runSnapshot } from "./tools/ha-snapshot.js";

// Copied from specs/001-ha-snapshot/contracts/ha_snapshot.tool.json, the tool contract.
const DETAIL_DESCRIPTION =
  "summary: counts and topology only. standard: compressed full inventory. full: every field, including those standard omits (escape hatch; larger).";
const TITLE = "Inventory snapshot for Home Assistant";
const DESCRIPTION =
  "Read-only inventory of the connected Home Assistant instance: every entity (with current state and attributes), device, area, integration and config entry, plus the core version. Returned as compact JSON in the domusops.snapshot/0.1 format. detail=summary gives counts and topology only; standard (default) is grouped, templated and at least 5x smaller than the raw registries on a 500-entity reference instance (asserted in CI); full keeps every field, including those standard omits, in the same lossless encoding. Secrets and coordinates are always redacted. Every response reports its compression_ratio. Requires DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN (administrator user).";

export interface ServerOptions {
  /** Environment the tool reads its configuration from on every call. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  timeouts?: Partial<Timeouts>;
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "domusops-mcp", version: "0.0.0" });

  server.registerTool(
    "ha_snapshot",
    {
      title: TITLE,
      description: DESCRIPTION,
      inputSchema: { detail: z.enum(DETAIL_LEVELS).default("standard").describe(DETAIL_DESCRIPTION) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ detail }) => {
      try {
        const text = await runSnapshot(options.env ?? process.env, {
          detail,
          ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        // Domain failures are tool results, so the agent always sees the remediation text.
        const failure =
          error instanceof SnapshotError
            ? error
            : errors.protocolError(error instanceof Error ? error.message : "unknown error");
        return { isError: true, content: [{ type: "text" as const, text: failure.toToolText() }] };
      }
    },
  );

  return server;
}
