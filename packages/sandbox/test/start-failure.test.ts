import { describe, expect, it } from "vitest";
import { SandboxError } from "../src/errors.js";
import { SandboxHandle } from "../src/instance/handle.js";
import { waitForHttp } from "../src/instance/ready.js";
import { startSandboxWith } from "../src/instance/start.js";
import { RuntimeCommandError } from "../src/runtime/docker.js";
import { FakeRuntime } from "./support/fake-runtime.js";

class FlakyRuntime extends FakeRuntime {
  createError: Error | null = null;
  startError: Error | null = null;
  removeFailures = 0;

  override async create(
    spec: Parameters<FakeRuntime["create"]>[0],
  ): Promise<string> {
    if (this.createError !== null) throw this.createError;
    return super.create(spec);
  }

  override async start(containerId: string): Promise<void> {
    if (this.startError !== null) throw this.startError;
    return super.start(containerId);
  }

  override async remove(containerId: string): Promise<void> {
    if (this.removeFailures > 0) {
      this.removeFailures -= 1;
      this.calls.push(`remove-failed ${containerId}`);
      throw new RuntimeCommandError("docker container rm", {
        status: 1,
        stdout: "",
        stderr: "daemon hiccup",
      });
    }
    return super.remove(containerId);
  }
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the start to fail");
}

const START = { release: "2026.9.3" } as const;

describe("a start that fails", () => {
  it("reports a runtime failure while creating as a typed error", async () => {
    const runtime = new FlakyRuntime();
    runtime.createError = new RuntimeCommandError("docker create", {
      status: 125,
      stdout: "",
      stderr: "name already in use",
    });
    const error = await failureOf(startSandboxWith(runtime, START));
    expect(error).toBeInstanceOf(SandboxError);
    expect((error as SandboxError).code).toBe("not_ready");
    expect((error as SandboxError).message).toContain("name already in use");
  });

  it("reports a runtime failure while starting as a typed error and removes the container", async () => {
    const runtime = new FlakyRuntime();
    runtime.startError = new Error("port is already allocated");
    const error = await failureOf(startSandboxWith(runtime, START));
    expect((error as SandboxError).code).toBe("not_ready");
    expect((error as SandboxError).message).toBe("port is already allocated");
    expect(runtime.containers.size).toBe(0);
  });

  it("keeps the start error when the cleanup removal fails too", async () => {
    const runtime = new FlakyRuntime();
    runtime.startError = new Error("port is already allocated");
    runtime.removeFailures = 1;
    const error = await failureOf(startSandboxWith(runtime, START));
    expect((error as SandboxError).code).toBe("not_ready");
    expect((error as SandboxError).message).toBe("port is already allocated");
    expect(runtime.calls.some((c) => c.startsWith("remove-failed"))).toBe(true);
  });

  it("cleans up even when the progress callback throws", async () => {
    const runtime = new FlakyRuntime();
    runtime.startError = new Error("boom");
    const error = await failureOf(
      startSandboxWith(runtime, {
        ...START,
        onProgress: () => {
          throw new Error("callback bug");
        },
      }),
    );
    expect((error as SandboxError).message).toBe("boom");
    expect(runtime.containers.size).toBe(0);
  });
});

describe("the image", () => {
  it("is used from the local copy without asking the registry", async () => {
    const runtime = new FlakyRuntime();
    runtime.images.add("ghcr.io/home-assistant/home-assistant:2026.9.3");
    runtime.pullFails = true;
    runtime.startError = new Error("boom");
    const states: string[] = [];
    await failureOf(
      startSandboxWith(runtime, {
        ...START,
        onProgress: (state) => void states.push(state),
      }),
    );
    expect(runtime.calls.some((c) => c.startsWith("pull "))).toBe(false);
    expect(states).not.toContain("pulling");
  });

  it("is pulled when no copy is present", async () => {
    const runtime = new FlakyRuntime();
    runtime.startError = new Error("boom");
    await failureOf(startSandboxWith(runtime, START));
    expect(runtime.calls.some((c) => c.startsWith("pull "))).toBe(true);
  });
});

describe("progress", () => {
  it("reports failed when the start fails before a container exists", async () => {
    const runtime = new FlakyRuntime();
    runtime.pullFails = true;
    const states: string[] = [];
    const error = await failureOf(
      startSandboxWith(runtime, {
        ...START,
        onProgress: (state) => void states.push(state),
      }),
    );
    expect((error as SandboxError).code).toBe("image_unavailable");
    expect(states).toEqual(["resolving", "pulling", "failed"]);
    expect(runtime.calls.some((c) => c.startsWith("create"))).toBe(false);
  });

  it("reports failed exactly once when the start fails after the container exists", async () => {
    const runtime = new FlakyRuntime();
    runtime.startError = new Error("boom");
    const states: string[] = [];
    await failureOf(
      startSandboxWith(runtime, {
        ...START,
        onProgress: (state) => void states.push(state),
      }),
    );
    expect(states.filter((state) => state === "failed")).toHaveLength(1);
    expect(states.at(-1)).toBe("failed");
  });
});

describe("not_ready logs", () => {
  it("come from the followed output once the container is gone", async () => {
    const runtime = new FlakyRuntime();
    runtime.logsFail = true;
    const lines = Array.from({ length: 80 }, (_, i) => `line ${String(i)}`);
    runtime.followedLines = lines;
    const error = (await failureOf(
      waitForHttp("http://127.0.0.1:1", {
        runtime,
        containerId: "f".repeat(64),
        deadline: Date.now() + 60_000,
        tail: runtime.followLogs("f".repeat(64), 50),
      }),
    )) as SandboxError;
    expect(error.code).toBe("not_ready");
    expect(error.logs).toEqual(lines.slice(-50));
  });
});

describe("stopping a sandbox", () => {
  function handle(
    runtime: FlakyRuntime,
    events: string[],
    states: string[] = [],
  ): SandboxHandle {
    const containerId = runtime.addSandbox("domusops-sandbox-0123456789ab", {});
    return new SandboxHandle({
      id: "0123456789ab",
      containerId,
      release: { channel: "exact", release: "2026.9.3", beta: false },
      mode: "tied",
      deadline: "2026-10-06T14:00:00.000Z",
      port: 49000,
      token: "t".repeat(40),
      config: null,
      runtime,
      onRelease: [() => void events.push("hooks")],
      releaseGuard: () => void events.push("guard released"),
      onProgress: (state) => void states.push(state),
    });
  }

  it("releases the exit guard only after the container is removed", async () => {
    const runtime = new FlakyRuntime();
    const events: string[] = [];
    await handle(runtime, events).stop();
    expect(events).toEqual(["hooks", "guard released"]);
    expect(runtime.containers.size).toBe(0);
  });

  it("keeps the guard and allows a retry when the removal fails", async () => {
    const runtime = new FlakyRuntime();
    runtime.removeFailures = 1;
    const events: string[] = [];
    const sandbox = handle(runtime, events);
    await expect(sandbox.stop()).rejects.toBeInstanceOf(RuntimeCommandError);
    expect(events).toEqual(["hooks"]);
    expect(runtime.containers.size).toBe(1);
    await sandbox.stop();
    expect(events).toEqual(["hooks", "guard released"]);
    expect(runtime.containers.size).toBe(0);
  });

  it("reports stopping, then gone once the container is removed", async () => {
    const runtime = new FlakyRuntime();
    const states: string[] = [];
    await handle(runtime, [], states).stop();
    expect(states).toEqual(["stopping", "gone"]);
  });

  it("does not report gone while the container is still there", async () => {
    const runtime = new FlakyRuntime();
    runtime.removeFailures = 1;
    const states: string[] = [];
    await expect(handle(runtime, [], states).stop()).rejects.toThrow();
    expect(states).toEqual(["stopping"]);
  });
});
