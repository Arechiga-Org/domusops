import { describe, expect, it } from "vitest";
import { reap } from "../src/runtime/reaper.js";
import { buildLabels, type SandboxLabels } from "../src/runtime/labels.js";
import { FakeRuntime } from "./support/fake-runtime.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const HOST = "this-host";

function labels(overrides: Partial<SandboxLabels>): Record<string, string> {
  return buildLabels({
    id: "0123456789ab",
    mode: "tied",
    deadline: "2026-10-06T14:00:00.000Z",
    owner: { host: HOST, pid: 4242 },
    release: "2026.10.1",
    ...overrides,
  });
}

function options(alive: number[] = []) {
  return {
    now: () => NOW,
    host: HOST,
    isAlive: (pid: number) => alive.includes(pid),
  };
}

describe("reap", () => {
  it("removes an instance whose deadline has passed, whoever owns it", async () => {
    const runtime = new FakeRuntime();
    const id = runtime.addSandbox(
      "a",
      labels({ deadline: "2026-10-06T11:59:59.000Z" }),
    );
    const removed = await reap(runtime, options([4242]));
    expect(removed).toEqual([
      { id: "0123456789ab", containerId: id, reason: "deadline passed" },
    ]);
    expect(runtime.removed()).toEqual([id]);
  });

  it("removes a tied instance on this host whose owner is gone", async () => {
    const runtime = new FakeRuntime();
    const id = runtime.addSandbox("a", labels({}));
    const removed = await reap(runtime, options());
    expect(removed.map((r) => r.reason)).toEqual(["owner process gone"]);
    expect(runtime.removed()).toEqual([id]);
  });

  it("keeps a tied instance whose owner is alive", async () => {
    const runtime = new FakeRuntime();
    runtime.addSandbox("a", labels({}));
    expect(await reap(runtime, options([4242]))).toEqual([]);
    expect(runtime.removed()).toEqual([]);
  });

  it("keeps a tied instance owned from another host", async () => {
    const runtime = new FakeRuntime();
    runtime.addSandbox(
      "a",
      labels({ owner: { host: "other-host", pid: 4242 } }),
    );
    expect(await reap(runtime, options())).toEqual([]);
  });

  it("keeps a background instance before its deadline", async () => {
    const runtime = new FakeRuntime();
    runtime.addSandbox("a", labels({ mode: "background", owner: null }));
    expect(await reap(runtime, options())).toEqual([]);
  });

  it("never touches a container without the sandbox marker", async () => {
    const runtime = new FakeRuntime();
    runtime.addForeign("db", {
      "io.domusops.sandbox.deadline": "2000-01-01T00:00:00.000Z",
    });
    runtime.addForeign("web");
    expect(await reap(runtime, options())).toEqual([]);
    expect(runtime.calls.filter((c) => c.startsWith("inspect"))).toEqual([]);
    expect(runtime.removed()).toEqual([]);
  });

  it("never touches a marked container with malformed labels", async () => {
    const runtime = new FakeRuntime();
    runtime.addSandbox("a", { "io.domusops.sandbox.id": "nothex" });
    expect(await reap(runtime, options())).toEqual([]);
    expect(runtime.removed()).toEqual([]);
  });

  it("keeps going when one removal fails", async () => {
    const runtime = new FakeRuntime();
    const first = runtime.addSandbox("a", labels({ id: "aaaaaaaaaaaa" }));
    const second = runtime.addSandbox("b", labels({ id: "bbbbbbbbbbbb" }));
    const original = runtime.remove.bind(runtime);
    runtime.remove = async (containerId: string) => {
      if (containerId === first) throw new Error("busy");
      await original(containerId);
    };
    const removed = await reap(runtime, options());
    expect(removed.map((r) => r.containerId)).toEqual([second]);
  });
});
