import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { SandboxError } from "../src/errors.js";
import type { HaSocket } from "../src/ha/ws.js";
import type { EntityState, Sandbox } from "../src/instance/handle.js";
import type { RunResult } from "../src/results/result.js";
import { runSmoke } from "../src/smoke/run.js";
import { mcpLaunch, type SmokeDeps } from "../src/smoke/steps.js";

const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzbW9rZTEyMzQ1NiJ9.c2lnbmF0dXJlMTIzNDU2";

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  JSON.parse(
    readFileSync(
      new URL("../schema/run-result.schema.json", import.meta.url),
      "utf8",
    ),
  ) as object,
);

interface Fake {
  deps: SmokeDeps;
  stopped: string[];
  launches: { env: Record<string, string> }[];
  states: Map<string, EntityState>;
  remaining: { id: string }[];
}

interface Faults {
  start?: Error;
  resolve?: Error;
  checkConfig?: { result: string; errors: string };
  setStateKeeps?: boolean;
  snapshot?: string;
  snapshotError?: string;
  listError?: Error;
}

function fake(faults: Faults = {}): Fake {
  const stopped: string[] = [];
  const launches: { env: Record<string, string> }[] = [];
  const states = new Map<string, EntityState>();
  const remaining: { id: string }[] = [];
  let triggered = false;

  const sandbox = {
    id: "sb-1",
    config: { source: "directory" },
    connection: () => {
      if (stopped.length > 0) throw new Error("stopped");
      return {
        url: "http://127.0.0.1:1",
        wsUrl: "ws://127.0.0.1:1/api/websocket",
        token: TOKEN,
      };
    },
    mcpEnv: () => ({
      DOMUSOPS_HA_URL: "http://127.0.0.1:1",
      DOMUSOPS_HA_TOKEN: TOKEN,
    }),
    addDevices: async () => {
      states.set("light.hall", { state: "off", attributes: {} });
      states.set("binary_sensor.motion", { state: "off", attributes: {} });
      return [
        {
          kind: "binary_sensor",
          name: "Motion",
          entityId: "binary_sensor.motion",
        },
        { kind: "light", name: "Hall", entityId: "light.hall" },
      ];
    },
    setState: async (
      id: string,
      state: string,
      attributes?: Record<string, unknown>,
    ) => {
      if (faults.setStateKeeps === true) return;
      states.set(id, { state, attributes: attributes ?? {} });
    },
    getState: async (id: string) => states.get(id) ?? null,
    callService: async () => {
      states.set("light.hall", { state: "off", attributes: {} });
    },
    time: {
      freeze: async () => undefined,
      advance: async () => {
        triggered = true;
        states.set("light.hall", { state: "on", attributes: {} });
        return { now: "2031-03-04T03:00:10", fired: 1 };
      },
      resume: async () => undefined,
      now: async () => ({ now: "x", frozen: false }),
    },
    stop: async () => {
      stopped.push("sb-1");
    },
  } as unknown as Sandbox;

  const socket = {
    command: async (payload: { type: string }) => {
      switch (payload.type) {
        case "auth/current_user":
          return { is_admin: true };
        case "get_states":
          return [
            { entity_id: "light.hall", attributes: {} },
            { entity_id: "binary_sensor.motion", attributes: {} },
            {
              entity_id: "automation.hall_light_at_three",
              attributes: {
                id: "domusops_reference_hall_light_at_three",
                last_triggered: triggered ? "2031-03-04T03:00:00Z" : null,
              },
            },
          ];
        case "trace/list":
          return triggered ? [{}] : [];
        default:
          throw new Error(`unexpected command ${payload.type}`);
      }
    },
    close: () => undefined,
  } as unknown as HaSocket;

  const snapshot =
    faults.snapshot ??
    JSON.stringify({
      format: "domusops.snapshot/0.1",
      by_domain: { light: 1, binary_sensor: 1 },
      by_integration: { virtual: { entities: 2 } },
    });

  const deps: SmokeDeps = {
    resolve: async (channel) => {
      if (faults.resolve !== undefined) throw faults.resolve;
      return { channel, release: "2026.10.1", beta: false };
    },
    start: async () => {
      if (faults.start !== undefined) throw faults.start;
      remaining.push({ id: "sb-1" });
      return sandbox;
    },
    list: async () => {
      if (faults.listError !== undefined && stopped.length > 0) {
        throw faults.listError;
      }
      if (stopped.length > 0) remaining.length = 0;
      return remaining as never;
    },
    connectSocket: async () => socket,
    checkConfig: async () =>
      faults.checkConfig ?? { result: "valid", errors: null },
    openMcp: (launch) => {
      launches.push(launch);
      const [client, serverSide] = InMemoryTransport.createLinkedPair();
      const server = new Server(
        { name: "fake", version: "0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          { name: "ha_snapshot", inputSchema: { type: "object" as const } },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async () => ({
        content: [{ type: "text", text: faults.snapshotError ?? snapshot }],
        ...(faults.snapshotError === undefined ? {} : { isError: true }),
      }));
      void server.connect(serverSide);
      return { transport: client };
    },
    mcpEntry: () => "/fake/mcp/dist/cli.js",
    environment: {
      PATH: "/usr/bin",
      HOME: "/home/dev",
      DOMUSOPS_HA_URL: "http://192.0.2.1:8123",
      DOMUSOPS_HA_TOKEN: "a-developers-own-token-0123456789",
    },
  };
  return { deps, stopped, launches, states, remaining };
}

function expectValid(result: RunResult): void {
  expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(TOKEN);
}

describe("the smoke check", () => {
  it("passes when every step holds, and tears down", async () => {
    const f = fake();
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.outcome).toBe("passed");
    expect(result.release).toBe("2026.10.1");
    expect(result.steps.map((s) => `${s.name}:${s.status}`)).toEqual([
      "start:passed",
      "load-config:passed",
      "virtual-device:passed",
      "set-state:passed",
      "time:passed",
      "mcp-snapshot:passed",
      "websocket:passed",
      "teardown:passed",
    ]);
    expect(f.stopped).toEqual(["sb-1"]);
    expectValid(result);
  });

  it("records the first failure, skips the rest and still tears down", async () => {
    const f = fake({ setStateKeeps: true });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.failedStep).toBe("set-state");
    expect(result.steps.map((s) => `${s.name}:${s.status}`).slice(3)).toEqual([
      "set-state:failed",
      "time:skipped",
      "mcp-snapshot:skipped",
      "websocket:skipped",
      "teardown:passed",
    ]);
    expect(f.stopped).toEqual(["sb-1"]);
    expectValid(result);
  });

  it("fails on an invalid configuration at load-config", async () => {
    const f = fake({ checkConfig: { result: "invalid", errors: "bad yaml" } });
    const result = await runSmoke({ release: "2026.9.3" }, f.deps);
    expect(result.channel).toBe("exact");
    expect(result.failedStep).toBe("load-config");
    expect(
      result.steps.find((s) => s.name === "load-config")?.message,
    ).toContain("bad yaml");
    expectValid(result);
  });

  it("fails at mcp-snapshot when the snapshot lacks the virtual devices", async () => {
    const f = fake({
      snapshot: JSON.stringify({
        format: "domusops.snapshot/0.1",
        by_domain: { light: 1 },
        by_integration: {},
      }),
    });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.failedStep).toBe("mcp-snapshot");
    expectValid(result);
  });

  it("never lets a token into a message", async () => {
    const f = fake({
      checkConfig: {
        result: "invalid",
        errors: `used Bearer ${TOKEN} and ${TOKEN}`,
      },
    });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expectValid(result);
  });

  it("reports a failed start as a failed step when the image was fine", async () => {
    const f = fake({
      start: new SandboxError(
        "not_ready",
        "Home Assistant did not become ready.",
      ),
    });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.failedStep).toBe("start");
    expect(result.steps.at(-1)).toMatchObject({
      name: "teardown",
      status: "passed",
    });
    expectValid(result);
  });

  it.each(["image_unavailable", "runtime_missing"] as const)(
    "could not run (%s) is told apart from a failed check",
    async (code) => {
      const f = fake({ start: new SandboxError(code, "no image") });
      const result = await runSmoke({ channel: "stable" }, f.deps);
      expect(result.outcome).toBe("could-not-run");
      expect(result.failedStep).toBe("pull");
      expect(result.steps).toEqual([]);
      expectValid(result);
    },
  );

  it("could not run when the channel cannot be resolved, with no release", async () => {
    const f = fake({
      resolve: new SandboxError("channel_unresolved", "offline"),
    });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.outcome).toBe("could-not-run");
    expect(result.failedStep).toBe("resolve");
    expect(result.release).toBeUndefined();
    expectValid(result);
  });

  it("does not turn an unexpected resolve error into could-not-run", async () => {
    const f = fake({ resolve: new TypeError("bug") });
    await expect(runSmoke({ channel: "stable" }, f.deps)).rejects.toThrow(
      TypeError,
    );
  });

  it("keeps the token out of a teardown message even though the sandbox is stopped", async () => {
    const f = fake({ listError: new Error(`refused ${TOKEN}`) });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.failedStep).toBe("teardown");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expectValid(result);
  });

  it("leaves what ha_snapshot said in an error out of the result", async () => {
    const f = fake({ snapshotError: "light.hall is on at https://ha.example" });
    const result = await runSmoke({ channel: "stable" }, f.deps);
    expect(result.failedStep).toBe("mcp-snapshot");
    expect(JSON.stringify(result)).not.toContain("light.hall");
    expect(JSON.stringify(result)).not.toContain("ha.example");
    expectValid(result);
  });

  it("says no beta is in progress, without a release", async () => {
    const f = fake({
      resolve: new SandboxError("no_beta_in_progress", "none"),
    });
    const result = await runSmoke({ channel: "beta" }, f.deps);
    expect(result.outcome).toBe("no-beta-in-progress");
    expect(result.release).toBeUndefined();
    expect(f.remaining).toEqual([]);
    expectValid(result);
  });
});

describe("the MCP server's environment", () => {
  it("holds the sandbox's URL and token, PATH and HOME, and nothing else", async () => {
    const f = fake();
    await runSmoke({ channel: "stable" }, f.deps);
    expect(f.launches).toHaveLength(1);
    const env = f.launches[0]?.env ?? {};
    expect(Object.keys(env).sort()).toEqual([
      "DOMUSOPS_HA_TOKEN",
      "DOMUSOPS_HA_URL",
      "HOME",
      "PATH",
    ]);
    expect(env["DOMUSOPS_HA_URL"]).toBe("http://127.0.0.1:1");
    expect(env["DOMUSOPS_HA_TOKEN"]).toBe(TOKEN);
  });

  it("ignores a URL and token in the caller's own environment", () => {
    const sandbox = {
      mcpEnv: () => ({
        DOMUSOPS_HA_URL: "http://127.0.0.1:1",
        DOMUSOPS_HA_TOKEN: TOKEN,
      }),
    } as unknown as Sandbox;
    const launch = mcpLaunch(sandbox, "/mcp/cli.js", {
      DOMUSOPS_HA_URL: "http://192.0.2.1:8123",
      DOMUSOPS_HA_TOKEN: "stray",
      GITHUB_TOKEN: "ghp_stray",
    });
    expect(launch.env).toEqual({
      DOMUSOPS_HA_URL: "http://127.0.0.1:1",
      DOMUSOPS_HA_TOKEN: TOKEN,
    });
    expect(launch.args).toEqual(["/mcp/cli.js"]);
  });
});
