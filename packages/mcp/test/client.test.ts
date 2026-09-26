import { afterEach, describe, expect, it } from "vitest";
import { ToolError, type ErrorKind } from "../src/errors.js";
import { HaClient, type Timeouts } from "../src/ha/client.js";
import { readConfig } from "../src/ha/config.js";
import { retrieve } from "../src/ha/retrieve.js";
import { REFERENCE_500 } from "./fixtures/generate.js";
import { REFERENCE_LOGBOOK_24H } from "./fixtures/generate-logbook.js";
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
