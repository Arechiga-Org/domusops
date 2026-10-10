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
export type {
  Sandbox,
  SandboxTime,
  EntityState,
  Connection,
  McpEnv,
} from "./instance/handle.js";
export { DEVICE_KINDS } from "./devices/spec.js";
export type {
  DeviceKind,
  VirtualDevice,
  VirtualDeviceSpec,
} from "./devices/spec.js";
export type { StartOptions } from "./instance/start.js";
export type { ConfigSource } from "./config/pack.js";
export type { SandboxListing } from "./instance/list.js";
export type { Removal, ReapReason } from "./runtime/reaper.js";
export { runSmoke, type SmokeTarget } from "./smoke/run.js";
export {
  RESULT_FORMAT,
  STEP_NAMES,
  readResult,
  type RunResult,
  type StepResult,
} from "./results/result.js";
export {
  SUPPORTED_VERSIONS_FORMAT,
  applyResults,
  emptySupportedVersions,
  gateVerdict,
  renderSupportedVersions,
  replaceTableBlock,
  type SupportedVersions,
} from "./results/table.js";
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
