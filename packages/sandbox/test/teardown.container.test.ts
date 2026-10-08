import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SandboxError } from "../src/errors.js";
import type { Sandbox } from "../src/instance/handle.js";
import {
  attachSandbox,
  listSandboxes,
  startSandbox,
  stopSandbox,
} from "../src/index.js";
import type { StartOptions } from "../src/instance/start.js";
import { IMAGE_PREFIX } from "../src/runtime/docker.js";
import { CHANNELS, startTarget } from "./support/channels.js";

const MINUTE = 60_000;
const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const PAIRS = Math.max(1, Number(process.env["DOMUSOPS_SANDBOX_PAIRS"] ?? "1"));

function target(): Pick<StartOptions, "channel" | "release"> {
  return startTarget(CHANNELS[0] ?? "stable");
}

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function containersWith(...filters: string[]): string[] {
  const args = ["ps", "-a", "-q"];
  for (const filter of filters) args.push("--filter", filter);
  return docker(...args)
    .split("\n")
    .filter((line) => line !== "");
}

const byId = (id: string): string[] =>
  containersWith(`label=io.domusops.sandbox.id=${id}`);

async function waitUntil(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs = 500,
): Promise<number> {
  const began = Date.now();
  while (!condition()) {
    if (Date.now() - began > timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return Date.now() - began;
}

async function ok(sandbox: Sandbox): Promise<boolean> {
  const { url, token } = sandbox.connection();
  const response = await fetch(`${url}/api/config`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return response.status === 200;
}

interface Child {
  process: ChildProcess;
  stderr: () => string;
  exited: Promise<number | null>;
}

function spawnCli(args: string[]): Child {
  const child = spawn(process.execPath, [CLI, ...args], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let text = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
  });
  return { process: child, stderr: () => text, exited };
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

describe("teardown", () => {
  it(
    "leaves no container behind after a normal stop",
    async () => {
      const sandbox = await startSandbox(target());
      expect(byId(sandbox.id)).toHaveLength(1);
      await sandbox.stop();
      await sandbox.stop();
      expect(byId(sandbox.id)).toHaveLength(0);
      expect(containersWith(`name=domusops-sandbox-${sandbox.id}`)).toEqual([]);
      expect(
        docker(
          "volume",
          "ls",
          "-q",
          "--filter",
          "dangling=true",
          "--filter",
          `label=io.domusops.sandbox.id=${sandbox.id}`,
        ),
      ).toBe("");
    },
    5 * MINUTE,
  );

  it(
    "removes the container within 25 s of the owner dying with kill -9",
    async () => {
      const args = ["start", "--json"];
      const t = target();
      if (t.release !== undefined) args.push("--release", t.release);
      else if (t.channel !== undefined) args.push("--channel", t.channel);
      const child = spawnCli([...args, "--", "sleep", "600"]);
      try {
        await waitUntil(
          () => /"id":"[0-9a-f]{12}"/.test(child.stderr()),
          4 * MINUTE,
        );
        const id = /"id":"([0-9a-f]{12})"/.exec(child.stderr())?.[1] ?? "";
        expect(byId(id)).toHaveLength(1);

        killGroup(child.process, "SIGKILL");
        const took = await waitUntil(() => byId(id).length === 0, 60_000);
        console.info(`owner kill -9 to container gone: ${took} ms`);
        expect(took).toBeLessThanOrEqual(25_000);
      } finally {
        killGroup(child.process, "SIGKILL");
      }
    },
    6 * MINUTE,
  );

  it(
    "removes a background instance at its deadline, and attach/detach/stop work before that",
    async () => {
      const sandbox = await startSandbox({
        ...target(),
        mode: "background",
        maxLifetimeMinutes: 1,
      });
      const began = Date.now();
      await sandbox.detach();
      expect(() => sandbox.connection()).toThrow(SandboxError);
      expect(byId(sandbox.id)).toHaveLength(1);

      const listed = await listSandboxes();
      expect(listed.map((l) => l.id)).toContain(sandbox.id);

      const again = await attachSandbox(sandbox.id);
      expect(again.mode).toBe("background");
      expect(await ok(again)).toBe(true);

      await waitUntil(() => byId(sandbox.id).length === 0, 3 * MINUTE);
      console.info(`1-minute deadline: gone after ${Date.now() - began} ms`);
      await expect(attachSandbox(sandbox.id)).rejects.toMatchObject({
        code: "instance_gone",
      });
    },
    6 * MINUTE,
  );

  it(
    "stops a background instance by id, idempotently, and refuses foreign containers",
    async () => {
      const sandbox = await startSandbox({ ...target(), mode: "background" });
      const foreign = docker(
        "create",
        "--entrypoint",
        "sleep",
        `${IMAGE_PREFIX}:${sandbox.release.release}`,
        "600",
      ).slice(0, 12);
      try {
        await sandbox.detach();
        await expect(stopSandbox(foreign)).rejects.toMatchObject({
          code: "not_a_sandbox",
        });
        await expect(stopSandbox("not-an-id")).rejects.toMatchObject({
          code: "not_a_sandbox",
        });
        await expect(attachSandbox(foreign)).rejects.toMatchObject({
          code: "not_a_sandbox",
        });
        expect(containersWith(`id=${foreign}`)).toHaveLength(1);

        await stopSandbox(sandbox.id);
        await stopSandbox(sandbox.id);
        expect(byId(sandbox.id)).toHaveLength(0);
      } finally {
        docker("rm", "-f", foreign);
        await stopSandbox(sandbox.id).catch(() => undefined);
      }
    },
    6 * MINUTE,
  );

  it(
    `starts ${String(PAIRS)} concurrent pair(s) on different ports without interference`,
    async () => {
      const pairs = await Promise.all(
        Array.from({ length: PAIRS }, async () => {
          const [a, b] = await Promise.all([
            startSandbox(target()),
            startSandbox(target()),
          ]);
          return { a, b };
        }),
      );
      try {
        const ports = pairs.flatMap(({ a, b }) => [a.url, b.url]);
        expect(new Set(ports).size).toBe(ports.length);
        for (const { a, b } of pairs) {
          await a.stop();
          expect(await ok(b)).toBe(true);
        }
      } finally {
        await Promise.all(pairs.flatMap(({ a, b }) => [a.stop(), b.stop()]));
      }
      for (const { a, b } of pairs) {
        expect(byId(a.id)).toHaveLength(0);
        expect(byId(b.id)).toHaveLength(0);
      }
    },
    10 * MINUTE,
  );

  it(
    "leaves no container when interrupted with SIGINT during startup",
    async () => {
      const args = ["start"];
      const t = target();
      if (t.release !== undefined) args.push("--release", t.release);
      else if (t.channel !== undefined) args.push("--channel", t.channel);
      const child = spawnCli([...args, "--", "sleep", "600"]);
      try {
        await waitUntil(
          () => child.stderr().includes("starting"),
          4 * MINUTE,
          100,
        );
        const pid = child.process.pid ?? 0;
        expect(
          containersWith(`label=io.domusops.sandbox.owner-pid=${String(pid)}`),
        ).toHaveLength(1);
        killGroup(child.process, "SIGINT");
        await child.exited;
        expect(
          containersWith(`label=io.domusops.sandbox.owner-pid=${String(pid)}`),
        ).toEqual([]);
      } finally {
        killGroup(child.process, "SIGKILL");
      }
    },
    6 * MINUTE,
  );
});
