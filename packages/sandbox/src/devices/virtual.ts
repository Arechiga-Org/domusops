import { posix } from "node:path";
import { CONFIG_ROOT, TarBuilder } from "../config/pack.js";
import { SandboxError } from "../errors.js";
import { getJson, postJson } from "../ha/rest.js";
import type { Runtime } from "../runtime/docker.js";
import {
  DEVICE_FILE,
  renderDeviceFile,
  validateDevices,
  type VirtualDevice,
  type VirtualDeviceSpec,
} from "./spec.js";

const HANDLER = "virtual";
const GROUP_NAME = "domusops";
const FILE_IN_CONTAINER = posix.join("/", CONFIG_ROOT, DEVICE_FILE);
const FLOW = "/api/config/config_entries/flow";
const ENTRY = "/api/config/config_entries/entry";
const APPEAR_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

export interface DeviceContext {
  runtime: Runtime;
  containerId: string;
  baseUrl: string;
  token: string;
}

interface StateRow {
  entity_id: string;
  attributes?: { friendly_name?: unknown };
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

  constructor(context: DeviceContext) {
    this.#context = context;
  }

  /** Creates the configuration entry for the device file the instance started with. */
  async initialise(specs: readonly VirtualDeviceSpec[]): Promise<VirtualDevice[]> {
    return this.#serial(async () => {
      this.#specs = [...specs];
      await this.#createEntry();
      return this.#appear(specs);
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
      const previous = this.#specs;
      this.#specs = [...previous, ...valid];
      try {
        await this.#writeFile();
        await postJson(
          this.#context.baseUrl,
          `${ENTRY}/${this.#entryId}/reload`,
          {},
          { token: this.#context.token, timeoutMs: 60_000 },
        );
        return await this.#appear(valid);
      } catch (error) {
        this.#specs = previous;
        if (error instanceof SandboxError) throw error;
        throw failed(
          error instanceof Error ? error.message : String(error),
          [this.#context.token],
        );
      }
    });
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
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
      throw failed(
        error instanceof Error ? error.message : String(error),
        [token],
      );
    }
  }

  /** Waits for the new entities and reads their ids back (research R7: by name and kind). */
  async #appear(specs: readonly VirtualDeviceSpec[]): Promise<VirtualDevice[]> {
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
