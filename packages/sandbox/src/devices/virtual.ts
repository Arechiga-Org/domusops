import { posix } from "node:path";
import { CONFIG_ROOT, TarBuilder } from "../config/pack.js";
import { SandboxError } from "../errors.js";
import { getJson, postJson } from "../ha/rest.js";
import type { Runtime } from "../runtime/docker.js";
import {
  DEVICE_FILE,
  DEVICE_KINDS,
  renderDeviceFile,
  validateDevices,
  type VirtualDevice,
  type VirtualDeviceSpec,
} from "./spec.js";

const HANDLER = "virtual";
const GROUP_NAME = "domusops";
const FILE_IN_CONTAINER = posix.join("/", CONFIG_ROOT, DEVICE_FILE);
/**
 * What a process that attaches later needs to keep adding devices: the specs, the devices created
 * and the integration's configuration entry, written by the sandbox after every change
 * (specs/007-debt-paydown data-model §3). It sits in a dot directory the configuration packer
 * skips, so a loaded configuration can neither supply nor overwrite it.
 */
export const STATE_FORMAT = "domusops.sandbox-devices/0.1";
export const STATE_DIRECTORY = ".domusops_sandbox";
const STATE_FILE = "devices.json";
const STATE_IN_CONTAINER = posix.join(
  "/",
  CONFIG_ROOT,
  STATE_DIRECTORY,
  STATE_FILE,
);
const FLOW = "/api/config/config_entries/flow";
const ENTRY = "/api/config/config_entries/entry";
const APPEAR_TIMEOUT_MS = 30_000;
const POLL_MS = 250;
const RESTORE_TIMEOUT_MS = 10_000;

export interface DeviceContext {
  runtime: Runtime;
  containerId: string;
  baseUrl: string;
  token: string;
  /** The sandbox's id, named in the message when the device list changed under a handle. */
  sandboxId: string;
}

export interface DeviceState {
  format: typeof STATE_FORMAT;
  /** Starts at 1 and goes up with every successful write. */
  revision: number;
  entryId: string;
  specs: VirtualDeviceSpec[];
  devices: VirtualDevice[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const KINDS: readonly string[] = DEVICE_KINDS;

function isSpec(value: unknown): value is VirtualDeviceSpec {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["kind"] === "string" &&
    KINDS.includes(value["kind"]) &&
    (value["class"] === undefined || typeof value["class"] === "string") &&
    (value["initial"] === undefined || typeof value["initial"] === "string")
  );
}

/** The state file's content, or null when it is not a valid file of this format. */
export function parseDeviceState(text: string): DeviceState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value["format"] !== STATE_FORMAT) return null;
  const { revision, entryId, specs, devices } = value;
  if (typeof revision !== "number" || !Number.isInteger(revision)) return null;
  if (revision < 1) return null;
  if (typeof entryId !== "string" || entryId === "") return null;
  if (!Array.isArray(specs) || !specs.every(isSpec)) return null;
  if (
    !Array.isArray(devices) ||
    !devices.every(
      (device) =>
        isSpec(device) &&
        typeof (device as unknown as Record<string, unknown>)["entityId"] ===
          "string",
    )
  ) {
    return null;
  }
  return {
    format: STATE_FORMAT,
    revision,
    entryId,
    specs: specs as VirtualDeviceSpec[],
    devices: devices as VirtualDevice[],
  };
}

/** What a process that attaches to a running instance finds of its virtual devices. */
export type Resumed =
  | { kind: "resumed"; virtual: VirtualDevices; devices: VirtualDevice[] }
  | { kind: "none" }
  | { kind: "entry-gone" };

interface StateRow {
  entity_id: string;
  state?: string;
  attributes?: { friendly_name?: unknown } & Record<string, unknown>;
}

function failed(detail: string, secrets: readonly string[]): SandboxError {
  return new SandboxError(
    "virtual_unavailable",
    `The virtual devices could not be set up: ${detail}`,
    { secrets },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The virtual devices of one instance. The device integration reads one file; adding devices later
 * rewrites that file inside the container and reloads the integration's single configuration entry
 * (research R7). Calls are serialised, so two additions never race over the file.
 */
export class VirtualDevices {
  readonly #context: DeviceContext;
  #specs: VirtualDeviceSpec[] = [];
  #entryId: string | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #known: VirtualDevice[] = [];
  /** The revision of the state file this handle last read or wrote. */
  #revision = 0;

  constructor(context: DeviceContext) {
    this.#context = context;
  }

  /**
   * Takes over the devices of a running instance from the state file its starting process left.
   * `none` when there is no valid file, which means the instance was started without `devices`;
   * `entry-gone` when the file is valid but the integration's entry is no longer loaded.
   */
  static async resume(context: DeviceContext): Promise<Resumed> {
    const read = await context.runtime.exec(context.containerId, [
      "cat",
      STATE_IN_CONTAINER,
    ]);
    const state = read.status === 0 ? parseDeviceState(read.stdout) : null;
    if (state === null) return { kind: "none" };
    const entries = (await getJson(context.baseUrl, ENTRY, {
      token: context.token,
    })) as { entry_id?: unknown; state?: unknown }[];
    const loaded =
      Array.isArray(entries) &&
      entries.some(
        (entry) => entry.entry_id === state.entryId && entry.state === "loaded",
      );
    if (!loaded) return { kind: "entry-gone" };
    const virtual = new VirtualDevices(context);
    virtual.#specs = [...state.specs];
    virtual.#entryId = state.entryId;
    virtual.#known = [...state.devices];
    virtual.#revision = state.revision;
    return { kind: "resumed", virtual, devices: [...state.devices] };
  }

  /** Creates the configuration entry for the device file the instance started with. */
  async initialise(
    specs: readonly VirtualDeviceSpec[],
  ): Promise<VirtualDevice[]> {
    return this.#serial(async () => {
      try {
        this.#specs = [...specs];
        const existing = await this.#entityIds();
        await this.#createEntry();
        this.#known = await this.#appear(specs, existing);
        await this.#writeState(1, this.#known);
        this.#revision = 1;
        return [...this.#known];
      } catch (error) {
        throw this.#asFailure(error);
      }
    });
  }

  add(specs: readonly VirtualDeviceSpec[]): Promise<VirtualDevice[]> {
    return this.#serial(async () => {
      if (this.#entryId === null) {
        throw failed(
          "the instance was started without virtual-device support. Pass `devices` (an empty list is enough) to `startSandbox`.",
          [],
        );
      }
      const valid = validateDevices(
        specs,
        this.#specs.map((spec) => spec.name),
      );
      if (valid.length === 0) return [];
      await this.#checkRevision();
      const previous = this.#specs;
      const entryId = this.#entryId;
      let existing: Set<string>;
      let before: StateRow[];
      try {
        before = await this.#rows();
        existing = new Set(before.map((row) => row.entity_id));
      } catch (error) {
        throw this.#asFailure(error);
      }
      this.#specs = [...previous, ...valid];
      try {
        await this.#writeFile();
        await this.#reload(entryId);
        const created = await this.#appear(valid, existing);
        await this.#restore(before);
        const devices = [...this.#known, ...created];
        await this.#writeState(this.#revision + 1, devices);
        this.#revision += 1;
        this.#known = devices;
        return created;
      } catch (error) {
        this.#specs = previous;
        // Put the previous file back so a later reload does not bring the failed devices in.
        try {
          await this.#writeFile();
          await this.#reload(entryId);
        } catch {
          // Best effort: the original error is the one worth reporting.
        }
        throw this.#asFailure(error);
      }
    });
  }

  #asFailure(error: unknown): SandboxError {
    if (error instanceof SandboxError) return error;
    return failed(error instanceof Error ? error.message : String(error), [
      this.#context.token,
    ]);
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #reload(entryId: string): Promise<void> {
    await postJson(
      this.#context.baseUrl,
      `${ENTRY}/${entryId}/reload`,
      {},
      { token: this.#context.token, timeoutMs: 60_000 },
    );
  }

  async #rows(): Promise<StateRow[]> {
    return (await getJson(this.#context.baseUrl, "/api/states", {
      token: this.#context.token,
    })) as StateRow[];
  }

  /** Every entity id in the instance now, so entities that were already there are never taken for new ones. */
  async #entityIds(): Promise<Set<string>> {
    return new Set((await this.#rows()).map((row) => row.entity_id));
  }

  /**
   * Reloading the entry recreates every device, and one that holds no persistent value (a sensor
   * given a state, say) comes back unavailable. Puts the states the earlier devices had back.
   */
  async #restore(before: readonly StateRow[]): Promise<void> {
    const mine = new Set(this.#known.map((device) => device.entityId));
    const wanted = before.filter(
      (row) => mine.has(row.entity_id) && row.state !== undefined,
    );
    const deadline = Date.now() + RESTORE_TIMEOUT_MS;
    let after = new Map<string, StateRow>();
    for (;;) {
      after = new Map(
        (await this.#rows()).map((row) => [row.entity_id, row] as const),
      );
      if (wanted.every((row) => after.has(row.entity_id))) break;
      if (Date.now() > deadline) break;
      await sleep(POLL_MS);
    }
    for (const row of wanted) {
      const now = after.get(row.entity_id);
      if (now === undefined || now.state === row.state) continue;
      await postJson(
        this.#context.baseUrl,
        `/api/states/${row.entity_id}`,
        { state: row.state, attributes: row.attributes ?? {} },
        { token: this.#context.token },
      );
    }
  }

  /** Refuses to go on when another process changed the device list since this handle last saw it. */
  async #checkRevision(): Promise<void> {
    const read = await this.#context.runtime.exec(this.#context.containerId, [
      "cat",
      STATE_IN_CONTAINER,
    ]);
    const stored = read.status === 0 ? parseDeviceState(read.stdout) : null;
    if (stored === null || stored.revision !== this.#revision) {
      throw new SandboxError(
        "virtual_unavailable",
        `The device list of sandbox ${this.#context.sandboxId} changed in another process. Attach again to continue.`,
      );
    }
  }

  async #writeState(
    revision: number,
    devices: readonly VirtualDevice[],
  ): Promise<void> {
    if (this.#entryId === null) throw new Error("no configuration entry");
    const state: DeviceState = {
      format: STATE_FORMAT,
      revision,
      entryId: this.#entryId,
      specs: this.#specs,
      devices: [...devices],
    };
    const builder = new TarBuilder();
    builder.addDirectory(posix.join(CONFIG_ROOT, STATE_DIRECTORY));
    builder.addFile(
      posix.join(CONFIG_ROOT, STATE_DIRECTORY, STATE_FILE),
      `${JSON.stringify(state)}\n`,
    );
    await this.#context.runtime.copyIn(
      this.#context.containerId,
      await builder.finish(),
    );
  }

  async #writeFile(): Promise<void> {
    const builder = new TarBuilder();
    builder.addFile(
      posix.join(CONFIG_ROOT, DEVICE_FILE),
      renderDeviceFile(this.#specs),
    );
    await this.#context.runtime.copyIn(
      this.#context.containerId,
      await builder.finish(),
    );
  }

  async #createEntry(): Promise<void> {
    const { baseUrl, token } = this.#context;
    const options = { token, timeoutMs: 60_000 };
    try {
      const started = (await postJson(
        baseUrl,
        FLOW,
        { handler: HANDLER, show_advanced_options: false },
        options,
      )) as { flow_id?: string };
      if (typeof started?.flow_id !== "string") {
        throw new Error("the configuration flow did not start");
      }
      const done = (await postJson(
        baseUrl,
        `${FLOW}/${started.flow_id}`,
        { group_name: GROUP_NAME, file_name: FILE_IN_CONTAINER },
        options,
      )) as { type?: string; result?: { entry_id?: string }; errors?: unknown };
      const entryId = done?.result?.entry_id;
      if (done?.type !== "create_entry" || typeof entryId !== "string") {
        throw new Error(
          `the configuration flow ended with "${String(done?.type)}"`,
        );
      }
      this.#entryId = entryId;
    } catch (error) {
      throw failed(error instanceof Error ? error.message : String(error), [
        token,
      ]);
    }
  }

  /** Waits for the new entities and reads their ids back (research R7: by name and kind). */
  async #appear(
    specs: readonly VirtualDeviceSpec[],
    existing: ReadonlySet<string>,
  ): Promise<VirtualDevice[]> {
    const { baseUrl, token } = this.#context;
    const wanted = specs;
    const found = new Map<string, string>();
    const deadline = Date.now() + APPEAR_TIMEOUT_MS;
    for (;;) {
      const rows = (await getJson(baseUrl, "/api/states", {
        token,
      })) as StateRow[];
      for (const spec of wanted) {
        if (found.has(spec.name)) continue;
        const row = rows.find(
          (candidate) =>
            candidate.entity_id.startsWith(`${spec.kind}.`) &&
            typeof candidate.attributes?.friendly_name === "string" &&
            candidate.attributes.friendly_name.toLowerCase() ===
              spec.name.toLowerCase() &&
            !existing.has(candidate.entity_id) &&
            ![...found.values()].includes(candidate.entity_id),
        );
        if (row !== undefined) found.set(spec.name, row.entity_id);
      }
      if (found.size === wanted.length) break;
      if (Date.now() > deadline) {
        const missing = wanted
          .filter((spec) => !found.has(spec.name))
          .map((spec) => `${spec.kind} "${spec.name}"`);
        throw failed(
          `these devices did not appear within ${String(APPEAR_TIMEOUT_MS / 1000)} s: ${missing.join(", ")}.`,
          [token],
        );
      }
      await sleep(POLL_MS);
    }
    return specs.map((spec): VirtualDevice => {
      const entityId = found.get(spec.name);
      if (entityId === undefined) {
        throw failed(`"${spec.name}" has no entity.`, [token]);
      }
      return { ...spec, entityId };
    });
  }
}
