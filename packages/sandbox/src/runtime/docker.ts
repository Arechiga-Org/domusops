import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { SandboxError } from "../errors.js";
import { LABEL_MARKER } from "./labels.js";

export const IMAGE_PREFIX = "ghcr.io/home-assistant/home-assistant";

export type RuntimeName = "docker" | "podman";

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ContainerInfo {
  /** The full container id. */
  id: string;
  name: string;
  labels: Record<string, string>;
  running: boolean;
}

export interface CreateSpec {
  name: string;
  image: string;
  labels: Record<string, string>;
  env: Record<string, string>;
  /** `host:container` publish specs, e.g. `127.0.0.1::8123`. */
  publish: string[];
  entrypoint: string;
  command: string[];
}

/** A runtime command that failed for a reason the caller did not anticipate. */
export class RuntimeCommandError extends Error {
  readonly status: number;
  constructor(command: string, result: ExecResult) {
    super(
      `\`${command}\` failed with exit code ${result.status}: ${
        result.stderr.trim() || result.stdout.trim() || "no output"
      }`,
    );
    this.name = "RuntimeCommandError";
    this.status = result.status;
  }
}

/** The most recent output of a container, kept for as long as the container is followed. */
export interface LogTail {
  /** The last lines seen, oldest first. */
  lines(): string[];
  /** Stops following. Idempotent; the lines stay readable. */
  stop(): void;
}

/** The container runtime, as far as the sandbox needs it. The only implementation that spawns. */
export interface Runtime {
  readonly name: RuntimeName;
  /** Throws `runtime_missing` when no runtime is installed or its daemon is not answering. */
  ensureAvailable(): Promise<void>;
  imageExists(image: string): Promise<boolean>;
  pull(image: string): Promise<ExecResult>;
  create(spec: CreateSpec): Promise<string>;
  /** Extracts a tar archive at the root of the container's filesystem. */
  copyIn(containerId: string, tar: Buffer): Promise<void>;
  start(containerId: string): Promise<void>;
  /** The host port published for `containerPort`. */
  hostPort(containerId: string, containerPort: number): Promise<number>;
  exec(
    containerId: string,
    argv: string[],
    options?: { input?: string },
  ): Promise<ExecResult>;
  /** Throws when the container no longer exists. */
  logs(containerId: string, tail: number): Promise<string>;
  /**
   * Follows the container's output from now on. A container started with `--rm` takes its logs
   * with it when it exits, so this is the only way to keep them for a start that failed.
   */
  followLogs(containerId: string, keep: number): LogTail;
  /** Containers carrying the sandbox marker label, and only those. */
  list(): Promise<ContainerInfo[]>;
  inspect(containerId: string): Promise<ContainerInfo | null>;
  /** Idempotent. */
  remove(containerId: string): Promise<void>;
  /** Blocking removal for `exit` handlers. Never throws. */
  removeSync(containerId: string): void;
}

function isOnPath(program: string): boolean {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    try {
      accessSync(join(dir, program), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/** `DOMUSOPS_CONTAINER` forces one; otherwise `docker`, then `podman`. */
export function detectRuntime(): RuntimeName | null {
  const override = process.env["DOMUSOPS_CONTAINER"];
  if (override === "docker" || override === "podman") return override;
  if (isOnPath("docker")) return "docker";
  if (isOnPath("podman")) return "podman";
  return null;
}

/** Exit status reported for a command that was stopped because it ran out of time. */
export const TIMED_OUT = 124;

/** A registry pull that makes no end is a failed start, not an endless one. */
export const DEFAULT_PULL_TIMEOUT_MS = 600_000;

function runCommand(
  program: string,
  args: string[],
  input?: Buffer | string,
  timeoutMs?: number,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (timer !== null) clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(
          new SandboxError(
            "runtime_missing",
            `\`${program}\` was not found on PATH. Install Docker (or Podman and set DOMUSOPS_CONTAINER=podman).`,
          ),
        );
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      const stderr = Buffer.concat(err).toString("utf8");
      resolve({
        status: timedOut ? TIMED_OUT : (code ?? 1),
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: timedOut
          ? `${stderr}${stderr === "" || stderr.endsWith("\n") ? "" : "\n"}timed out after ${String(Math.round((timeoutMs ?? 0) / 1000))} s`
          : stderr,
      });
    });
    // The child may exit before reading all input; that surfaces as its exit status.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

interface InspectJson {
  Id: string;
  Name: string;
  Config?: { Labels?: Record<string, string> | null };
  State?: { Running?: boolean };
}

function toInfo(raw: InspectJson): ContainerInfo {
  return {
    id: raw.Id,
    name: raw.Name.replace(/^\//, ""),
    labels: { ...(raw.Config?.Labels ?? {}) },
    running: raw.State?.Running === true,
  };
}

export function createRuntime(
  options: { pullTimeoutMs?: number } = {},
): Runtime {
  const pullTimeoutMs = options.pullTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS;
  const name = detectRuntime();
  const program: RuntimeName = name ?? "docker";

  async function run(
    args: string[],
    input?: Buffer | string,
  ): Promise<ExecResult> {
    return runCommand(program, args, input);
  }

  async function mustRun(
    args: string[],
    input?: Buffer | string,
  ): Promise<ExecResult> {
    const result = await run(args, input);
    if (result.status !== 0) {
      throw new RuntimeCommandError(`${program} ${args[0] ?? ""}`, result);
    }
    return result;
  }

  return {
    name: program,

    async ensureAvailable() {
      if (name === null) {
        throw new SandboxError(
          "runtime_missing",
          "Neither docker nor podman was found on PATH. Install Docker (or Podman and set DOMUSOPS_CONTAINER=podman).",
        );
      }
      const result = await run(["version", "--format", "{{.Server.Version}}"]);
      if (result.status !== 0) {
        throw new SandboxError(
          "runtime_missing",
          `\`${program}\` is installed but its daemon is not answering. Start it and try again.`,
        );
      }
    },

    async imageExists(image) {
      const result = await run([
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        image,
      ]);
      return result.status === 0;
    },

    pull(image) {
      return runCommand(program, ["pull", "--quiet", image], undefined, pullTimeoutMs);
    },

    async create(spec) {
      const args = [
        "create",
        "--rm",
        "--init",
        "--name",
        spec.name,
        "--entrypoint",
        spec.entrypoint,
      ];
      for (const [key, value] of Object.entries(spec.labels)) {
        args.push("--label", `${key}=${value}`);
      }
      for (const [key, value] of Object.entries(spec.env)) {
        args.push("--env", `${key}=${value}`);
      }
      for (const publish of spec.publish) args.push("--publish", publish);
      args.push(spec.image, ...spec.command);
      const result = await mustRun(args);
      return result.stdout.trim();
    },

    async copyIn(containerId, tar) {
      await mustRun(["cp", "-", `${containerId}:/`], tar);
    },

    async start(containerId) {
      await mustRun(["start", containerId]);
    },

    async hostPort(containerId, containerPort) {
      const result = await mustRun([
        "port",
        containerId,
        `${containerPort}/tcp`,
      ]);
      for (const line of result.stdout.split("\n")) {
        const match = /:(\d+)\s*$/.exec(line);
        if (match?.[1] !== undefined) return Number(match[1]);
      }
      throw new Error(
        `no host port is published for ${containerPort}/tcp: ${result.stdout.trim()}`,
      );
    },

    exec(containerId, argv, options = {}) {
      const args = ["exec"];
      if (options.input !== undefined) args.push("--interactive");
      args.push(containerId, ...argv);
      return run(args, options.input);
    },

    async logs(containerId, tail) {
      const result = await run(["logs", "--tail", String(tail), containerId]);
      if (result.status !== 0) {
        throw new RuntimeCommandError(`${program} logs`, result);
      }
      return result.stdout + result.stderr;
    },

    followLogs(containerId, keep) {
      const kept: string[] = [];
      let partial = "";
      const child = spawn(
        program,
        ["logs", "--follow", "--tail", String(keep), containerId],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const take = (chunk: Buffer): void => {
        const parts = (partial + chunk.toString("utf8")).split("\n");
        partial = parts.pop() ?? "";
        for (const line of parts) {
          if (line !== "") kept.push(line);
        }
        if (kept.length > keep) kept.splice(0, kept.length - keep);
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      // Best effort: a missing log tail must never fail a start.
      child.on("error", () => undefined);
      return {
        lines: () => (partial === "" ? [...kept] : [...kept, partial]),
        stop: () => {
          child.kill();
        },
      };
    },

    async list() {
      const ids = await mustRun([
        "container",
        "ls",
        "--all",
        "--no-trunc",
        "--quiet",
        "--filter",
        `label=${LABEL_MARKER}=1`,
      ]);
      const wanted = ids.stdout
        .split("\n")
        .filter((line) => line.trim() !== "");
      if (wanted.length === 0) return [];
      const inspected = await run(["container", "inspect", ...wanted]);
      // A container removed between the two calls makes inspect exit non-zero but still
      // print the ones it found.
      const parsed = JSON.parse(inspected.stdout || "[]") as InspectJson[];
      return parsed
        .map(toInfo)
        .filter((info) => info.labels[LABEL_MARKER] === "1");
    },

    async inspect(containerId) {
      const result = await run(["container", "inspect", containerId]);
      if (result.status !== 0) return null;
      const parsed = JSON.parse(result.stdout) as InspectJson[];
      const first = parsed[0];
      return first === undefined ? null : toInfo(first);
    },

    async remove(containerId) {
      const result = await run(["container", "rm", "--force", containerId]);
      // Gone, or already on its way out (`--rm` after the instance exited): either way the goal is met.
      if (
        result.status !== 0 &&
        !/no such container|already in progress/i.test(result.stderr)
      ) {
        throw new RuntimeCommandError(`${program} container rm`, result);
      }
    },

    removeSync(containerId) {
      try {
        spawnSync(program, ["container", "rm", "--force", containerId], {
          stdio: "ignore",
          timeout: 15_000,
        });
      } catch {
        // nothing more can be done from an exit handler
      }
    },
  };
}
