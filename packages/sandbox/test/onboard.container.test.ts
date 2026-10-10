import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { HaSocket } from "../src/ha/ws.js";
import { SandboxError } from "../src/errors.js";
import type { Sandbox } from "../src/instance/handle.js";
import { startSandbox } from "../src/index.js";
import { createRuntime } from "../src/runtime/docker.js";
import { containerName } from "../src/runtime/labels.js";
import { CHANNELS, startTarget } from "./support/channels.js";
import { leftBehind } from "./support/containers.js";

const runtime = createRuntime();
const MINUTE = 60_000;

async function startOrSkip(
  channel: (typeof CHANNELS)[number],
  readinessTimeoutSeconds = 150,
): Promise<Sandbox | null> {
  try {
    return await startSandbox({
      ...startTarget(channel),
      readinessTimeoutSeconds,
    });
  } catch (error) {
    if (error instanceof SandboxError && error.code === "no_beta_in_progress") {
      return null;
    }
    throw error;
  }
}

describe.each(CHANNELS)("onboarding on %s", (channel) => {
  it(
    "is ready with a known admin token, loopback only",
    async () => {
      const began = Date.now();
      const sandbox = await startOrSkip(channel);
      if (sandbox === null) return;
      try {
        // SC-001 counts from a present image; the first pull is not part of it.
        console.info(
          `${channel}: ${sandbox.release.release} in ${Date.now() - began} ms`,
        );
        const { url, wsUrl, token } = sandbox.connection();

        const config = await fetch(`${url}/api/config`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(config.status).toBe(200);
        const body = (await config.json()) as {
          state?: string;
          version?: string;
        };
        expect(body.state).toBe("RUNNING");
        expect(body.version).toBe(sandbox.release.release);

        const anonymous = await fetch(`${url}/api/config`);
        expect(anonymous.status).toBe(401);

        const socket = await HaSocket.connect(wsUrl, token);
        const user = await socket.command<{ is_admin: boolean }>({
          type: "auth/current_user",
        });
        expect(user.is_admin).toBe(true);
        socket.close();

        const published = execFileSync(
          runtime.name,
          ["port", containerName(sandbox.id), "8123"],
          { encoding: "utf8" },
        );
        for (const line of published.trim().split("\n")) {
          expect(line.startsWith("127.0.0.1:")).toBe(true);
        }
      } finally {
        await sandbox.stop();
      }
      expect(await runtime.inspect(containerName(sandbox.id))).toBeNull();
    },
    8 * MINUTE,
  );
});

describe("failure paths", () => {
  it(
    "reports not_ready with at most 50 log lines and removes the container",
    async () => {
      const before = await runtime.list();
      let caught: unknown;
      try {
        await startSandbox({
          ...startTarget("stable"),
          readinessTimeoutSeconds: 3,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SandboxError);
      const error = caught as SandboxError;
      expect(error.code).toBe("not_ready");
      expect((error.logs ?? []).length).toBeLessThanOrEqual(50);
      expect(await leftBehind(runtime, before)).toEqual([]);
    },
    5 * MINUTE,
  );

  it(
    "removes the container when Home Assistant stops (R1: --init with --entrypoint python)",
    async () => {
      const sandbox = await startSandbox({ ...startTarget("stable") });
      const name = containerName(sandbox.id);
      try {
        const { wsUrl, token } = sandbox.connection();
        const socket = await HaSocket.connect(wsUrl, token);
        await socket
          .command({
            type: "call_service",
            domain: "homeassistant",
            service: "stop",
          })
          .catch(() => undefined);
        socket.close();
        const limit = Date.now() + 90_000;
        while ((await runtime.inspect(name)) !== null && Date.now() < limit) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        expect(await runtime.inspect(name)).toBeNull();
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );
});
