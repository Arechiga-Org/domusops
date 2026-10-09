import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HaSocket } from "../src/ha/ws.js";
import { startSandbox } from "../src/index.js";
import { CHANNELS, startTarget } from "./support/channels.js";

const MINUTE = 60_000;
const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));
const MCP_ENTRY = fileURLToPath(
  new URL("../../mcp/dist/cli.js", import.meta.url),
);

interface Reply {
  id?: number;
  result?: { content?: { type: string; text: string }[]; isError?: boolean };
  error?: { message: string };
}

/** Speaks the MCP stdio protocol (one JSON message per line) with the built server. */
async function withMcp<T>(
  env: Record<string, string>,
  body: (call: (name: string, args: object) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const child = spawn(process.execPath, [MCP_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const waiting = new Map<number, (reply: Reply) => void>();
  let buffered = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end < 0) break;
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line === "") continue;
      const reply = JSON.parse(line) as Reply;
      if (reply.id !== undefined) waiting.get(reply.id)?.(reply);
    }
  });
  const exited = new Promise<never>((_resolve, reject) => {
    child.on("exit", (code) =>
      reject(new Error(`MCP server exited (${String(code)}): ${stderr}`)),
    );
  });
  exited.catch(() => undefined);
  let next = 0;
  const request = (method: string, params: object): Promise<Reply> => {
    const id = ++next;
    const answer = new Promise<Reply>((resolve) => waiting.set(id, resolve));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return Promise.race([answer, exited]);
  };
  try {
    await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "sandbox-test", version: "0.0.0" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    return await body(async (name, args) => {
      const reply = await request("tools/call", { name, arguments: args });
      expect(reply.error).toBeUndefined();
      const text = reply.result?.content?.[0]?.text ?? "";
      expect(reply.result?.isError, text).not.toBe(true);
      return JSON.parse(text) as unknown;
    });
  } finally {
    child.kill();
  }
}

describe.each(CHANNELS)("existing tools against %s", (channel) => {
  it(
    "serves @domusops/mcp and a WebSocket client with the sandbox's own connection (SC-005)",
    async () => {
      expect(existsSync(MCP_ENTRY), "run pnpm build first").toBe(true);
      const sandbox = await startSandbox({
        ...startTarget(channel),
        devices: [{ kind: "light", name: "Hall" }],
      });
      const { url, wsUrl, token } = sandbox.connection();
      try {
        const env = sandbox.mcpEnv();
        expect(Object.keys(env).sort()).toEqual([
          "DOMUSOPS_HA_TOKEN",
          "DOMUSOPS_HA_URL",
        ]);

        const snapshot = (await withMcp({ ...env }, (call) =>
          call("ha_snapshot", { detail: "full" }),
        )) as { format?: string };
        expect(snapshot.format).toBe("domusops.snapshot/0.1");
        expect(JSON.stringify(snapshot)).toContain("light.hall");

        const socket = await HaSocket.connect(wsUrl, token);
        try {
          const states = await socket.command<{ entity_id: string }[]>({
            type: "get_states",
          });
          expect(states.map((s) => s.entity_id)).toContain("light.hall");
        } finally {
          socket.close();
        }
      } finally {
        await sandbox.stop();
      }

      await expect(
        fetch(`${url}/api/config`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        }),
      ).rejects.toThrow();
      await expect(HaSocket.connect(wsUrl, token)).rejects.toThrow();
    },
    8 * MINUTE,
  );
});

describe("the existing tools are used as they are", () => {
  it("leaves packages/mcp untouched", () => {
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: REPOSITORY, encoding: "utf8" });
    try {
      git("rev-parse", "--verify", "--quiet", "main");
    } catch {
      return; // no local main to compare with, as in a shallow CI checkout
    }
    expect(git("diff", "--stat", "main", "--", "packages/mcp")).toBe("");
  });
});
