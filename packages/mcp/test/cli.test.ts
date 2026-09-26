import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

interface Reply {
  id?: number;
  result?: {
    tools?: { name: string; annotations?: Record<string, unknown> }[];
  };
}

/** Starts the built server, sends the given messages, and collects stdout until `id` 2 answers. */
function converse(
  messages: unknown[],
): Promise<{ lines: string[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env["DOMUSOPS_HA_URL"];
    delete env["DOMUSOPS_HA_TOKEN"];
    const child = spawn(process.execPath, [cli], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no reply within 10 s; stdout so far: ${out}`));
    }, 10_000);
    child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
    child.stdout.on("data", (chunk: Buffer) => {
      out += String(chunk);
      const lines = out.split("\n").filter((l) => l.trim() !== "");
      if (lines.some((l) => (JSON.parse(l) as Reply).id === 2)) {
        clearTimeout(timer);
        child.kill();
        resolve({ lines, stderr });
      }
    });
    child.on("error", reject);
    for (const message of messages)
      child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

describe("the built server over stdio", () => {
  it("starts with only Node and advertises exactly ha_snapshot", async () => {
    if (!existsSync(cli))
      throw new Error(
        "packages/mcp/dist is missing: run `pnpm typecheck` first",
      );
    const { lines, stderr } = await converse([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "cli-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    // Stdout carries protocol traffic only: every line is a JSON-RPC message.
    for (const line of lines)
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    const listing = lines
      .map((l) => JSON.parse(l) as Reply)
      .find((r) => r.id === 2);
    const tools = listing?.result?.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(["ha_snapshot"]);
    expect(tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(stderr).not.toMatch(/token/i);
  });
});
