import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxError } from "../src/errors.js";
import { HaSocket, WsAuthError, WsConnectionError } from "../src/ha/ws.js";
import { waitForRunning, withLogs } from "../src/instance/ready.js";
import { FakeRuntime } from "./support/fake-runtime.js";

const postJson = vi.hoisted(() => vi.fn());
vi.mock("../src/ha/rest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ha/rest.js")>()),
  postJson,
}));

const TOKEN = "t".repeat(40);

function context(deadline: number) {
  const runtime = new FakeRuntime();
  const containerId = runtime.addSandbox("domusops-sandbox-0123456789ab", {});
  return { runtime, containerId, deadline };
}

function running(commands: unknown[] = []) {
  const command = vi.fn(async (_payload: unknown, timeoutMs?: number) => {
    commands.push(timeoutMs);
    return { state: "RUNNING" };
  });
  return { command, close: vi.fn() } as unknown as HaSocket;
}

async function failureOf(promise: Promise<unknown>): Promise<SandboxError> {
  try {
    await promise;
  } catch (error) {
    return error as SandboxError;
  }
  throw new Error("expected the wait to fail");
}

afterEach(() => {
  vi.restoreAllMocks();
  postJson.mockReset();
});

describe("waitForRunning", () => {
  it("fails at once when the instance rejects the token it issued", async () => {
    const connect = vi
      .spyOn(HaSocket, "connect")
      .mockRejectedValue(
        new WsAuthError("The instance rejected the access token."),
      );
    const started = Date.now();
    const error = await failureOf(
      waitForRunning(
        "http://127.0.0.1:1",
        "ws://127.0.0.1:1/api/websocket",
        TOKEN,
        context(Date.now() + 60_000),
      ),
    );
    expect(error.code).toBe("not_ready");
    expect(error.message).toContain("rejected the access token");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("keeps retrying a connection that merely fails, until the limit", async () => {
    const connect = vi
      .spyOn(HaSocket, "connect")
      .mockRejectedValue(new WsConnectionError("not up yet"));
    const error = await failureOf(
      waitForRunning(
        "http://127.0.0.1:1",
        "ws://127.0.0.1:1/api/websocket",
        TOKEN,
        context(Date.now() - 1),
      ),
    );
    expect(error.message).toContain("readiness limit");
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("cuts every operation down to the time left before the limit", async () => {
    const connect = vi.spyOn(HaSocket, "connect").mockResolvedValue(running());
    const commandTimeouts: unknown[] = [];
    connect.mockResolvedValue(running(commandTimeouts));
    postJson.mockResolvedValue({ result: "valid" });

    await waitForRunning(
      "http://127.0.0.1:1",
      "ws://127.0.0.1:1/api/websocket",
      TOKEN,
      context(Date.now() + 5_000),
    );

    const connectTimeout = connect.mock.calls[0]?.[2]?.connectTimeoutMs ?? 1e9;
    expect(connectTimeout).toBeLessThanOrEqual(5_000);
    expect(commandTimeouts[0]).toBeLessThanOrEqual(5_000);
  });

  it("gives the configuration check a fair chance even when the limit has nearly passed", async () => {
    vi.spyOn(HaSocket, "connect").mockResolvedValue(running());
    postJson.mockResolvedValue({ result: "valid" });

    await waitForRunning(
      "http://127.0.0.1:1",
      "ws://127.0.0.1:1/api/websocket",
      TOKEN,
      context(Date.now() + 200),
    );

    const checkTimeout = (postJson.mock.calls[0]?.[3] as { timeoutMs: number })
      .timeoutMs;
    expect(checkTimeout).toBe(15_000);
  });

  it("keeps the usual limits when there is plenty of time", async () => {
    const connect = vi.spyOn(HaSocket, "connect");
    const commandTimeouts: unknown[] = [];
    connect.mockResolvedValue(running(commandTimeouts));
    postJson.mockResolvedValue({ result: "valid" });

    await waitForRunning(
      "http://127.0.0.1:1",
      "ws://127.0.0.1:1/api/websocket",
      TOKEN,
      context(Date.now() + 150_000),
    );

    expect(connect.mock.calls[0]?.[2]?.connectTimeoutMs).toBe(10_000);
    expect(commandTimeouts[0]).toBe(30_000);
    expect(
      (postJson.mock.calls[0]?.[3] as { timeoutMs: number }).timeoutMs,
    ).toBe(60_000);
  });

  it("reports a configuration check that cannot finish as not ready, with the reason", async () => {
    vi.spyOn(HaSocket, "connect").mockResolvedValue(running());
    postJson.mockRejectedValue(
      new Error("The operation was aborted due to timeout"),
    );
    const error = await failureOf(
      waitForRunning(
        "http://127.0.0.1:1",
        "ws://127.0.0.1:1/api/websocket",
        TOKEN,
        context(Date.now() + 60_000),
      ),
    );
    expect(error.code).toBe("not_ready");
    expect(error.message).toContain("aborted due to timeout");
  });

  it("still reports an invalid configuration as config_invalid", async () => {
    vi.spyOn(HaSocket, "connect").mockResolvedValue(running());
    postJson.mockResolvedValue({ result: "invalid", errors: "bad yaml" });
    const error = await failureOf(
      waitForRunning(
        "http://127.0.0.1:1",
        "ws://127.0.0.1:1/api/websocket",
        TOKEN,
        context(Date.now() + 60_000),
      ),
    );
    expect(error.code).toBe("config_invalid");
  });
});

describe("an instance in recovery or safe mode", () => {
  function inMode(flag: "recovery_mode" | "safe_mode") {
    const command = vi.fn(async () => ({ state: "NOT_RUNNING", [flag]: true }));
    return { command, close: vi.fn() } as unknown as HaSocket;
  }
  const wait = () =>
    waitForRunning(
      "http://127.0.0.1:1",
      "ws://127.0.0.1:1/api/websocket",
      TOKEN,
      context(Date.now() + 60_000),
    );

  it.each(["recovery_mode", "safe_mode"] as const)(
    "is reported as config_invalid when %s and the check finds errors",
    async (flag) => {
      vi.spyOn(HaSocket, "connect").mockResolvedValue(inMode(flag));
      postJson.mockResolvedValue({
        result: "invalid",
        errors: "Invalid config for [light]",
      });
      const error = await failureOf(wait());
      expect(error.code).toBe("config_invalid");
      expect(error.message).toContain("Invalid config for [light]");
    },
  );

  it("stays not_ready when the check finds nothing wrong", async () => {
    vi.spyOn(HaSocket, "connect").mockResolvedValue(inMode("recovery_mode"));
    postJson.mockResolvedValue({ result: "valid" });
    const error = await failureOf(wait());
    expect(error.code).toBe("not_ready");
    expect(error.message).toContain("recovery or safe mode");
  });

  it("stays not_ready when the check cannot be made", async () => {
    vi.spyOn(HaSocket, "connect").mockResolvedValue(inMode("safe_mode"));
    postJson.mockRejectedValue(new Error("connection refused"));
    const error = await failureOf(wait());
    expect(error.code).toBe("not_ready");
    expect(error.message).toContain("connection refused");
  });
});

describe("withLogs", () => {
  it("adds the instance output to a failed step", async () => {
    const base = context(Date.now() + 60_000);
    const tail = {
      lines: () => ["line a", "line b"],
      stop: () => undefined,
    };
    const error = await withLogs(
      { ...base, tail },
      new SandboxError("not_ready", "Onboarding the instance failed: boom"),
    );
    expect(error.code).toBe("not_ready");
    expect(error.message).toContain("boom");
    expect(error.logs).toEqual(["line a", "line b"]);
  });

  it("leaves other typed errors as they are", async () => {
    const original = new SandboxError("config_invalid", "bad");
    expect(await withLogs(context(Date.now()), original)).toBe(original);
  });
});
