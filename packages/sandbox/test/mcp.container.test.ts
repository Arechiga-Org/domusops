import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** A successful tool result: the parsed document, then the notes that follow it. */
interface ToolResult {
  document: unknown;
  notes: string[];
}

/** Speaks the MCP stdio protocol (one JSON message per line) with the built server. */
async function withMcp<T>(
  env: Record<string, string>,
  body: (
    call: (name: string, args: object) => Promise<ToolResult>,
  ) => Promise<T>,
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
      const [text = "", ...notes] = (reply.result?.content ?? []).map(
        (block) => block.text,
      );
      expect(reply.result?.isError, text).not.toBe(true);
      return { document: JSON.parse(text) as unknown, notes };
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

        const snapshot = (
          await withMcp({ ...env }, (call) =>
            call("ha_snapshot", { detail: "summary" }),
          )
        ).document as {
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

const PROBE = "automation.discard_probe";

/** An automation that keeps 2 runs and runs on demand (specs/008-mcp-reliability US4). */
function probeConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "domusops-discard-"));
  writeFileSync(
    join(dir, "configuration.yaml"),
    "default_config:\nautomation: !include automations.yaml\n",
  );
  writeFileSync(
    join(dir, "automations.yaml"),
    [
      '- id: "domusops_discard_probe"',
      "  alias: Discard probe",
      "  trace:",
      "    stored_traces: 2",
      "  triggers:",
      "    - trigger: event",
      "      event_type: domusops_discard_probe",
      "  actions:",
      "    - event: domusops_discard_probe_ran",
      "",
    ].join("\n"),
  );
  return dir;
}

describe.each(CHANNELS)(
  "ha_trace's discarded-runs note against %s",
  (channel) => {
    it(
      "names an automation that replaced runs from the window, and not once it is excluded",
      async () => {
        expect(existsSync(MCP_ENTRY), "run pnpm build first").toBe(true);
        const dir = probeConfig();
        const sandbox = await startSandbox({
          ...startTarget(channel),
          config: { dir },
        });
        try {
          const { wsUrl, token } = sandbox.connection();
          const start = new Date(Date.now() - MINUTE).toISOString();
          const socket = await HaSocket.connect(wsUrl, token);
          try {
            // Three runs, one at a time: the instance keeps the last 2.
            const seen = new Set<string>();
            for (let run = 0; run < 3; run++) {
              await socket.command({
                type: "call_service",
                domain: "automation",
                service: "trigger",
                target: { entity_id: PROBE },
              });
              const limit = Date.now() + MINUTE;
              for (;;) {
                const stored = await socket.command<
                  { run_id: string; state: string }[]
                >({ type: "trace/list", domain: "automation" });
                const fresh = stored.find(
                  (t) => !seen.has(t.run_id) && t.state === "stopped",
                );
                if (fresh !== undefined) {
                  seen.add(fresh.run_id);
                  break;
                }
                if (Date.now() > limit)
                  throw new Error("the probe did not run");
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
            }
          } finally {
            socket.close();
          }

          const [windowed, excluded] = await withMcp(
            { ...sandbox.mcpEnv() },
            async (call) => [
              await call("ha_trace", { start }),
              await call("ha_trace", { start, exclude: [PROBE] }),
            ],
          );
          expect(
            (windowed.document as { counts: { runs: number } }).counts.runs,
          ).toBe(2);
          expect(windowed.notes).toHaveLength(1);
          expect(windowed.notes[0]).toContain(`${PROBE} (keeps 2)`);
          expect(excluded.notes).toEqual([
            `Note: excluded ${PROBE}. Counts, the size check and compression_ratio leave them out.`,
          ]);
        } finally {
          await sandbox.stop();
          rmSync(dir, { recursive: true, force: true });
        }
      },
      8 * MINUTE,
    );
  },
);

describe.each(CHANNELS)("ha_ping against %s", (channel) => {
  it(
    "reports a default instance as supported, with every tool ready (SC-005, §8)",
    async () => {
      expect(existsSync(MCP_ENTRY), "run pnpm build first").toBe(true);
      const sandbox = await startSandbox({ ...startTarget(channel) });
      try {
        const [first, second] = await withMcp(
          { ...sandbox.mcpEnv() },
          async (call) => [
            await call("ha_ping", {}),
            await call("ha_ping", {}),
          ],
        );
        const document = first?.document as {
          format: string;
          instance: {
            version: string;
            supported: boolean;
            time_zone: string;
          };
          admin: boolean;
          integrations: Record<string, boolean>;
          tools: Record<string, { ready: boolean; reasons?: string[] }>;
          next_steps?: string[];
          compression_ratio: number;
        };
        expect(document.format).toBe("domusops.ping/0.1");
        expect(document.instance.supported).toBe(true);
        expect(document.instance.version).toMatch(/^\d{4}\.\d+\.\d+/);
        expect(document.instance.time_zone).not.toBe("");
        expect(document.admin).toBe(true);
        expect(document.integrations).toEqual({
          history: true,
          logbook: true,
          trace: true,
        });
        expect(document.tools).toEqual({
          ha_snapshot: { ready: true },
          ha_logbook_query: { ready: true },
          ha_trace: { ready: true },
          ha_state: { ready: true },
          ha_history: { ready: true },
        });
        expect(document.next_steps).toBeUndefined();
        expect(document.compression_ratio).toBeGreaterThanOrEqual(3);
        expect(first?.notes).toEqual([]);
        // The same instance gives the same document.
        expect(second?.document).toEqual(document);
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );
});

describe.each(CHANNELS)("ha_state against %s", (channel) => {
  it(
    "reads zone.home redacted, and a summary that counts what standard lists (SC-007, §8)",
    async () => {
      expect(existsSync(MCP_ENTRY), "run pnpm build first").toBe(true);
      const sandbox = await startSandbox({ ...startTarget(channel) });
      try {
        const [home, again, full, zones, summary] = await withMcp(
          { ...sandbox.mcpEnv() },
          async (call) => [
            await call("ha_state", { entities: ["zone.home"] }),
            await call("ha_state", { entities: ["zone.home"] }),
            await call("ha_state", {}),
            // Entities appear while a fresh instance settles, so the two calls compared read
            // only zones, which the configuration fixes.
            await call("ha_state", { entities: ["zone.*"] }),
            await call("ha_state", { entities: ["zone.*"], detail: "summary" }),
          ],
        );
        const zone = home?.document as {
          format: string;
          entities: Record<string, Record<string, unknown[]>>;
        };
        expect(zone.format).toBe("domusops.state/0.1");
        const [record] = zone.entities["zone"]?.["_"] ?? [];
        expect(record).toMatchObject({
          id: "home",
          latitude: "[redacted]",
          longitude: "[redacted]",
        });
        expect(home?.notes).toEqual([]);
        // The same entity, unchanged, gives the same document.
        expect(again?.document).toEqual(home?.document);

        const standard = full?.document as {
          compression_ratio: number;
          entities: Record<string, Record<string, unknown[]>>;
        };
        const listed = Object.values(
          (zones?.document as typeof standard).entities,
        )
          .flatMap((groups) => Object.values(groups))
          .reduce((sum, rows) => sum + rows.length, 0);
        const counts = (summary?.document as { counts: { entities: number } })
          .counts;
        expect(listed).toBeGreaterThan(0);
        expect(counts.entities).toBe(listed);
        // Measured at 2.00 for the 17 entities of 2026.10.0 (specs/010-ha-state research R10).
        expect(standard.compression_ratio).toBeGreaterThan(1);
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );
});

/** The changes of a `domusops.history/0.1` entity entry, in order. */
type HistoryRow = [string, string | null | undefined, ...unknown[]];
interface HistoryEntry {
  start?: [string, Record<string, unknown>];
  changes?: Record<string, Record<string, HistoryRow[]>>;
}
const rowsOf = (entry: HistoryEntry | undefined): HistoryRow[] =>
  Object.values(entry?.changes ?? {}).flatMap((hours) =>
    Object.values(hours).flat(),
  );

describe.each(CHANNELS)("ha_history against %s", (channel) => {
  it(
    "follows a light through a past window, and a summary that counts what standard lists (SC-005, SC-006, §8)",
    async () => {
      expect(existsSync(MCP_ENTRY), "run pnpm build first").toBe(true);
      const sandbox = await startSandbox({
        ...startTarget(channel),
        devices: [
          { kind: "light", name: "Hall" },
          { kind: "switch", name: "Quiet" },
        ],
      });
      try {
        const { wsUrl, token } = sandbox.connection();
        const socket = await HaSocket.connect(wsUrl, token);
        let start: string;
        let end: string;
        try {
          // Let the new entities settle, then switch the light eight times.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          start = new Date().toISOString();
          await new Promise((resolve) => setTimeout(resolve, 1100));
          for (let n = 0; n < 8; n++) {
            const service = n % 2 === 0 ? "turn_off" : "turn_on";
            await socket.command({
              type: "call_service",
              domain: "light",
              service,
              service_data: { entity_id: "light.hall" },
            });
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          // The recorder commits about every second; the window ends after it has.
          await new Promise((resolve) => setTimeout(resolve, 2500));
          end = new Date().toISOString();
        } finally {
          socket.close();
        }
        const window = { start, end };
        const [named, again, pattern, counted, home, everything] =
          await withMcp({ ...sandbox.mcpEnv() }, async (call) => [
            await call("ha_history", {
              ...window,
              entities: ["light.hall", "switch.quiet"],
            }),
            await call("ha_history", {
              ...window,
              entities: ["light.hall", "switch.quiet"],
            }),
            await call("ha_history", { ...window, entities: ["switch.*"] }),
            await call("ha_history", {
              ...window,
              entities: ["light.hall"],
              detail: "summary",
            }),
            await call("ha_history", { ...window, detail: "summary" }),
            await call("ha_history", window),
          ]);

        const document = named?.document as {
          format: string;
          entities: Record<string, HistoryEntry>;
        };
        expect(document.format).toBe("domusops.history/0.1");
        const light = document.entities["light.hall"];
        expect(light?.start?.[0]).toBe("on");
        expect(rowsOf(light).map((row) => row[1])).toEqual(
          Array.from({ length: 8 }, (_, n) => (n % 2 === 0 ? "off" : "on")),
        );
        // Named by exact ID and unchanged: its start state only.
        expect(document.entities["switch.quiet"]).toEqual({
          start: [
            "off",
            expect.objectContaining({ friendly_name: "Quiet" }) as unknown,
          ],
        });
        expect(named?.notes).toEqual([]);
        // A past window gives the same document.
        expect(again?.document).toEqual(named?.document);

        // Matched by a pattern and unchanged: left out.
        expect(
          (pattern?.document as { entities: Record<string, unknown> }).entities,
        ).toEqual({});
        expect(pattern?.notes).toEqual([
          "Note: no selected entity changed in the window.",
        ]);

        expect(
          (counted?.document as { by_entity: Record<string, number[]> })
            .by_entity,
        ).toEqual({ "light.hall": [8, 8, 0] });
        const summary = home?.document as {
          by_domain: Record<string, number[]>;
          by_entity?: unknown;
        };
        expect(summary.by_domain["light"]?.[0]).toBeGreaterThanOrEqual(1);
        expect(summary.by_entity).toBeUndefined();

        // Measured at 1.87 on 2026.10.0, counting only the listed light (specs/011-ha-history
        // research R12).
        expect(
          (everything?.document as { compression_ratio: number })
            .compression_ratio,
        ).toBeGreaterThan(1);
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );
});
