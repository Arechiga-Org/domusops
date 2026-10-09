import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { VirtualDevice } from "../devices/spec.js";
import type { HaSocket } from "../ha/ws.js";
import type { Connection, Sandbox } from "../instance/handle.js";
import type { SandboxListing } from "../instance/list.js";
import type { StartOptions } from "../instance/start.js";
import type { Channel, ResolvedRelease } from "../release/versions.js";
import type { StepName } from "../results/result.js";

export const REFERENCE_CONFIG = fileURLToPath(
  new URL("../../fixtures/reference-config", import.meta.url),
);

/** The automation in the reference configuration that turns `light.hall` on at 03:00:00. */
const AUTOMATION_ID = "domusops_reference_hall_light_at_three";
const MCP_TIMEOUT_MS = 60_000;

/** How to start the MCP server: all of its environment is listed here. */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ConfigCheck {
  result?: string;
  errors?: string | null;
}

export interface McpConnection {
  transport: Transport;
  /** What the server wrote to its error output so far. */
  stderr(): string;
}

/** The outside world the steps touch; tests replace any of it. */
export interface SmokeDeps {
  resolve(channel: Channel): Promise<ResolvedRelease>;
  start(options: StartOptions): Promise<Sandbox>;
  list(): Promise<SandboxListing[]>;
  connectSocket(wsUrl: string, token: string): Promise<HaSocket>;
  /** Asks the instance to check its configuration. */
  checkConfig(connection: Connection): Promise<ConfigCheck>;
  openMcp(launch: McpLaunch): McpConnection;
  /** The built `@domusops/mcp` entry point. */
  mcpEntry(): string;
  /** The environment of this process; only `PATH` and `HOME` are ever passed on. */
  environment: NodeJS.ProcessEnv;
}

export interface SmokeContext {
  deps: SmokeDeps;
  /** The exact release every step runs on. */
  release: string;
  sandbox?: Sandbox;
  devices: VirtualDevice[];
}

export interface SmokeStep {
  name: StepName;
  /** Throws {@link StepFailure} for a failed check; any other error fails the step too. */
  run(context: SmokeContext): Promise<void>;
}

/** A check that did not hold. The message is written for the result file. */
export class StepFailure extends Error {}

/** Where the built MCP server lives: its package is a dependency of this one. */
export function resolveMcpEntry(): string {
  const manifest = createRequire(import.meta.url).resolve(
    "@domusops/mcp/package.json",
  );
  return join(dirname(manifest), "dist", "cli.js");
}

/**
 * The server gets the sandbox's URL and token and nothing else from the caller. Nothing is
 * inherited, so a `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` of the developer's own can never reach it.
 */
export function mcpLaunch(
  sandbox: Sandbox,
  entry: string,
  environment: NodeJS.ProcessEnv,
): McpLaunch {
  const env: Record<string, string> = { ...sandbox.mcpEnv() };
  for (const key of ["PATH", "HOME"]) {
    const value = environment[key];
    if (value !== undefined) env[key] = value;
  }
  return { command: process.execPath, args: [entry], env };
}

function running(context: SmokeContext): Sandbox {
  if (context.sandbox === undefined) {
    throw new StepFailure("There is no running instance.");
  }
  return context.sandbox;
}

async function withSocket<T>(
  context: SmokeContext,
  body: (socket: HaSocket) => Promise<T>,
): Promise<T> {
  const { wsUrl, token } = running(context).connection();
  const socket = await context.deps.connectSocket(wsUrl, token);
  try {
    return await body(socket);
  } finally {
    socket.close();
  }
}

async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function entityIds(states: { entity_id: string }[]): Set<string> {
  return new Set(states.map((state) => state.entity_id));
}

const start: SmokeStep = {
  name: "start",
  async run(context) {
    context.sandbox = await context.deps.start({
      release: context.release,
      config: { dir: REFERENCE_CONFIG },
      devices: [],
      maxLifetimeMinutes: 30,
    });
    const user = await withSocket(context, (socket) =>
      socket.command<{ is_admin?: boolean }>({ type: "auth/current_user" }),
    );
    if (user.is_admin !== true) {
      throw new StepFailure("The sandbox's token is not an administrator's.");
    }
  },
};

const loadConfig: SmokeStep = {
  name: "load-config",
  async run(context) {
    const sandbox = running(context);
    const answer = await context.deps.checkConfig(sandbox.connection());
    if (answer.result !== "valid") {
      throw new StepFailure(
        `The reference configuration is not valid: ${answer.errors ?? "no reason given"}.`,
      );
    }
    if (sandbox.config === null) {
      throw new StepFailure("The instance did not load the configuration.");
    }
  },
};

const virtualDevice: SmokeStep = {
  name: "virtual-device",
  async run(context) {
    context.devices = await running(context).addDevices([
      { kind: "binary_sensor", name: "Motion", class: "motion" },
      { kind: "light", name: "Hall" },
    ]);
    const ids = context.devices.map((device) => device.entityId).sort();
    if (ids.join(",") !== "binary_sensor.motion,light.hall") {
      throw new StepFailure(
        `The virtual devices have the entity ids ${ids.join(", ")}.`,
      );
    }
  },
};

const setState: SmokeStep = {
  name: "set-state",
  async run(context) {
    const sandbox = running(context);
    await sandbox.setState("binary_sensor.motion", "on", {
      device_class: "motion",
      domusops_smoke: "1",
    });
    const motion = await sandbox.getState("binary_sensor.motion");
    const light = await sandbox.getState("light.hall");
    if (motion?.state !== "on") {
      throw new StepFailure("The motion sensor did not keep the state set.");
    }
    if (motion.attributes["domusops_smoke"] !== "1") {
      throw new StepFailure("The motion sensor did not keep its attribute.");
    }
    if (light === null) {
      throw new StepFailure("The virtual light cannot be read back.");
    }
  },
};

const time: SmokeStep = {
  name: "time",
  async run(context) {
    const sandbox = running(context);
    await sandbox.callService("light", "turn_off", {
      entity_id: "light.hall",
    });
    // No zone: the instance reads it in its own, which is what the automation's 03:00 means.
    await sandbox.time.freeze("2031-03-04T02:59:50");
    await sandbox.time.advance(20);
    const lit = await pollUntil(
      async () => (await sandbox.getState("light.hall"))?.state === "on",
      10_000,
    );
    if (!lit) {
      throw new StepFailure("The 03:00 automation did not turn the light on.");
    }
    await withSocket(context, async (socket) => {
      const states = await socket.command<
        { entity_id: string; attributes: Record<string, unknown> }[]
      >({ type: "get_states" });
      const automation = states.find(
        (state) =>
          state.entity_id.startsWith("automation.") &&
          state.attributes["id"] === AUTOMATION_ID,
      );
      if (automation === undefined) {
        throw new StepFailure("The reference automation is not loaded.");
      }
      if (automation.attributes["last_triggered"] == null) {
        throw new StepFailure("The reference automation never triggered.");
      }
      const traces = await socket.command<unknown[]>({
        type: "trace/list",
        domain: "automation",
        item_id: AUTOMATION_ID,
      });
      if (traces.length !== 1) {
        throw new StepFailure(
          `The reference automation ran ${String(traces.length)} times, not once.`,
        );
      }
    });
    await sandbox.time.resume();
  },
};

const mcpSnapshot: SmokeStep = {
  name: "mcp-snapshot",
  async run(context) {
    const sandbox = running(context);
    const { transport, stderr } = context.deps.openMcp(
      mcpLaunch(sandbox, context.deps.mcpEntry(), context.deps.environment),
    );
    const client = new Client({ name: "domusops-sandbox-smoke", version: "0" });
    let text: string;
    try {
      await client.connect(transport, { timeout: MCP_TIMEOUT_MS });
      const reply = await client.callTool(
        { name: "ha_snapshot", arguments: { detail: "summary" } },
        undefined,
        { timeout: MCP_TIMEOUT_MS },
      );
      const first = (reply.content as { type: string; text?: string }[])[0];
      text = first?.text ?? "";
      if (reply.isError === true) {
        throw new StepFailure(`ha_snapshot answered with an error: ${text}`);
      }
    } catch (error) {
      if (error instanceof StepFailure) throw error;
      const detail = stderr().trim();
      throw new StepFailure(
        `The MCP server did not answer: ${error instanceof Error ? error.message : String(error)}${detail === "" ? "" : ` (${detail})`}`,
      );
    } finally {
      await client.close().catch(() => undefined);
    }
    let snapshot: {
      format?: string;
      by_domain?: Record<string, number>;
      by_integration?: Record<string, { entities?: number }>;
    };
    try {
      snapshot = JSON.parse(text) as typeof snapshot;
    } catch {
      throw new StepFailure("ha_snapshot did not answer with JSON.");
    }
    if (snapshot.format !== "domusops.snapshot/0.1") {
      throw new StepFailure("ha_snapshot answered in an unknown format.");
    }
    if ((snapshot.by_domain?.["light"] ?? 0) < 1) {
      throw new StepFailure("The snapshot does not list the virtual light.");
    }
    if ((snapshot.by_integration?.["virtual"]?.entities ?? 0) < 2) {
      throw new StepFailure("The snapshot does not list both virtual devices.");
    }
  },
};

const websocket: SmokeStep = {
  name: "websocket",
  async run(context) {
    const ids = await withSocket(context, async (socket) =>
      entityIds(
        await socket.command<{ entity_id: string }[]>({ type: "get_states" }),
      ),
    );
    for (const expected of ["light.hall", "binary_sensor.motion"]) {
      if (!ids.has(expected)) {
        throw new StepFailure(`get_states does not list ${expected}.`);
      }
    }
  },
};

export const SMOKE_STEPS: readonly SmokeStep[] = [
  start,
  loadConfig,
  virtualDevice,
  setState,
  time,
  mcpSnapshot,
  websocket,
];

/** Runs whatever happened before it: stopping is what leaves nothing behind. */
export const TEARDOWN_STEP: SmokeStep = {
  name: "teardown",
  async run(context) {
    const sandbox = context.sandbox;
    if (sandbox === undefined) return;
    await sandbox.stop();
    const left = (await context.deps.list()).filter(
      (listing) => listing.id === sandbox.id,
    );
    if (left.length > 0) {
      throw new StepFailure("The instance's container is still there.");
    }
  },
};
