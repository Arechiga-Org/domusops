import { inspect } from "node:util";
import { SandboxError } from "../errors.js";
import type { ResolvedRelease } from "../release/versions.js";
import type { Runtime } from "../runtime/docker.js";
import type { Removal } from "../runtime/reaper.js";
import type { ConfigSummary, SandboxMode } from "../types.js";

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
  /** Run once, in order, when this process lets go of the instance: detach or stop. */
  onRelease?: (() => void | Promise<void>)[];
}

export class SandboxHandle implements Sandbox {
  readonly id: string;
  readonly release: ResolvedRelease;
  readonly mode: SandboxMode;
  readonly deadline: string;
  readonly url: string;
  readonly config: ConfigSummary | null;
  readonly reaped: readonly Removal[];
  readonly #token: string;
  readonly #wsUrl: string;
  readonly #containerId: string;
  readonly #runtime: Runtime;
  readonly #onRelease: (() => void | Promise<void>)[];
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
      await this.runReleaseHooks();
      await this.#runtime.remove(this.#containerId);
    })();
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
