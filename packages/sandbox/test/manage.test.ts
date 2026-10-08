import { describe, expect, it } from "vitest";
import { listSandboxes } from "../src/instance/list.js";
import { stopSandboxWith } from "../src/instance/manage.js";
import {
  buildLabels,
  containerName,
  type SandboxLabels,
} from "../src/runtime/labels.js";
import { FakeRuntime } from "./support/fake-runtime.js";

const ID = "0123456789ab";

function labels(id: string): SandboxLabels {
  return {
    id,
    mode: "background",
    deadline: "2099-01-01T00:00:00.000Z",
    owner: null,
    release: "2026.9.3",
  };
}

function sandbox(runtime: FakeRuntime, id: string): string {
  return runtime.addSandbox(containerName(id), buildLabels(labels(id)));
}

describe("stopSandboxWith", () => {
  it("finds the instance by its name, without listing every container", async () => {
    const runtime = new FakeRuntime();
    const containerId = sandbox(runtime, ID);
    sandbox(runtime, "aaaaaaaaaaaa");
    await stopSandboxWith(runtime, ID);
    expect(runtime.removed()).toEqual([containerId]);
    expect(runtime.calls).not.toContain("list");
    expect(runtime.calls).toContain(`inspect ${containerName(ID)}`);
  });

  it("does nothing for an id that is gone", async () => {
    const runtime = new FakeRuntime();
    await stopSandboxWith(runtime, ID);
    expect(runtime.removed()).toEqual([]);
  });

  it("refuses a container that has the name but not the labels", async () => {
    const runtime = new FakeRuntime();
    runtime.addForeign(containerName(ID));
    await expect(stopSandboxWith(runtime, ID)).rejects.toMatchObject({
      code: "not_a_sandbox",
    });
    expect(runtime.removed()).toEqual([]);
  });

  it("refuses a name that carries another instance's labels", async () => {
    const runtime = new FakeRuntime();
    runtime.addSandbox(containerName(ID), buildLabels(labels("aaaaaaaaaaaa")));
    await expect(stopSandboxWith(runtime, ID)).rejects.toMatchObject({
      code: "not_a_sandbox",
    });
    expect(runtime.removed()).toEqual([]);
  });

  it("refuses anything that is not an instance id", async () => {
    const runtime = new FakeRuntime();
    await expect(stopSandboxWith(runtime, "--all")).rejects.toMatchObject({
      code: "not_a_sandbox",
    });
  });
});

describe("listSandboxes", () => {
  it("lists labelled containers in order, with their URLs", async () => {
    const runtime = new FakeRuntime();
    sandbox(runtime, "aaaaaaaaaaaa");
    runtime.addForeign("someone-elses");
    sandbox(runtime, "bbbbbbbbbbbb");
    const listings = await listSandboxes(runtime);
    expect(listings.map((l) => l.id)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(listings.every((l) => l.url?.startsWith("http://127.0.0.1:"))).toBe(
      true,
    );
  });

  it("reports no URL for a container that is not running", async () => {
    const runtime = new FakeRuntime();
    const containerId = sandbox(runtime, ID);
    const container = runtime.containers.get(containerId);
    if (container !== undefined) container.running = false;
    const [listing] = await listSandboxes(runtime);
    expect(listing?.url).toBeNull();
  });
});
