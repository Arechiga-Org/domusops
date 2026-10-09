import { inspect } from "node:util";
import { SandboxError } from "../errors.js";
import type { ResolvedRelease } from "../release/versions.js";
import type { VirtualDevices } from "../devices/virtual.js";
import type { VirtualDevice, VirtualDeviceSpec } from "../devices/spec.js";
import { HttpError, getJson, postJson } from "../ha/rest.js";
import { HaSocket, WsCommandError } from "../ha/ws.js";
import type { Runtime } from "../runtime/docker.js";
import type { Removal } from "../runtime/reaper.js";
import type { ConfigSummary, LifecycleState, SandboxMode } from "../types.js";

export interface Connection {
  url: string;
  wsUrl: string;
  token: string;
}

/** The environment `@domusops/mcp` reads: exactly these two keys. */
export interface McpEnv {
  DOMUSOPS_HA_URL: string;
  DOMUSOPS_HA_TOKEN: string;
}

export interface EntityState {
  state: string;
  attributes: Record<string, unknown>;
}

/** Control of the instance's clock; needs Home Assistant internals, so only CI proves it per release. */
export interface SandboxTime {
  /** Fixes the instance's clock at `at` (ISO 8601; no zone means the instance's own). */
  freeze(at: string): Promise<void>;
  /** Moves a frozen clock forward and runs the timers that fall due. 0 < seconds <= 604800. */
  advance(seconds: number): Promise<{ now: string; fired: number }>;
  /** Back to real time. */
  resume(): Promise<void>;
  now(): Promise<{ now: string; frozen: boolean }>;
}

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const SERVICE_PART = /^[a-z0-9_]+$/;
/** ISO 8601 date and time, with an optional offset; what the instance's own parser reads. */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** True for an ISO 8601 date and time the instance can read; a date alone or free text is not. */
export function isInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !ISO_INSTANT.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  // Date.parse rolls a day that does not exist (February 31) over into the next month.
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

export const MAX_ADVANCE_SECONDS = 7 * 24 * 3600;
const TIME_COMMAND_TIMEOUT_MS = 90_000;

export interface Sandbox {
  readonly id: string;
  readonly release: ResolvedRelease;
  readonly mode: SandboxMode;
  readonly deadline: string;
  /** Always `http://127.0.0.1:<port>`. */
  readonly url: string;
  readonly config: ConfigSummary | null;
  /** Instances the reaper removed before this one was created (empty after `attachSandbox`). */
  readonly reaped: readonly Removal[];
  connection(): Connection;
  mcpEnv(): McpEnv;
  /** Devices created so far, from `devices` at start and `addDevices`. */
  readonly devices: readonly VirtualDevice[];
  /** Needs `devices` (an empty list is enough) at start. */
  addDevices(devices: VirtualDeviceSpec[]): Promise<VirtualDevice[]>;
  /** Writes the state machine entry, as a device would: triggers and automations see it. */
  setState(
    entityId: string,
    state: string,
    attributes?: Record<string, unknown>,
  ): Promise<void>;
  getState(entityId: string): Promise<EntityState | null>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
  readonly time: SandboxTime;
  /** Background: releases this process's hold and leaves the instance running. Tied: same as stop. */
  detach(): Promise<void>;
  /** Idempotent. */
  stop(): Promise<void>;
}

export interface HandleInit {
  id: string;
  containerId: string;
  release: ResolvedRelease;
  mode: SandboxMode;
  deadline: string;
  port: number;
  token: string;
  config: ConfigSummary | null;
  runtime: Runtime;
  reaped?: readonly Removal[];
  /** Present when the instance was started with `devices`. */
  virtual?: VirtualDevices;
  /** The devices the instance started with. */
  devices?: readonly VirtualDevice[];
  /** Run once, in order, when this process lets go of the instance: detach or stop. */
  onRelease?: (() => void | Promise<void>)[];
  /** Called once the container is removed, never before: until then the exit guard stays armed. */
  releaseGuard?: () => void;
  /** Told `stopping` and `gone` as the instance is removed. */
  onProgress?: (state: LifecycleState) => void;
}

export class SandboxHandle implements Sandbox {
  readonly id: string;
  readonly release: ResolvedRelease;
  readonly mode: SandboxMode;
  readonly deadline: string;
  readonly url: string;
  readonly config: ConfigSummary | null;
  readonly reaped: readonly Removal[];
  readonly time: SandboxTime;
  readonly #token: string;
  readonly #wsUrl: string;
  readonly #containerId: string;
  readonly #runtime: Runtime;
  readonly #onRelease: (() => void | Promise<void>)[];
  readonly #releaseGuard: (() => void) | undefined;
  readonly #onProgress: ((state: LifecycleState) => void) | undefined;
  readonly #virtual: VirtualDevices | undefined;
  readonly #devices: VirtualDevice[];
  #stopping: Promise<void> | null = null;
  #detached: Promise<void> | null = null;

  constructor(init: HandleInit) {
    this.id = init.id;
    this.release = init.release;
    this.mode = init.mode;
    this.deadline = init.deadline;
    this.url = `http://127.0.0.1:${init.port}`;
    this.#wsUrl = `ws://127.0.0.1:${init.port}/api/websocket`;
    this.config = init.config;
    this.#token = init.token;
    this.#containerId = init.containerId;
    this.#runtime = init.runtime;
    this.reaped = init.reaped ?? [];
    this.#onRelease = init.onRelease ?? [];
    this.#releaseGuard = init.releaseGuard;
    this.#onProgress = init.onProgress;
    this.#virtual = init.virtual;
    this.#devices = [...(init.devices ?? [])];
    this.time = {
      freeze: async (at) => {
        if (!isInstant(at)) {
          throw new TypeError("`at` must be an ISO 8601 date and time.");
        }
        await this.companion("time/freeze", { at });
      },
      advance: async (seconds) => {
        if (
          !Number.isFinite(seconds) ||
          seconds <= 0 ||
          seconds > MAX_ADVANCE_SECONDS
        ) {
          throw new RangeError(
            `\`seconds\` must be greater than 0 and at most ${String(MAX_ADVANCE_SECONDS)}.`,
          );
        }
        return this.companion<{ now: string; fired: number }>("time/advance", {
          seconds,
        });
      },
      resume: async () => {
        await this.companion("time/resume", {});
      },
      now: () =>
        this.companion<{ now: string; frozen: boolean }>("time/now", {}),
    };
  }

  get devices(): readonly VirtualDevice[] {
    return [...this.#devices];
  }

  async addDevices(devices: VirtualDeviceSpec[]): Promise<VirtualDevice[]> {
    this.assertRunning();
    if (this.#virtual === undefined) {
      throw new SandboxError(
        "virtual_unavailable",
        "This handle cannot add devices: the instance was started without `devices`, or this process only reattached to it.",
      );
    }
    const created = await this.#virtual.add(devices);
    this.#devices.push(...created);
    return created;
  }

  async setState(
    entityId: string,
    state: string,
    attributes: Record<string, unknown> = {},
  ): Promise<void> {
    this.assertRunning();
    assertEntityId(entityId);
    if (typeof state !== "string") {
      throw new TypeError("`state` must be a string.");
    }
    await postJson(
      this.url,
      `/api/states/${entityId}`,
      { state, attributes },
      { token: this.#token },
    );
  }

  async getState(entityId: string): Promise<EntityState | null> {
    this.assertRunning();
    assertEntityId(entityId);
    try {
      const row = (await getJson(this.url, `/api/states/${entityId}`, {
        token: this.#token,
      })) as { state: string; attributes: Record<string, unknown> };
      return { state: row.state, attributes: row.attributes };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    this.assertRunning();
    if (!SERVICE_PART.test(domain) || !SERVICE_PART.test(service)) {
      throw new TypeError(
        "`domain` and `service` must be lowercase names such as light and turn_on.",
      );
    }
    await postJson(this.url, `/api/services/${domain}/${service}`, data, {
      token: this.#token,
      timeoutMs: 60_000,
    });
  }

  private async companion<T = Record<string, never>>(
    command: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    this.assertRunning();
    const socket = await HaSocket.connect(this.#wsUrl, this.#token);
    try {
      return await socket.command<T>(
        { type: `domusops_sandbox/${command}`, ...payload },
        TIME_COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof WsCommandError) {
        throw new SandboxError("time_control_failed", error.message, {
          secrets: [this.#token],
        });
      }
      throw error;
    } finally {
      socket.close();
    }
  }

  connection(): Connection {
    this.assertRunning();
    return { url: this.url, wsUrl: this.#wsUrl, token: this.#token };
  }

  mcpEnv(): McpEnv {
    this.assertRunning();
    return { DOMUSOPS_HA_URL: this.url, DOMUSOPS_HA_TOKEN: this.#token };
  }

  detach(): Promise<void> {
    if (this.mode === "tied") return this.stop();
    this.#detached ??= this.runReleaseHooks();
    return this.#detached;
  }

  stop(): Promise<void> {
    this.#stopping ??= (async () => {
      this.#onProgress?.("stopping");
      await this.runReleaseHooks();
      await this.#runtime.remove(this.#containerId);
      this.#releaseGuard?.();
      this.#onProgress?.("gone");
    })().catch((error: unknown) => {
      // A failed removal can be retried, and the exit guard keeps covering the container.
      this.#stopping = null;
      throw error;
    });
    return this.#stopping;
  }

  private async runReleaseHooks(): Promise<void> {
    for (const hook of this.#onRelease.splice(0)) {
      try {
        await hook();
      } catch {
        // Teardown continues: removing the container is what matters.
      }
    }
  }

  /** Keeps the token out of logs, `JSON.stringify` and `console.log`. */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      release: this.release,
      mode: this.mode,
      deadline: this.deadline,
      url: this.url,
      devices: this.#devices,
    };
  }

  toString(): string {
    return `Sandbox(${this.id}, ${this.release.release}, ${this.url})`;
  }

  [inspect.custom](): string {
    return this.toString();
  }

  private assertRunning(): void {
    if (this.#stopping !== null || this.#detached !== null) {
      throw new SandboxError(
        "instance_gone",
        `The sandbox ${this.id} was stopped.`,
      );
    }
  }
}

function assertEntityId(entityId: string): void {
  if (typeof entityId !== "string" || !ENTITY_ID.test(entityId)) {
    throw new TypeError(
      `"${String(entityId)}" is not an entity id such as light.hall.`,
    );
  }
}
