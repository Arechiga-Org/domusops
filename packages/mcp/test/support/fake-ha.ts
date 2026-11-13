import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { TraceExtendedRecord } from "@domusops/schema";
import type { Fixture } from "../fixtures/generate.js";

export interface FakeHaOptions {
  fixture: Fixture;
  /** Token the fake accepts. */
  token?: string;
  haVersion?: string;
  isAdmin?: boolean;
  /** Reply `success: false` to this command. */
  failCommand?: { type: string; code?: string; message?: string };
  /** Close the connection when this command is received, without replying. */
  dropAfter?: string;
  /** Never reply: "connect" (no auth_required), "auth" (no auth reply), or a command type. */
  stall?: string;
  /** Reply to this command with a result of the wrong shape. */
  malformed?: string;
  /** `false` makes the instance answer `unknown_command` to `logbook/get_events` (no logbook). */
  logbook?: boolean;
  /** Milliseconds the instance takes to answer `logbook/get_events`. */
  logbookDelayMs?: number;
  /** `false` makes the instance answer `unknown_command` to the history command (no history). */
  history?: boolean;
  /** Milliseconds the instance takes to answer `history/history_during_period`. */
  historyDelayMs?: number;
  /** `false` makes the instance answer `unknown_command` to the `trace/*` commands (feature 003). */
  traces?: boolean;
  /** Makes the `trace/*` commands fail with `unauthorized`, as they do for a non-administrator. */
  traceNotAdmin?: boolean;
  /** A run ID that `trace/list` returns but `trace/get` no longer finds (evicted meanwhile). */
  evictOnGet?: string;
  /** Milliseconds every reply after authentication is held back. */
  delayMs?: number;
  /** A run ID whose `trace/get` fails at once, while every other reply waits for `delayMs`. */
  failTraceGet?: string;
  /**
   * The `trace.stored_traces` an item's configuration sets, by entity ID; items not listed set
   * none (specs/008-mcp-reliability US4). `failCommand` makes `automation/config` or
   * `script/config` fail.
   */
  storedTraces?: Record<string, number>;
  /** Entity IDs of items built from a blueprint: their configuration is a `use_blueprint`. */
  blueprints?: string[];
}

export interface FakeHa {
  url: string;
  port: number;
  /** Command types received after authentication, in order. */
  received: string[];
  /** Parameters of every `logbook/get_events` received, in order (feature 002). */
  receivedParams: Record<string, unknown>[];
  /** Parameters of every `trace/*` command received, in order (feature 003). */
  receivedTraceParams: Record<string, unknown>[];
  /** Parameters of every `history/history_during_period` received, in order (feature 011). */
  receivedHistoryParams: Record<string, unknown>[];
  /** How many connections the instance accepted, authenticated or not (spec 009 FR-008). */
  connections: number;
  /** The entity ID of every `automation/config` and `script/config` received, in order. */
  receivedConfigIds: string[];
  /** When each `trace/get` was received, in order (milliseconds since the epoch). */
  traceGetsAt: number[];
  /** When each command was received, in order (milliseconds since the epoch). */
  receivedAt: { type: string; at: number }[];
  /** Whether an `auth` message (which carries the token) was ever received. */
  authReceived: boolean;
  close(): Promise<void>;
}

export const FAKE_TOKEN = "fake-test-token-0123456789";

interface LogbookMessage {
  start_time?: unknown;
  end_time?: unknown;
  entity_ids?: unknown;
}

/** Serves `logbook/get_events` the way Home Assistant does (research R1). */
function logbookResult(
  message: LogbookMessage,
  options: FakeHaOptions,
): { error: { code: string; message: string } } | { result: unknown[] } {
  const start = Date.parse(String(message.start_time));
  if (Number.isNaN(start)) {
    return {
      error: { code: "invalid_start_time", message: "Invalid start_time" },
    };
  }
  const end =
    message.end_time === undefined
      ? Date.now()
      : Date.parse(String(message.end_time));
  if (Number.isNaN(end)) {
    return { error: { code: "invalid_end_time", message: "Invalid end_time" } };
  }
  if (start > Date.now()) return { result: [] };
  const ids = Array.isArray(message.entity_ids)
    ? (message.entity_ids as string[])
    : null;
  const rows = (options.fixture.logbook ?? []).filter(
    (row) =>
      row.when * 1000 >= start &&
      row.when * 1000 <= end &&
      (ids === null ||
        (row.entity_id !== undefined && ids.includes(row.entity_id))),
  );
  return { result: rows };
}

type Reply = { error: { code: string; message: string } } | { result: unknown };

const HISTORY_KEYS = new Set([
  "id",
  "type",
  "start_time",
  "end_time",
  "entity_ids",
  "include_start_time_state",
  "significant_changes_only",
  "minimal_response",
  "no_attributes",
]);

/**
 * Serves `history/history_during_period` the way the measured releases do (specs/011-ha-history
 * research R1): the start state with `lu` set to the start and no `lc`, `lc` only when the state
 * did not change, attribute-only entries dropped by `significant_changes_only` (its default), empty
 * attributes with `no_attributes`, and entities with nothing to give left out.
 */
function historyReply(
  message: Record<string, unknown>,
  options: FakeHaOptions,
): Reply {
  const stray = Object.keys(message).find((key) => !HISTORY_KEYS.has(key));
  if (stray !== undefined) {
    return {
      error: {
        code: "invalid_format",
        message: `extra keys not allowed @ data['${stray}']`,
      },
    };
  }
  if (!Array.isArray(message["entity_ids"])) {
    return {
      error: {
        code: "invalid_format",
        message: "required key not provided @ data['entity_ids']",
      },
    };
  }
  const start = Date.parse(String(message["start_time"])) / 1000;
  const end =
    message["end_time"] === undefined
      ? Date.now() / 1000
      : Date.parse(String(message["end_time"])) / 1000;
  const withStart = message["include_start_time_state"] !== false;
  const significant = message["significant_changes_only"] !== false;
  const noAttributes = message["no_attributes"] === true;
  const result: Record<string, unknown[]> = {};
  for (const id of message["entity_ids"] as string[]) {
    const recorded = options.fixture.history?.[id] ?? [];
    const entries: unknown[] = [];
    const before = recorded.filter((entry) => entry.lu < start).at(-1);
    if (withStart && before !== undefined) {
      entries.push({ s: before.s, a: noAttributes ? {} : before.a, lu: start });
    }
    for (const entry of recorded) {
      if (entry.lu < start || entry.lu >= end) continue;
      if (significant && entry.lc !== entry.lu) continue;
      entries.push({
        s: entry.s,
        a: noAttributes ? {} : entry.a,
        lu: entry.lu,
        ...(entry.lc === entry.lu ? {} : { lc: entry.lc }),
      });
    }
    if (entries.length > 0) result[id] = entries;
  }
  return { result };
}

const SHORT_OMITTED = new Set([
  "trace",
  "config",
  "blueprint_inputs",
  "context",
]);

/** Serves the `trace/*` commands the way Home Assistant does (research R1). */
function traceReply(
  type: string,
  message: { domain?: unknown; item_id?: unknown; run_id?: unknown },
  options: FakeHaOptions,
): Reply {
  if (options.traceNotAdmin === true) {
    return { error: { code: "unauthorized", message: "Unauthorized" } };
  }
  const traces: TraceExtendedRecord[] = options.fixture.traces ?? [];
  if (type === "trace/list") {
    return {
      result: traces
        .filter((t) => t.domain === message.domain)
        .map((t) =>
          Object.fromEntries(
            Object.entries(t).filter(([key]) => !SHORT_OMITTED.has(key)),
          ),
        ),
    };
  }
  if (type === "trace/contexts") {
    const map: Record<string, unknown> = {};
    for (const t of traces) {
      map[t.context.id] = {
        run_id: t.run_id,
        domain: t.domain,
        item_id: t.item_id,
      };
    }
    return { result: map };
  }
  const found = traces.find(
    (t) =>
      t.run_id === message.run_id &&
      t.domain === message.domain &&
      t.item_id === message.item_id,
  );
  if (found === undefined || options.evictOnGet === message.run_id) {
    return {
      error: { code: "not_found", message: "The trace could not be found" },
    };
  }
  return { result: found };
}

/**
 * Serves `automation/config` and `script/config` the way Home Assistant does: the item's
 * configuration under `config`, with `trace` only when it sets `stored_traces`.
 */
function configReply(
  type: string,
  entityId: unknown,
  options: FakeHaOptions,
): Reply {
  const domain = type.slice(0, type.indexOf("/"));
  const entry = (
    options.fixture.records.entity_registry as unknown as {
      entity_id: string;
      unique_id: string;
      platform: string;
    }[]
  ).find((e) => e.entity_id === entityId && e.platform === domain);
  if (entry === undefined) {
    return { error: { code: "not_found", message: "Entity not found" } };
  }
  const stored = options.storedTraces?.[entry.entity_id];
  const blueprint = options.blueprints?.includes(entry.entity_id) === true;
  return {
    result: {
      config: {
        ...(domain === "automation" ? { id: entry.unique_id } : {}),
        alias: entry.entity_id,
        ...(blueprint
          ? { use_blueprint: { path: "motion_light.yaml", input: {} } }
          : {}),
        ...(stored === undefined ? {} : { trace: { stored_traces: stored } }),
      },
    },
  };
}

function resultFor(type: string, options: FakeHaOptions): unknown {
  const { records } = options.fixture;
  switch (type) {
    case "auth/current_user":
      return { ...options.fixture.user, is_admin: options.isAdmin ?? true };
    case "get_config":
      return records.config;
    case "get_states":
      return records.states;
    case "config/entity_registry/list":
      return records.entity_registry;
    case "config/device_registry/list":
      return records.device_registry;
    case "config/area_registry/list":
      return records.area_registry;
    case "config_entries/get":
      return records.config_entries;
    default:
      return undefined;
  }
}

/** A `ws`-based fake instance on an ephemeral port that speaks the handshake and serves fixtures. */
export async function startFakeHa(options: FakeHaOptions): Promise<FakeHa> {
  const token = options.token ?? FAKE_TOKEN;
  const haVersion = options.haVersion ?? options.fixture.haVersion;
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  const fake: FakeHa = {
    url: `http://127.0.0.1:${port}`,
    port,
    received: [],
    receivedParams: [],
    receivedTraceParams: [],
    receivedHistoryParams: [],
    receivedConfigIds: [],
    connections: 0,
    traceGetsAt: [],
    receivedAt: [],
    authReceived: false,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };

  server.on("connection", (socket: ServerSocket) => {
    fake.connections++;
    if (options.stall === "connect") return;
    socket.send(
      JSON.stringify({ type: "auth_required", ha_version: haVersion }),
    );
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as {
        id?: number;
        type?: string;
        access_token?: string;
        domain?: unknown;
        item_id?: unknown;
        run_id?: unknown;
        entity_id?: unknown;
      } & LogbookMessage;
      if (message.type === "auth") {
        fake.authReceived = true;
        if (options.stall === "auth") return;
        if (message.access_token === token) {
          socket.send(
            JSON.stringify({ type: "auth_ok", ha_version: haVersion }),
          );
        } else {
          socket.send(
            JSON.stringify({
              type: "auth_invalid",
              message: "Invalid access token",
            }),
          );
          socket.close();
        }
        return;
      }
      const type = message.type ?? "";
      fake.received.push(type);
      fake.receivedAt.push({ type, at: Date.now() });
      if (type === "trace/get") fake.traceGetsAt.push(Date.now());
      // A reply is held back by `delayMs`, except the immediate failure of `failTraceGet`.
      const immediate =
        type === "trace/get" && options.failTraceGet === message.run_id;
      const out = (text: string): void => {
        const delay = immediate ? 0 : (options.delayMs ?? 0);
        if (delay === 0) socket.send(text);
        else
          setTimeout(() => {
            if (socket.readyState === socket.OPEN) socket.send(text);
          }, delay);
      };
      // The result message of a reply; `malformed` replaces a successful result.
      const envelope = (reply: Reply): string =>
        JSON.stringify(
          "error" in reply
            ? {
                id: message.id,
                type: "result",
                success: false,
                error: reply.error,
              }
            : {
                id: message.id,
                type: "result",
                success: true,
                result:
                  options.malformed === type
                    ? "not the expected shape"
                    : reply.result,
              },
        );
      if (immediate) {
        out(
          JSON.stringify({
            id: message.id,
            type: "result",
            success: false,
            error: { code: "unknown_error", message: "simulated failure" },
          }),
        );
        return;
      }
      if (options.dropAfter === type) {
        socket.terminate();
        return;
      }
      if (options.stall === type) return;
      if (options.failCommand?.type === type) {
        out(
          JSON.stringify({
            id: message.id,
            type: "result",
            success: false,
            error: {
              code: options.failCommand.code ?? "unknown_error",
              message: options.failCommand.message ?? "simulated failure",
            },
          }),
        );
        return;
      }
      if (type.startsWith("trace/") && options.traces !== false) {
        fake.receivedTraceParams.push(
          Object.fromEntries(
            Object.entries(message).filter(
              ([key]) => key !== "id" && key !== "type",
            ),
          ),
        );
        const reply = traceReply(type, message, options);
        out(envelope(reply));
        return;
      }
      if (type === "logbook/get_events" && options.logbook !== false) {
        fake.receivedParams.push(
          Object.fromEntries(
            Object.entries(message).filter(
              ([key]) => key !== "id" && key !== "type",
            ),
          ),
        );
        const reply = logbookResult(message, options);
        const send = (): void => out(envelope(reply));
        if (options.logbookDelayMs === undefined) send();
        else setTimeout(send, options.logbookDelayMs);
        return;
      }
      if (
        type === "history/history_during_period" &&
        options.history !== false &&
        options.malformed !== type
      ) {
        fake.receivedHistoryParams.push(
          Object.fromEntries(
            Object.entries(message).filter(
              ([key]) => key !== "id" && key !== "type",
            ),
          ),
        );
        const reply = historyReply(message as Record<string, unknown>, options);
        const send = (): void => out(envelope(reply));
        if (options.historyDelayMs === undefined) send();
        else setTimeout(send, options.historyDelayMs);
        return;
      }
      if (type === "automation/config" || type === "script/config") {
        fake.receivedConfigIds.push(String(message.entity_id));
        const reply = configReply(type, message.entity_id, options);
        out(envelope(reply));
        return;
      }
      const result =
        options.malformed === type
          ? "not the expected shape"
          : resultFor(type, options);
      if (result === undefined) {
        out(
          JSON.stringify({
            id: message.id,
            type: "result",
            success: false,
            error: {
              code: "unknown_command",
              message: `Unknown command ${type}`,
            },
          }),
        );
        return;
      }
      out(
        JSON.stringify({
          id: message.id,
          type: "result",
          success: true,
          result,
        }),
      );
    });
  });

  return fake;
}
