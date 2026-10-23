import { afterEach, describe, expect, it } from "vitest";
import { ToolError, type ErrorKind } from "../src/errors.js";
import { HaClient, type Timeouts } from "../src/ha/client.js";
import { readConfig } from "../src/ha/config.js";
import { retrieve } from "../src/ha/retrieve.js";
import { errors } from "../src/errors.js";
import { ALLOWED_COMMANDS } from "../src/ha/client.js";
import { fetchEvents } from "../src/ha/logbook.js";
import { REFERENCE_500 } from "./fixtures/generate.js";
import { REFERENCE_LOGBOOK_24H } from "./fixtures/generate-logbook.js";
import { REFERENCE_TRACES } from "./fixtures/generate-traces.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";

const SHORT: Partial<Timeouts> = {
  connectMs: 300,
  commandMs: 300,
  totalMs: 2000,
};

const running: FakeHa[] = [];
const clients: HaClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  while (running.length > 0) await running.pop()?.close();
});

async function fake(options: Partial<FakeHaOptions> = {}): Promise<FakeHa> {
  const ha = await startFakeHa({ fixture: REFERENCE_500, ...options });
  running.push(ha);
  return ha;
}

const wsUrl = (ha: FakeHa): string => `ws://127.0.0.1:${ha.port}/api/websocket`;

async function connect(ha: FakeHa, token = FAKE_TOKEN): Promise<HaClient> {
  const client = await HaClient.connect({
    wsUrl: wsUrl(ha),
    token,
    timeouts: SHORT,
  });
  clients.push(client);
  return client;
}

/** Runs `action` and returns the ToolError it rejects with. */
async function failure(action: () => Promise<unknown>): Promise<ToolError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error("expected the action to fail");
}

const kindOf = (error: ToolError): ErrorKind => error.kind;

describe("config", () => {
  const ok = {
    DOMUSOPS_HA_URL: "http://homeassistant.local:8123",
    DOMUSOPS_HA_TOKEN: "t",
  };

  it("maps http to ws and https to wss", () => {
    expect(readConfig(ok).wsUrl).toBe(
      "ws://homeassistant.local:8123/api/websocket",
    );
    expect(
      readConfig({ ...ok, DOMUSOPS_HA_URL: "https://ha.example.com/" }).wsUrl,
    ).toBe("wss://ha.example.com/api/websocket");
  });

  it("names the missing variable", () => {
    for (const variable of ["DOMUSOPS_HA_URL", "DOMUSOPS_HA_TOKEN"]) {
      const env: Record<string, string | undefined> = {
        ...ok,
        [variable]: undefined,
      };
      try {
        readConfig(env);
        expect.unreachable();
      } catch (error) {
        expect(kindOf(error as ToolError)).toBe("config_missing");
        expect((error as ToolError).message).toContain(variable);
      }
    }
  });

  it("states the expected form for an invalid address", () => {
    for (const url of [
      "ftp://x",
      "not a url",
      "http://",
      "http://host/ha/",
      "http://u:p@host",
    ]) {
      try {
        readConfig({ ...ok, DOMUSOPS_HA_URL: url });
        expect.unreachable();
      } catch (error) {
        expect(kindOf(error as ToolError)).toBe("config_invalid");
        expect((error as ToolError).message).toContain("http://host[:port]");
      }
    }
  });
});

describe("HaClient failures", () => {
  it("reports an unreachable host with the address it tried", async () => {
    const ha = await fake();
    const url = wsUrl(ha);
    await ha.close();
    running.pop();
    const error = await failure(() =>
      HaClient.connect({ wsUrl: url, token: FAKE_TOKEN, timeouts: SHORT }),
    );
    expect(kindOf(error)).toBe("unreachable");
    expect(error.message).toContain(url);
  });

  it.each(["connect", "auth"])(
    "times out when the instance stalls at %s",
    async (stall) => {
      const ha = await fake({ stall });
      const error = await failure(() =>
        HaClient.connect({
          wsUrl: wsUrl(ha),
          token: FAKE_TOKEN,
          timeouts: SHORT,
        }),
      );
      expect(kindOf(error)).toBe("timeout");
      expect(error.message).toContain(wsUrl(ha));
      expect(error.message).toContain("authenticating");
    },
  );

  it("times out on a stalled command and names it", async () => {
    const ha = await fake({ stall: "get_states" });
    const client = await connect(ha);
    const error = await failure(() => retrieve(client));
    expect(kindOf(error)).toBe("timeout");
    expect(error.message).toContain("get_states");
  });

  it("refuses an old version before it sends the token", async () => {
    const ha = await fake({ haVersion: "2024.12.4" });
    const error = await failure(() =>
      HaClient.connect({
        wsUrl: wsUrl(ha),
        token: FAKE_TOKEN,
        timeouts: SHORT,
      }),
    );
    expect(kindOf(error)).toBe("version_unsupported");
    expect(error.message).toContain("2024.12.4");
    expect(error.message).toContain("2025.1.0");
    expect(ha.authReceived).toBe(false);
  });

  it("reports a rejected token", async () => {
    const ha = await fake();
    const error = await failure(() =>
      HaClient.connect({
        wsUrl: wsUrl(ha),
        token: "wrong-token",
        timeouts: SHORT,
      }),
    );
    expect(kindOf(error)).toBe("auth_invalid");
    expect(error.message).not.toContain("wrong-token");
  });

  it("requires an administrator user", async () => {
    const ha = await fake({ isAdmin: false });
    const client = await connect(ha);
    const error = await failure(() => retrieve(client));
    expect(kindOf(error)).toBe("not_admin");
    expect(error.message).toContain("administrator");
    expect(ha.received).toEqual(["auth/current_user"]);
  });

  it("names the retrieval that failed", async () => {
    const ha = await fake({
      failCommand: {
        type: "config/device_registry/list",
        code: "unauthorized",
        message: "nope",
      },
    });
    const client = await connect(ha);
    const error = await failure(() => retrieve(client));
    expect(kindOf(error)).toBe("retrieval_failed");
    expect(error.message).toContain("config/device_registry/list");
    expect(error.message).toContain("unauthorized");
  });

  it("fails when the connection drops mid-call", async () => {
    const ha = await fake({ dropAfter: "get_states" });
    const client = await connect(ha);
    const error = await failure(() => retrieve(client));
    expect(kindOf(error)).toBe("retrieval_failed");
    expect(error.message).toContain("get_states");
  });

  it("reports an unexpected response shape as a protocol error", async () => {
    const ha = await fake({ malformed: "get_config" });
    const client = await connect(ha);
    const error = await failure(() => retrieve(client));
    expect(kindOf(error)).toBe("protocol_error");
    expect(error.message).toContain(REFERENCE_500.haVersion);
  });
});

describe("HaClient allowlist (FR-018)", () => {
  it("never sends a command that is not on the allowlist", async () => {
    const ha = await fake();
    const client = await connect(ha);
    for (const command of [
      "config/entity_registry/update",
      "call_service",
      "config/area_registry/delete",
    ]) {
      const error = await failure(() => client.command(command as never));
      expect(kindOf(error)).toBe("protocol_error");
    }
    await retrieve(client);
    expect(ha.received).not.toContain("call_service");
    expect(ha.received).not.toContain("config/entity_registry/update");
    expect(new Set(ha.received)).toEqual(
      new Set([
        "auth/current_user",
        "get_config",
        "get_states",
        "config/entity_registry/list",
        "config/device_registry/list",
        "config/area_registry/list",
        "config_entries/get",
      ]),
    );
  });
});

describe("logbook command (feature 002)", () => {
  it("allows logbook/get_events with only its three parameters", async () => {
    const ha = await fake({ fixture: REFERENCE_LOGBOOK_24H });
    const client = await connect(ha);
    const { start, end } = REFERENCE_LOGBOOK_24H.window;
    const rows = await client.command("logbook/get_events", {
      start_time: new Date(start * 1000).toISOString(),
      end_time: new Date(end * 1000).toISOString(),
    });
    expect(Array.isArray(rows)).toBe(true);
    expect(Object.keys(ha.receivedParams[0] ?? {}).sort()).toEqual([
      "end_time",
      "start_time",
    ]);
  });

  it("rejects parameters on any other command, before the socket", async () => {
    const ha = await fake();
    const client = await connect(ha);
    const error = await failure(() =>
      client.command("get_states", {
        start_time: "x",
        end_time: "y",
      }),
    );
    expect(error.kind).toBe("protocol_error");
    expect(ha.received).not.toContain("get_states");
  });

  it("rejects an unknown parameter key on the logbook command", async () => {
    const ha = await fake({ fixture: REFERENCE_LOGBOOK_24H });
    const client = await connect(ha);
    const error = await failure(() =>
      client.command("logbook/get_events", {
        start_time: "a",
        end_time: "b",
        context_id: "c",
      } as never),
    );
    expect(error.kind).toBe("protocol_error");
    expect(ha.received).not.toContain("logbook/get_events");
  });

  it("lets the logbook command outlast the per-command limit", async () => {
    const ha = await fake({
      fixture: REFERENCE_LOGBOOK_24H,
      logbookDelayMs: 350,
    });
    const client = await HaClient.connect({
      wsUrl: wsUrl(ha),
      token: FAKE_TOKEN,
      timeouts: { connectMs: 300, commandMs: 100, totalMs: 3000 },
    });
    clients.push(client);
    const rows = await client.command("logbook/get_events", {
      start_time: "2026-09-25T10:00:00Z",
      end_time: "2026-09-26T10:00:00Z",
    });
    expect(Array.isArray(rows)).toBe(true);
    // Any other command still stops at the per-command limit.
    const slow = await fake({ stall: "get_states" });
    const slowClient = await HaClient.connect({
      wsUrl: wsUrl(slow),
      token: FAKE_TOKEN,
      timeouts: { connectMs: 300, commandMs: 100, totalMs: 3000 },
    });
    clients.push(slowClient);
    expect((await failure(() => slowClient.command("get_states"))).kind).toBe(
      "timeout",
    );
  });

  it("times out at the overall limit with a shorter-window next step", async () => {
    const ha = await fake({
      fixture: REFERENCE_LOGBOOK_24H,
      logbookDelayMs: 1500,
    });
    const client = await HaClient.connect({
      wsUrl: wsUrl(ha),
      token: FAKE_TOKEN,
      timeouts: { connectMs: 300, commandMs: 100, totalMs: 500 },
    });
    clients.push(client);
    const error = await failure(() =>
      client.command("logbook/get_events", {
        start_time: "2026-09-25T10:00:00Z",
        end_time: "2026-09-26T10:00:00Z",
      }),
    );
    expect(error.kind).toBe("timeout");
    expect(error.nextStep).toContain("shorter window");
  });
});

describe("HaClient trace commands (feature 003, FR-017)", () => {
  const traceFake = (): Promise<FakeHa> => fake({ fixture: REFERENCE_TRACES });
  const first = REFERENCE_TRACES
    .traces[0] as (typeof REFERENCE_TRACES.traces)[number];

  it("allows each trace command with exactly its own parameters", async () => {
    const ha = await traceFake();
    const client = await connect(ha);
    const list = await client.command("trace/list", { domain: "automation" });
    expect(Array.isArray(list)).toBe(true);
    const contexts = await client.command("trace/contexts");
    expect(typeof contexts).toBe("object");
    const got = (await client.command("trace/get", {
      domain: first.domain as "automation" | "script",
      item_id: first.item_id,
      run_id: first.run_id,
    })) as { run_id: string };
    expect(got.run_id).toBe(first.run_id);
    expect(ha.received.filter((c) => c.startsWith("trace/"))).toEqual([
      "trace/list",
      "trace/contexts",
      "trace/get",
    ]);
  });

  it("rejects parameters on a command that takes none, before the socket", async () => {
    const ha = await traceFake();
    const client = await connect(ha);
    for (const [command, params] of [
      ["get_config", { domain: "automation" }],
      ["trace/contexts", { domain: "automation" }],
    ] as const) {
      const error = await failure(() =>
        client.command(command, params as never),
      );
      expect(kindOf(error)).toBe("protocol_error");
    }
    expect(ha.received).not.toContain("get_config");
    expect(ha.received).not.toContain("trace/contexts");
  });

  it("rejects a key of another command, a missing key, and a bad domain", async () => {
    const ha = await traceFake();
    const client = await connect(ha);
    const bad: [Parameters<HaClient["command"]>[0], unknown][] = [
      ["trace/list", { domain: "automation", item_id: "x" }],
      ["trace/list", { domain: "light" }],
      ["trace/list", {}],
      ["trace/get", { domain: "automation", item_id: "x" }],
      [
        "trace/get",
        { domain: "automation", item_id: "x", run_id: "y", extra: 1 },
      ],
      ["logbook/get_events", { domain: "automation" }],
    ];
    for (const [command, params] of bad) {
      const error = await failure(() =>
        client.command(command, params as never),
      );
      expect(kindOf(error)).toBe("protocol_error");
    }
    expect(ha.received.filter((c) => c.startsWith("trace/"))).toEqual([]);
  });

  it("never sends a debug command", async () => {
    const ha = await traceFake();
    const client = await connect(ha);
    for (const command of [
      "trace/debug/breakpoint/set",
      "trace/debug/continue",
      "trace/debug/step",
      "trace/debug/stop",
      "trace/subscribe_breakpoints",
    ]) {
      const error = await failure(() => client.command(command as never));
      expect(kindOf(error)).toBe("protocol_error");
    }
    expect(ha.received.filter((c) => c.startsWith("trace/"))).toEqual([]);
  });

  it("resolves several requests in flight with their own replies", async () => {
    const ha = await traceFake();
    const client = await connect(ha);
    const picks = REFERENCE_TRACES.traces.slice(0, 8);
    const got = (await Promise.all(
      picks.map((t) =>
        client.command("trace/get", {
          domain: t.domain as "automation" | "script",
          item_id: t.item_id,
          run_id: t.run_id,
        }),
      ),
    )) as { run_id: string }[];
    expect(got.map((r) => r.run_id)).toEqual(picks.map((t) => t.run_id));
  });
});

describe("HaClient.close (spec FR-002, SC-002)", () => {
  it("rejects every command still waiting, with the connection-closed error", async () => {
    const ha = await fake({ delayMs: 5_000 });
    const client = await connect(ha);
    const waiting = ["get_config", "get_states", "config_entries/get"].map(
      (type) =>
        failure(() =>
          client.command(
            type as "get_config" | "get_states" | "config_entries/get",
          ),
        ),
    );
    // Let the three commands reach the socket before it is closed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const closedAt = Date.now();
    client.close();
    const errors = await Promise.all(waiting);
    expect(Date.now() - closedAt).toBeLessThan(1000);
    for (const error of errors) {
      expect(kindOf(error)).toBe("retrieval_failed");
      expect(error.message).toContain(
        "the connection closed before a reply arrived",
      );
    }
  });

  it("is harmless when called twice, and later commands fail at once", async () => {
    const ha = await fake({ delayMs: 5_000 });
    const client = await connect(ha);
    const waiting = failure(() => client.command("get_config"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.close();
    client.close();
    expect(kindOf(await waiting)).toBe("retrieval_failed");
    const later = await failure(() => client.command("get_states"));
    expect(kindOf(later)).toBe("retrieval_failed");
  });
});

describe("history_unavailable comes from the instance's error code (FR-025)", () => {
  const WINDOW = ["2026-09-26T00:00:00Z", "2026-09-27T00:00:00Z"] as const;

  it("is reported when logbook/get_events answers unknown_command", async () => {
    const ha = await fake({
      failCommand: { type: "logbook/get_events", code: "unknown_command" },
    });
    const client = await connect(ha);
    const error = await failure(() => fetchEvents(client, ...WINDOW));
    expect(kindOf(error)).toBe("history_unavailable");
    expect(error.toToolText("ha_logbook_query")).toBe(
      "ha_logbook_query failed [history_unavailable]: " +
        errors.historyUnavailable().message,
    );
  });

  it("is not reported when only the message says unknown_command", async () => {
    const ha = await fake({
      failCommand: {
        type: "logbook/get_events",
        code: "home_assistant_error",
        message: "the recorder said unknown_command",
      },
    });
    const client = await connect(ha);
    const error = await failure(() => fetchEvents(client, ...WINDOW));
    expect(kindOf(error)).toBe("retrieval_failed");
    expect(error.haCode).toBe("home_assistant_error");
  });

  it("keeps the instance's code on a failed command, and nothing on other errors", async () => {
    const ha = await fake({
      failCommand: { type: "get_states", code: "unauthorized" },
    });
    const client = await connect(ha);
    expect((await failure(() => client.command("get_states"))).haCode).toBe(
      "unauthorized",
    );
    expect(errors.unreachable("x", "y").haCode).toBeNull();
    expect(errors.retrievalFailed("get_states", "closed").haCode).toBeNull();
  });
});

describe("the command table (FR-027)", () => {
  it("allows exactly these commands, in this order", () => {
    expect([...ALLOWED_COMMANDS]).toEqual([
      "auth/current_user",
      "get_config",
      "get_states",
      "config/entity_registry/list",
      "config/device_registry/list",
      "config/area_registry/list",
      "config_entries/get",
      "logbook/get_events",
      "trace/list",
      "trace/get",
      "trace/contexts",
    ]);
  });

  const WINDOW = { start_time: "2026-09-26T00:00:00Z", end_time: "x" };
  it.each([
    ["get_states", { domain: "light" }, 'command "get_states" does not take'],
    ["logbook/get_events", {}, 'parameter "start_time" is required'],
    [
      "logbook/get_events",
      { ...WINDOW, end_time: "y", bogus: 1 },
      'parameter "bogus" is not allowed',
    ],
    [
      "logbook/get_events",
      { start_time: "a" },
      'parameter "end_time" is required',
    ],
    ["trace/list", {}, 'parameter "domain" is required'],
    [
      "trace/list",
      { domain: "light" },
      'parameter "domain" must be "automation" or "script"',
    ],
    [
      "trace/get",
      { domain: "script", item_id: "a" },
      'parameter "run_id" is required',
    ],
    [
      "trace/get",
      { domain: "script", item_id: "a", run_id: "b", extra: 1 },
      'parameter "extra" is not allowed',
    ],
    ["trace/contexts", { domain: "script" }, "does not take parameters"],
  ])("rejects %s with %j before the socket", async (type, params, text) => {
    const ha = await fake();
    const client = await connect(ha);
    const before = ha.received.length;
    const error = await failure(() =>
      client.command(type as never, params as never),
    );
    expect(kindOf(error)).toBe("protocol_error");
    expect(error.causeText).toContain(text);
    expect(ha.received.length).toBe(before);
  });

  it("gives only logbook/get_events the overall budget", async () => {
    // 600 ms is past the 300 ms per-command limit and inside the 2000 ms overall one.
    const slowLogbook = await fake({ logbookDelayMs: 600 });
    const logbook = await connect(slowLogbook);
    await expect(
      logbook.command("logbook/get_events", {
        start_time: "2026-09-26T00:00:00Z",
        end_time: "2026-09-27T00:00:00Z",
      }),
    ).resolves.toBeDefined();

    const slowStates = await fake({ delayMs: 600 });
    const states = await connect(slowStates);
    const error = await failure(() => states.command("get_states"));
    expect(kindOf(error)).toBe("timeout");
  });
});
