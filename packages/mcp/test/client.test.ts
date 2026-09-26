import { afterEach, describe, expect, it } from "vitest";
import { SnapshotError, type ErrorKind } from "../src/errors.js";
import { HaClient, type Timeouts } from "../src/ha/client.js";
import { readConfig } from "../src/ha/config.js";
import { retrieve } from "../src/ha/retrieve.js";
import { REFERENCE_500 } from "./fixtures/generate.js";
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

/** Runs `action` and returns the SnapshotError it rejects with. */
async function failure(action: () => Promise<unknown>): Promise<SnapshotError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotError);
    return error as SnapshotError;
  }
  throw new Error("expected the action to fail");
}

const kindOf = (error: SnapshotError): ErrorKind => error.kind;

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
        expect(kindOf(error as SnapshotError)).toBe("config_missing");
        expect((error as SnapshotError).message).toContain(variable);
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
        expect(kindOf(error as SnapshotError)).toBe("config_invalid");
        expect((error as SnapshotError).message).toContain(
          "http://host[:port]",
        );
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
