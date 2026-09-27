import {
  parseIsoMicros,
  type TraceDomain,
  type TraceExtendedRecord,
  type TraceShortRecord,
} from "@domusops/schema";
import { errors, ToolError } from "../errors.js";
import type { CommandParams, HaClient } from "./client.js";
import { isObject, readInstance, type Instance } from "./instance.js";

/** How many `trace/get` requests are in flight at once (research R4). */
export const MAX_IN_FLIGHT = 8;

/** What a trace query needs to know about the instance before it can select traces. */
export type TraceContext = Omit<Instance, "components">;

/**
 * Requires an administrator user and reads the core config (`readInstance`), then requires the
 * `trace` integration to be loaded at all.
 */
export async function readTraceContext(
  client: HaClient,
): Promise<TraceContext> {
  const { components, ...context } = await readInstance(client);
  if (!components.includes("trace")) throw errors.tracesUnavailable();
  return context;
}

/** An automation or script known to the entity registry. */
export interface RegistryItem {
  entity_id: string;
  /** The `item_id` its traces are stored under. */
  unique_id: string;
  platform: TraceDomain;
}

/** The traced items the instance knows about (research R3). */
export interface KnownItems {
  registry: RegistryItem[];
  /** Entity IDs of automations without an `id` in their configuration: never traced. */
  untraceable: string[];
}

/** A stored trace's place in the instance, as `trace/contexts` reports it. */
export interface ContextEntry {
  run_id: string;
  domain: string;
  item_id: string;
}

type TraceCommand = "trace/list" | "trace/get" | "trace/contexts";

/**
 * Sends one trace command. An `unknown_command` failure means the integration is missing; an
 * `unauthorized` one means the user is not an administrator. Any other failure stays as the client
 * built it (`retrieval_failed`, `timeout`).
 */
async function traceCommand(
  client: HaClient,
  type: TraceCommand,
  params?: CommandParams,
): Promise<unknown> {
  try {
    return await client.command(type, params);
  } catch (error) {
    if (error instanceof ToolError && error.kind === "retrieval_failed") {
      if (error.causeText.includes("unknown_command")) {
        throw errors.tracesUnavailable();
      }
      if (error.causeText.includes("unauthorized")) throw errors.notAdmin();
    }
    throw error;
  }
}

/**
 * Reads the automations and scripts the instance knows: the entity registry entries of both
 * platforms, and the automation states that have no `id` (which the instance cannot trace).
 * Nothing else of either record is kept.
 */
export async function readItems(client: HaClient): Promise<KnownItems> {
  const version = client.haVersion;
  const [registry, states] = await Promise.all([
    client.command("config/entity_registry/list"),
    client.command("get_states"),
  ]);
  if (!Array.isArray(registry) || !Array.isArray(states)) {
    throw errors.protocolError(
      "the entity registry or the states were not a list",
      version,
    );
  }
  const items: RegistryItem[] = [];
  for (const entry of registry) {
    if (!isObject(entry)) continue;
    const platform = entry["platform"];
    if (platform !== "automation" && platform !== "script") continue;
    const entityId = entry["entity_id"];
    const uniqueId = entry["unique_id"];
    if (typeof entityId === "string" && typeof uniqueId === "string") {
      items.push({ entity_id: entityId, unique_id: uniqueId, platform });
    }
  }
  const untraceable: string[] = [];
  for (const state of states) {
    if (!isObject(state)) continue;
    const entityId = state["entity_id"];
    if (typeof entityId !== "string" || !entityId.startsWith("automation.")) {
      continue;
    }
    const attributes = state["attributes"];
    if (!isObject(attributes) || typeof attributes["id"] !== "string") {
      untraceable.push(entityId);
    }
  }
  return { registry: items, untraceable };
}

const isNullableString = (value: unknown): boolean =>
  value === null || typeof value === "string";

/** A timestamp the instance writes as Python's `isoformat()`, which the format reproduces exactly. */
function requireTimestamp(value: unknown, what: string, version: string): void {
  if (typeof value !== "string" || parseIsoMicros(value) === null) {
    throw errors.protocolError(
      `${what} is not a canonical UTC timestamp`,
      version,
    );
  }
}

function validateShort(record: unknown, version: string): TraceShortRecord {
  const bad = (what: string): ToolError =>
    errors.protocolError(`a trace ${what}`, version);
  if (!isObject(record)) throw bad("record was not an object");
  for (const key of ["run_id", "domain", "item_id", "state"]) {
    if (typeof record[key] !== "string") throw bad(`had no string "${key}"`);
  }
  if (!isNullableString(record["script_execution"])) {
    throw bad('had no "script_execution" string or null');
  }
  if (!isNullableString(record["last_step"])) {
    throw bad('had no "last_step" string or null');
  }
  const timestamp = record["timestamp"];
  if (!isObject(timestamp)) throw bad("had no timestamp");
  requireTimestamp(timestamp["start"], "a trace start", version);
  if (timestamp["finish"] !== null) {
    requireTimestamp(timestamp["finish"], "a trace finish", version);
  }
  return record as TraceShortRecord;
}

function validateExtended(
  record: unknown,
  version: string,
): TraceExtendedRecord {
  const short = validateShort(record, version);
  const bad = (what: string): ToolError =>
    errors.protocolError(`a trace ${what}`, version);
  const full = short as Record<string, unknown>;
  const trace = full["trace"];
  if (!isObject(trace)) throw bad("had no steps object");
  for (const steps of Object.values(trace)) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw bad("had an empty or malformed list of steps");
    }
    for (const step of steps) {
      if (!isObject(step) || typeof step["path"] !== "string") {
        throw bad("had a step without a path");
      }
      requireTimestamp(step["timestamp"], "a step timestamp", version);
    }
  }
  for (const key of ["config", "blueprint_inputs"]) {
    if (full[key] !== null && !isObject(full[key])) {
      throw bad(`had no "${key}" object or null`);
    }
  }
  const context = full["context"];
  if (!isObject(context) || typeof context["id"] !== "string") {
    throw bad("had no context");
  }
  for (const key of ["parent_id", "user_id"]) {
    if (!isNullableString(context[key])) {
      throw bad(`had a malformed context "${key}"`);
    }
  }
  return record as TraceExtendedRecord;
}

/** The short records of every stored trace of the given domains. */
export async function listTraces(
  client: HaClient,
  domains: readonly TraceDomain[],
): Promise<TraceShortRecord[]> {
  const out: TraceShortRecord[] = [];
  for (const domain of domains) {
    const result = await traceCommand(client, "trace/list", { domain });
    if (!Array.isArray(result)) {
      throw errors.protocolError(
        "the trace list was not a list",
        client.haVersion,
      );
    }
    for (const record of result)
      out.push(validateShort(record, client.haVersion));
  }
  return out;
}

/**
 * The stored traces by context ID. The instance keeps one trace per context here: when several
 * share a context, only the last is listed (research R4).
 */
export async function readContexts(
  client: HaClient,
): Promise<Map<string, ContextEntry>> {
  const result = await traceCommand(client, "trace/contexts");
  if (!isObject(result)) {
    throw errors.protocolError(
      "the trace contexts were not an object",
      client.haVersion,
    );
  }
  const out = new Map<string, ContextEntry>();
  for (const [id, entry] of Object.entries(result)) {
    if (
      !isObject(entry) ||
      typeof entry["run_id"] !== "string" ||
      typeof entry["domain"] !== "string" ||
      typeof entry["item_id"] !== "string"
    ) {
      throw errors.protocolError(
        "a trace context entry was malformed",
        client.haVersion,
      );
    }
    out.set(id, {
      run_id: entry["run_id"],
      domain: entry["domain"],
      item_id: entry["item_id"],
    });
  }
  return out;
}

/** The place of one trace: what `trace/get` needs. */
export interface TraceRef {
  domain: TraceDomain;
  item_id: string;
  run_id: string;
}

async function getOne(
  client: HaClient,
  ref: TraceRef,
): Promise<TraceExtendedRecord> {
  let result: unknown;
  try {
    result = await traceCommand(client, "trace/get", ref);
  } catch (error) {
    if (
      error instanceof ToolError &&
      error.kind === "retrieval_failed" &&
      error.causeText.includes("not_found")
    ) {
      // Listed a moment ago and gone now: a partial result would look complete (spec FR-018).
      throw errors.retrievalFailed(
        "trace/get",
        "a stored trace was replaced while it was being read",
      );
    }
    throw error;
  }
  return validateExtended(result, client.haVersion);
}

/**
 * Reads the extended record of each trace, at most `MAX_IN_FLIGHT` at a time, in the order of
 * `refs`. Any failure fails the whole call: no subset is returned.
 */
export async function getTraces(
  client: HaClient,
  refs: readonly TraceRef[],
): Promise<TraceExtendedRecord[]> {
  const out = new Array<TraceExtendedRecord>(refs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const ref = refs[index];
      if (ref === undefined) return;
      out[index] = await getOne(client, ref);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_IN_FLIGHT, refs.length) }, worker),
  );
  return out;
}
