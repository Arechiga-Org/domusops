import { SandboxError } from "../errors.js";
import { HaSocket } from "../ha/ws.js";
import { exactRelease } from "../release/resolve.js";
import type { Runtime } from "../runtime/docker.js";
import { containerName, ID_RE, parseLabels } from "../runtime/labels.js";
import { reap, type Removal } from "../runtime/reaper.js";
import { verifyCompanion } from "./companion.js";
import { SandboxHandle, type Sandbox } from "./handle.js";
import { readToken } from "./onboard.js";

interface Found {
  containerId: string;
  labels: NonNullable<ReturnType<typeof parseLabels>>;
  running: boolean;
}

/** A sandbox container by id, through its deterministic name. Null when there is none. */
async function find(runtime: Runtime, id: string): Promise<Found | null> {
  if (!ID_RE.test(id)) return null;
  const info = await runtime.inspect(containerName(id));
  if (info === null) return null;
  const labels = parseLabels(info.labels);
  if (labels === null || labels.id !== id) return null;
  return { containerId: info.id, labels, running: info.running };
}

function notASandbox(id: string): SandboxError {
  return new SandboxError(
    "not_a_sandbox",
    `"${id}" is not a DomusOps sandbox instance.`,
  );
}

/** Reattaches to a background instance: reads its token back and checks it is the one asked for. */
export async function attachSandboxWith(
  runtime: Runtime,
  id: string,
): Promise<Sandbox> {
  const found = await find(runtime, id);
  if (found === null) {
    if (await isForeign(runtime, id)) throw notASandbox(id);
    throw new SandboxError("instance_gone", `The sandbox ${id} is gone.`);
  }
  if (found.labels.mode !== "background") {
    throw new SandboxError(
      "not_a_sandbox",
      `The sandbox ${id} belongs to another process and is not a background instance.`,
    );
  }
  if (!found.running) {
    throw new SandboxError(
      "instance_gone",
      `The sandbox ${id} is not running.`,
    );
  }
  const port = await runtime.hostPort(found.containerId, 8123);
  const token = await readToken(runtime, found.containerId);
  const socket = await HaSocket.connect(
    `ws://127.0.0.1:${port}/api/websocket`,
    token,
  );
  try {
    await verifyCompanion(socket, id);
  } finally {
    socket.close();
  }
  return new SandboxHandle({
    id,
    containerId: found.containerId,
    release: exactRelease(found.labels.release),
    mode: found.labels.mode,
    deadline: found.labels.deadline,
    port,
    token,
    config: null,
    runtime,
  });
}

/** True when `id` names a container that exists but is not one of ours, or is not an id at all. */
async function isForeign(runtime: Runtime, id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return true;
  return (
    (await runtime.inspect(id)) !== null ||
    (await runtime.inspect(containerName(id))) !== null
  );
}

/** Removes one sandbox instance. Idempotent for ids it owned; refuses anything else. */
export async function stopSandboxWith(
  runtime: Runtime,
  id: string,
): Promise<void> {
  const found = await find(runtime, id);
  if (found !== null) {
    await runtime.remove(found.containerId);
    return;
  }
  if (await isForeign(runtime, id)) throw notASandbox(id);
}

export async function cleanupWith(
  runtime: Runtime,
): Promise<{ removed: Removal[] }> {
  return { removed: await reap(runtime) };
}
