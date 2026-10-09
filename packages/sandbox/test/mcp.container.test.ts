import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HaSocket } from "../src/ha/ws.js";
import { startSandbox } from "../src/index.js";
import { CHANNELS, startTarget } from "./support/channels.js";

const MINUTE = 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
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
  // Settings of the machine running the test must not change what the server answers.
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("DOMUSOPS_")),
  );
  const child = spawn(process.execPath, [MCP_ENTRY], {
    env: { ...clean, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const waiting = new Map<number, (reply: Reply) => void>();
  let failed: (error: Error) => void = () => undefined;
  const exited = new Promise<never>((_resolve, reject) => {
    failed = reject;
    child.on("close", (code) =>
      reject(new Error(`MCP server exited (${String(code)}): ${stderr}`)),
    );
  });
  exited.catch(() => undefined);
  let buffered = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end < 0) break;
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line === "") continue;
      let reply: Reply;
      try {
        reply = JSON.parse(line) as Reply;
      } catch {
        failed(new Error(`MCP server wrote a line that is not JSON: ${line}`));
        return;
      }
      const isResponse =
        reply.result !== undefined || reply.error !== undefined;
      if (reply.id !== undefined && isResponse) waiting.get(reply.id)?.(reply);
    }
  });
  child.stdin.on("error", () => undefined);
  let next = 0;
  const request = (method: string, params: object): Promise<Reply> => {
    const id = ++next;
    const answer = new Promise<Reply>((resolve) => waiting.set(id, resolve));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`MCP ${method} got no answer in 60 s: ${stderr}`)),
        REQUEST_TIMEOUT_MS,
      );
    });
    return Promise.race([answer, exited, timeout]).finally(() => {
      clearTimeout(timer);
      waiting.delete(id);
    });
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
      let connection: ReturnType<typeof sandbox.connection> | undefined;
      try {
        connection = sandbox.connection();
        const { wsUrl, token } = connection;
        const env = sandbox.mcpEnv();
        expect(Object.keys(env).sort()).toEqual([
          "DOMUSOPS_HA_TOKEN",
          "DOMUSOPS_HA_URL",
        ]);

        const snapshot = (await withMcp({ ...env }, (call) =>
          call("ha_snapshot", { detail: "summary" }),
        )) as {
          format?: string;
          by_domain?: Record<string, number>;
          by_integration?: Record<string, { entities: number }>;
        };
        expect(snapshot.format).toBe("domusops.snapshot/0.1");
        expect(snapshot.by_domain?.["light"]).toBeGreaterThanOrEqual(1);
        expect(snapshot.by_integration?.["virtual"]?.entities).toBe(1);

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
      expect(() => sandbox.mcpEnv()).toThrow(/stopped/);

      // Another instance may have been given the freed port, and it would refuse the token.
      const { url, wsUrl, token } = connection;
      const status = await fetch(`${url}/api/config`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      }).then(
        (response) => response.status,
        () => "refused",
      );
      // Refused: nothing is listening. 401: the freed port went to another instance.
      expect(["refused", 401]).toContain(status);
      await expect(HaSocket.connect(wsUrl, token)).rejects.toThrow();
    },
    8 * MINUTE,
  );
});
