import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  STATE_FORMAT,
  VirtualDevices,
  parseDeviceState,
  type DeviceContext,
  type DeviceState,
} from "../src/devices/virtual.js";
import { readArchive } from "./support/archive.js";
import { FakeRuntime } from "./support/fake-runtime.js";

/**
 * The state file that lets a process which attaches to a running instance keep adding devices
 * (specs/007-debt-paydown FR-013, data-model §3), against a fake Home Assistant over HTTP and a
 * runtime that keeps the files copied into it.
 */
const STATE_PATH = "/config/.domusops_sandbox/devices.json";
const TOKEN = "plain-instance-token-0123456789abcdef";

/** A runtime whose container keeps the files copied in, and answers `cat` with them. */
class FileRuntime extends FakeRuntime {
  readonly files = new Map<string, string>();
  copies = 0;

  override async copyIn(containerId: string, tar: Buffer): Promise<void> {
    await super.copyIn(containerId, tar);
    this.copies += 1;
    for (const [path, entry] of await readArchive(tar)) {
      if (entry.type === "File") this.files.set(`/${path}`, entry.content);
    }
  }

  override async exec(containerId: string, argv: string[]) {
    await super.exec(containerId, argv);
    const content =
      argv[0] === "cat" ? this.files.get(argv[1] ?? "") : undefined;
    return content === undefined
      ? { status: 1, stdout: "", stderr: "no such file" }
      : { status: 0, stdout: content, stderr: "" };
  }

  state(): DeviceState {
    const parsed = parseDeviceState(this.files.get(STATE_PATH) ?? "");
    if (parsed === null) throw new Error("no valid state file");
    return parsed;
  }
}

interface FakeHa {
  rows: { entity_id: string; state: string; attributes: object }[];
  entries: { entry_id: string; state: string }[];
  onCreate: () => void;
  onReload: () => void;
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

const row = (kind: string, name: string) => ({
  entity_id: `${kind}.${name.toLowerCase().replace(/\W+/g, "_")}`,
  state: "off",
  attributes: { friendly_name: name },
});

async function setup(): Promise<{
  ha: FakeHa;
  runtime: FileRuntime;
  context: DeviceContext;
}> {
  const ha: FakeHa = {
    rows: [],
    entries: [{ entry_id: "entry-1", state: "loaded" }],
    onCreate: () => undefined,
    onReload: () => undefined,
  };
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = request.url ?? "";
      let body: unknown = {};
      if (request.method === "GET" && url === "/api/states") body = ha.rows;
      else if (url === "/api/config/config_entries/flow") {
        body = { flow_id: "f1" };
      } else if (url === "/api/config/config_entries/flow/f1") {
        ha.onCreate();
        body = { type: "create_entry", result: { entry_id: "entry-1" } };
      } else if (request.method === "GET" && url.endsWith("/entry")) {
        body = ha.entries;
      } else if (url.endsWith("/reload")) ha.onReload();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const runtime = new FileRuntime();
  const containerId = runtime.addForeign("sandbox");
  const port = (server?.address() as AddressInfo).port;
  return {
    ha,
    runtime,
    context: {
      runtime,
      containerId,
      baseUrl: `http://127.0.0.1:${String(port)}`,
      token: TOKEN,
      sandboxId: "0123456789ab",
    },
  };
}

const MOTION = { kind: "binary_sensor", name: "Hall motion" } as const;
const PORCH = { kind: "light", name: "Porch" } as const;
const GARDEN = { kind: "switch", name: "Garden pump" } as const;

describe("the state file", () => {
  it("is written when the instance starts with devices: revision 1, the entry, the specs and the devices", async () => {
    const { ha, runtime, context } = await setup();
    ha.onCreate = () => ha.rows.push(row("binary_sensor", "Hall motion"));
    const virtual = new VirtualDevices(context);
    await virtual.initialise([MOTION]);
    expect(runtime.state()).toEqual({
      format: STATE_FORMAT,
      revision: 1,
      entryId: "entry-1",
      specs: [MOTION],
      devices: [{ ...MOTION, entityId: "binary_sensor.hall_motion" }],
    });
  });

  it("is written with an empty list too, so an instance started with `devices: []` can be resumed", async () => {
    const { runtime, context } = await setup();
    await new VirtualDevices(context).initialise([]);
    expect(runtime.state()).toMatchObject({
      revision: 1,
      specs: [],
      devices: [],
    });
  });

  it("goes up by one with every successful addition", async () => {
    const { ha, runtime, context } = await setup();
    const virtual = new VirtualDevices(context);
    await virtual.initialise([]);
    ha.onReload = () => ha.rows.push(row("light", "Porch"));
    await virtual.add([PORCH]);
    expect(runtime.state()).toMatchObject({
      revision: 2,
      specs: [PORCH],
      devices: [{ ...PORCH, entityId: "light.porch" }],
    });
    ha.onReload = () => ha.rows.push(row("switch", "Garden pump"));
    await virtual.add([GARDEN]);
    expect(runtime.state().revision).toBe(3);
    expect(runtime.state().devices.map((device) => device.name)).toEqual([
      "Porch",
      "Garden pump",
    ]);
  });
});

describe("resuming from the state file", () => {
  it("gives the devices created so far, and lets the new handle add more", async () => {
    const { ha, runtime, context } = await setup();
    ha.onCreate = () => ha.rows.push(row("binary_sensor", "Hall motion"));
    await new VirtualDevices(context).initialise([MOTION]);

    const resumed = await VirtualDevices.resume(context);
    expect(resumed.kind).toBe("resumed");
    if (resumed.kind !== "resumed") return;
    expect(resumed.devices).toEqual([
      { ...MOTION, entityId: "binary_sensor.hall_motion" },
    ]);
    ha.onReload = () => ha.rows.push(row("light", "Porch"));
    const created = await resumed.virtual.add([PORCH]);
    expect(created).toEqual([{ ...PORCH, entityId: "light.porch" }]);
    expect(runtime.state()).toMatchObject({ revision: 2 });
    expect(runtime.state().specs).toEqual([MOTION, PORCH]);
  });

  it("finds nothing to resume when the instance was started without devices", async () => {
    const { context } = await setup();
    expect(await VirtualDevices.resume(context)).toEqual({ kind: "none" });
  });

  it.each([
    ["not JSON", "not json"],
    ["another format", JSON.stringify({ format: "other/1", revision: 1 })],
    [
      "a revision of 0",
      JSON.stringify({
        format: STATE_FORMAT,
        revision: 0,
        entryId: "e",
        specs: [],
        devices: [],
      }),
    ],
    [
      "a device with an unknown kind",
      JSON.stringify({
        format: STATE_FORMAT,
        revision: 1,
        entryId: "e",
        specs: [{ kind: "toaster", name: "x" }],
        devices: [],
      }),
    ],
  ])("treats %s as no device support", async (_name, content) => {
    const { runtime, context } = await setup();
    runtime.files.set(STATE_PATH, content);
    expect(await VirtualDevices.resume(context)).toEqual({ kind: "none" });
  });

  it("says the entry is gone when it is no longer loaded", async () => {
    const { ha, context } = await setup();
    await new VirtualDevices(context).initialise([]);
    ha.entries = [{ entry_id: "entry-1", state: "not_loaded" }];
    expect(await VirtualDevices.resume(context)).toEqual({
      kind: "entry-gone",
    });
    ha.entries = [];
    expect(await VirtualDevices.resume(context)).toEqual({
      kind: "entry-gone",
    });
  });
});

describe("two processes changing the device list", () => {
  it("fails the one that is behind, naming the sandbox, and changes nothing", async () => {
    const { ha, runtime, context } = await setup();
    const starter = new VirtualDevices(context);
    await starter.initialise([]);
    const resumed = await VirtualDevices.resume(context);
    if (resumed.kind !== "resumed") throw new Error("expected to resume");

    ha.onReload = () => ha.rows.push(row("light", "Porch"));
    await resumed.virtual.add([PORCH]);
    const before = { copies: runtime.copies, state: runtime.state() };

    // The starter still believes the list is at revision 1.
    await expect(starter.add([GARDEN])).rejects.toMatchObject({
      code: "virtual_unavailable",
      message:
        "The device list of sandbox 0123456789ab changed in another process. Attach again to continue.",
    });
    expect(runtime.copies).toBe(before.copies);
    expect(runtime.state()).toEqual(before.state);
  });

  it("lets a handle go on after it attaches again", async () => {
    const { ha, runtime, context } = await setup();
    const starter = new VirtualDevices(context);
    await starter.initialise([]);
    const first = await VirtualDevices.resume(context);
    if (first.kind !== "resumed") throw new Error("expected to resume");
    ha.onReload = () => ha.rows.push(row("light", "Porch"));
    await first.virtual.add([PORCH]);

    const again = await VirtualDevices.resume(context);
    if (again.kind !== "resumed") throw new Error("expected to resume");
    ha.onReload = () => ha.rows.push(row("switch", "Garden pump"));
    await again.virtual.add([GARDEN]);
    expect(runtime.state().revision).toBe(3);
  });
});

describe("the state file's content", () => {
  it("is read back as it was written", () => {
    const state: DeviceState = {
      format: STATE_FORMAT,
      revision: 4,
      entryId: "entry-9",
      specs: [{ ...MOTION, class: "motion", initial: "on" }],
      devices: [{ ...MOTION, entityId: "binary_sensor.hall_motion" }],
    };
    expect(parseDeviceState(JSON.stringify(state))).toEqual(state);
  });
});
