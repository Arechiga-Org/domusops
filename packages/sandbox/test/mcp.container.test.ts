import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
          system_log: true,
          trace: true,
        });
        expect(document.tools).toEqual({
          ha_snapshot: { ready: true },
          ha_logbook_query: { ready: true },
          ha_trace: { ready: true },
          ha_state: { ready: true },
          ha_history: { ready: true },
          ha_system_log: { ready: true },
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

/**
 * A configuration with a synthetic custom integration, `boom`, whose action logs warnings, a
 * chained exception, a library logger's error and an error with seeded values, and a broken
 * template sensor (specs/012-ha-system-log research R14). The test calls the action; the server
 * never writes to the log (FR-019).
 */
function boomConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "domusops-syslog-"));
  writeFileSync(
    join(dir, "configuration.yaml"),
    [
      "default_config:",
      "",
      "boom:",
      "",
      "template:",
      "  - sensor:",
      "      - name: Broken ratio",
      '        state: "{{ 1 / 0 }}"',
      "",
    ].join("\n"),
  );
  const integration = join(dir, "custom_components", "boom");
  mkdirSync(integration, { recursive: true });
  writeFileSync(
    join(integration, "manifest.json"),
    JSON.stringify({
      domain: "boom",
      name: "Boom",
      version: "0.0.1",
      documentation: "https://example.invalid",
      codeowners: [],
      iot_class: "local_push",
      requirements: [],
    }),
  );
  writeFileSync(
    join(integration, "__init__.py"),
    [
      '"""A synthetic integration that logs on demand."""',
      "import logging",
      "",
      "_LOGGER = logging.getLogger(__name__)",
      '_LIB = logging.getLogger("pyboom.client")',
      "",
      "",
      "def _parse(value):",
      "    return int(value)",
      "",
      "",
      "def _fetch(value):",
      "    try:",
      "        return _parse(value)",
      "    except ValueError as err:",
      '        raise RuntimeError("could not read the device") from err',
      "",
      "",
      "async def async_setup(hass, config):",
      "    async def fire(call):",
      "        for i in range(7):",
      '            _LOGGER.warning("Device %s did not answer, retry %s", "node_1", i % 3)',
      "        try:",
      '            _fetch("not-a-number")',
      "        except RuntimeError:",
      '            _LOGGER.exception("Update failed for user someone@example.com")',
      "        try:",
      '            _parse("x")',
      "        except ValueError:",
      '            _LIB.error("Library error talking to http://admin:hunter2@192.0.2.5/api", exc_info=True)',
      '        _LOGGER.error("Plain error at 40.4168, -3.7038")',
      "",
      '    hass.services.async_register("boom", "fire", fire)',
      "    return True",
      "",
    ].join("\n"),
  );
  return dir;
}

type SystemLogRow = [
  string,
  string,
  string,
  string | null,
  [number, number],
  number,
  string[],
  (string | null)?,
  ((number | string)[] | null)?,
  1?,
];

interface SystemLogStandard {
  format: string;
  compression_ratio: number;
  files: string[];
  parts: (string | [number, number, string, string?])[];
  entries: Record<string, SystemLogRow[]>;
}

/** The rows of a standard system log document, in order. */
const rowsOfLog = (document: SystemLogStandard): SystemLogRow[] =>
  Object.values(document.entries).flat();

/** A row's traceback text, rebuilt from `parts` as the decoder does. */
function tracebackOf(document: SystemLogStandard, row: SystemLogRow): string {
  return (row[8] ?? [])
    .map((item) => {
      if (typeof item === "string") return item;
      const part = document.parts[item];
      if (typeof part === "string") return part;
      const [file, line, fn, code] = part ?? [0, 0, ""];
      const head = `  File "${document.files[file] ?? ""}", line ${line}, in ${fn}`;
      return code === undefined ? head : `${head}\n${code}`;
    })
    .join("\n");
}

describe.each(CHANNELS)("ha_system_log against %s", (channel) => {
  it(
    "reads a custom integration's entries, re-rooted and redacted, and a summary that counts what standard lists (SC-005, SC-006, §8)",
    async () => {
      expect(existsSync(MCP_ENTRY), "run pnpm build first").toBe(true);
      const dir = boomConfig();
      const sandbox = await startSandbox({
        ...startTarget(channel),
        config: { dir },
      });
      try {
        const { wsUrl, token } = sandbox.connection();
        const socket = await HaSocket.connect(wsUrl, token);
        try {
          for (let n = 0; n < 2; n++) {
            await socket.command({
              type: "call_service",
              domain: "boom",
              service: "fire",
              service_data: {},
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          await socket.command({
            type: "call_service",
            domain: "system_log",
            service: "write",
            service_data: {
              message: "Written by the test",
              level: "warning",
              logger: "custom_components.boom.sensor",
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } finally {
          socket.close();
        }

        const results = await withMcp({ ...sandbox.mcpEnv() }, async (call) => [
          await call("ha_system_log", { integrations: ["boom"] }),
          await call("ha_system_log", { integrations: ["boom"] }),
          await call("ha_system_log", {
            integrations: ["boom"],
            level: "error",
          }),
          await call("ha_system_log", {}),
          await call("ha_system_log", { detail: "summary" }),
          await call("ha_system_log", {}),
        ]);
        const [boom, again, errorsOnly, before, summary, after] = results;
        const document = boom?.document as SystemLogStandard;
        expect(document.format).toBe("domusops.system_log/0.1");
        const rows = rowsOfLog(document);
        const byMessage = (text: string): SystemLogRow | undefined =>
          rows.find((row) => row[6].some((m) => m.includes(text)));

        const warnings = byMessage("did not answer");
        expect(warnings?.slice(1, 4)).toEqual([
          "warning",
          "custom_components.boom",
          "boom",
        ]);
        expect(warnings?.[5]).toBe(14);
        expect(warnings?.[6]).toHaveLength(3);

        const failed = byMessage("Update failed for user");
        expect(failed?.[6]).toEqual(["Update failed for user [redacted]"]);
        expect(failed?.[5]).toBe(2);
        const chained = tracebackOf(document, failed as SystemLogRow);
        expect(chained).toContain("direct cause of the following exception");
        expect(chained).toContain(
          'File "{config}/custom_components/boom/__init__.py"',
        );

        // A library logger's entry belongs to the integration through its source.
        const library = byMessage("Library error");
        expect(library?.[2]).toBe("pyboom.client");
        expect(library?.[3]).toBe("boom");
        expect(library?.[9]).toBe(1);
        expect(library?.[6]).toEqual([
          "Library error talking to http://admin:[redacted]@192.0.2.5/api",
        ]);
        expect(byMessage("Plain error")?.[6]).toEqual([
          "Plain error at [redacted]",
        ]);
        expect(byMessage("Written by the test")?.[3]).toBe("boom");

        for (const part of document.parts) {
          if (typeof part === "string") continue;
          expect(document.files[part[0]]).toMatch(
            /^(\{config\}|\{ha\}|\{python\})\/|^<template>$/,
          );
        }
        const text = JSON.stringify(document);
        for (const seed of [
          "someone@example.com",
          "hunter2",
          "40.4168",
          "/config/",
          "/usr/",
        ]) {
          expect(text).not.toContain(seed);
        }
        // Nothing was recorded in between: the same document.
        expect(again?.document).toEqual(boom?.document);

        expect(
          rowsOfLog(errorsOnly?.document as SystemLogStandard).every(
            (row) => row[1] !== "warning",
          ),
        ).toBe(true);

        // The summary counts what the standard result around it lists, when nothing changed.
        expect(after?.document).toEqual(before?.document);
        const all = rowsOfLog(before?.document as SystemLogStandard);
        expect(
          (
            summary?.document as {
              counts: { entries: number; occurrences: number };
            }
          ).counts,
        ).toEqual({
          entries: all.length,
          occurrences: all.reduce((sum, row) => sum + row[5], 0),
        });

        // Measured at 1.47 on 2026.10.0: a handful of entries, mostly unique messages and one
        // traceback each (specs/012-ha-system-log research R12). CI's floor is on the fixture.
        const ratio = (before?.document as SystemLogStandard).compression_ratio;
        const summaryRatio = (
          summary?.document as { compression_ratio: number }
        ).compression_ratio;
        console.log(
          `ha_system_log on ${channel}: compression_ratio ${ratio}, summary ${summaryRatio}`,
        );
        expect(ratio).toBeGreaterThan(1);
      } finally {
        await sandbox.stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    8 * MINUTE,
  );
});
