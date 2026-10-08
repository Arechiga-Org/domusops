import { createRuntime } from "./runtime/docker.js";
import { startSandboxWith, type StartOptions } from "./instance/start.js";
import type { Sandbox } from "./instance/handle.js";
import {
  attachSandboxWith,
  cleanupWith,
  stopSandboxWith,
} from "./instance/manage.js";
import { listSandboxes as listWith } from "./instance/list.js";
import type { Removal } from "./runtime/reaper.js";

export { SandboxError, type SandboxErrorCode } from "./errors.js";
export { resolveChannel } from "./release/resolve.js";
export type { Channel, ResolvedRelease } from "./release/versions.js";
export type { Sandbox, Connection, McpEnv } from "./instance/handle.js";
export type { StartOptions } from "./instance/start.js";
export type { ConfigSource } from "./config/pack.js";
export type { SandboxListing } from "./instance/list.js";
export type { Removal, ReapReason } from "./runtime/reaper.js";
export type { ConfigSummary, LifecycleState, SandboxMode } from "./types.js";

export function startSandbox(options: StartOptions = {}): Promise<Sandbox> {
  return startSandboxWith(createRuntime(), options);
}

export function attachSandbox(id: string): Promise<Sandbox> {
  return attachSandboxWith(createRuntime(), id);
}

export function listSandboxes(): Promise<Awaited<ReturnType<typeof listWith>>> {
  return listWith(createRuntime());
}

export function stopSandbox(id: string): Promise<void> {
  return stopSandboxWith(createRuntime(), id);
}

export function cleanup(): Promise<{ removed: Removal[] }> {
  return cleanupWith(createRuntime());
}
