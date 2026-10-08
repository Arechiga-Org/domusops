import { SandboxError } from "../../src/errors.js";
import type {
  ContainerInfo,
  CreateSpec,
  ExecResult,
  LogTail,
  Runtime,
  RuntimeName,
} from "../../src/runtime/docker.js";
import { LABEL_MARKER } from "../../src/runtime/labels.js";

export interface FakeContainer extends ContainerInfo {
  spec: CreateSpec | null;
  files: Buffer[];
  hostPort: number;
}

/** An in-memory runtime that records every call, for the unit tests. */
export class FakeRuntime implements Runtime {
  readonly name: RuntimeName = "docker";
  readonly calls: string[] = [];
  readonly containers = new Map<string, FakeContainer>();
  readonly images = new Set<string>();
  available = true;
  pullFails = false;
  execResults: ExecResult[] = [];
  /** Lines a followed container produced; `followLogs` hands back a tail over them. */
  followedLines: string[] = [];
  /** When set, `logs` fails, as it does once `--rm` has removed the container. */
  logsFail = false;
  private counter = 0;
  private nextPort = 49000;

  /** A container that did not come from the sandbox: never listed, never touched. */
  addForeign(name: string, labels: Record<string, string> = {}): string {
    const id = this.newId();
    this.containers.set(id, {
      id,
      name,
      labels,
      running: true,
      spec: null,
      files: [],
      hostPort: 0,
    });
    return id;
  }

  /** A container as a past `create` would have left it. */
  addSandbox(name: string, labels: Record<string, string>): string {
    return this.addForeign(name, { [LABEL_MARKER]: "1", ...labels });
  }

  removed(): string[] {
    return this.calls
      .filter((call) => call.startsWith("remove "))
      .map((call) => call.slice("remove ".length));
  }

  private newId(): string {
    this.counter += 1;
    return this.counter.toString(16).padStart(64, "0");
  }

  async ensureAvailable(): Promise<void> {
    this.calls.push("ensureAvailable");
    if (!this.available) {
      throw new SandboxError("runtime_missing", "no container runtime");
    }
  }

  async imageExists(image: string): Promise<boolean> {
    this.calls.push(`imageExists ${image}`);
    return this.images.has(image);
  }

  async pull(image: string): Promise<ExecResult> {
    this.calls.push(`pull ${image}`);
    if (this.pullFails) {
      return { status: 1, stdout: "", stderr: "pull access denied" };
    }
    this.images.add(image);
    return { status: 0, stdout: "", stderr: "" };
  }

  async create(spec: CreateSpec): Promise<string> {
    this.calls.push(`create ${spec.name}`);
    const id = this.newId();
    this.containers.set(id, {
      id,
      name: spec.name,
      labels: spec.labels,
      running: false,
      spec,
      files: [],
      hostPort: this.nextPort++,
    });
    return id;
  }

  async copyIn(containerId: string, tar: Buffer): Promise<void> {
    this.calls.push(`copyIn ${containerId}`);
    this.get(containerId).files.push(tar);
  }

  async start(containerId: string): Promise<void> {
    this.calls.push(`start ${containerId}`);
    this.get(containerId).running = true;
  }

  async hostPort(containerId: string, containerPort: number): Promise<number> {
    this.calls.push(`hostPort ${containerId} ${containerPort}`);
    return this.get(containerId).hostPort;
  }

  async exec(containerId: string, argv: string[]): Promise<ExecResult> {
    this.calls.push(`exec ${containerId} ${argv.join(" ")}`);
    return this.execResults.shift() ?? { status: 0, stdout: "", stderr: "" };
  }

  async logs(containerId: string, tail: number): Promise<string> {
    this.calls.push(`logs ${containerId} ${tail}`);
    if (this.logsFail) throw new Error("No such container");
    return "";
  }

  followLogs(containerId: string, keep: number): LogTail {
    this.calls.push(`followLogs ${containerId} ${keep}`);
    return {
      lines: () => this.followedLines.slice(-keep),
      stop: () => {
        this.calls.push(`stopFollow ${containerId}`);
      },
    };
  }

  async list(): Promise<ContainerInfo[]> {
    this.calls.push("list");
    return [...this.containers.values()].filter(
      (c) => c.labels[LABEL_MARKER] === "1",
    );
  }

  async inspect(containerId: string): Promise<ContainerInfo | null> {
    this.calls.push(`inspect ${containerId}`);
    return this.containers.get(containerId) ?? null;
  }

  async remove(containerId: string): Promise<void> {
    this.calls.push(`remove ${containerId}`);
    this.containers.delete(containerId);
  }

  removeSync(containerId: string): void {
    this.calls.push(`remove ${containerId}`);
    this.containers.delete(containerId);
  }

  private get(containerId: string): FakeContainer {
    const container = this.containers.get(containerId);
    if (container === undefined) throw new Error(`no container ${containerId}`);
    return container;
  }
}
