import type { JsonObject } from "@domusops/schema";
import { errors } from "../errors.js";
import { isObject } from "../util/json.js";
import type { HaClient } from "./client.js";

/** One state object as `get_states` returns it (specs/010-ha-state research R1). */
export interface HaState extends JsonObject {
  entity_id: string;
  state: string;
  attributes: JsonObject;
  last_changed: string;
  last_updated: string;
  last_reported: string;
  context: { id: string; parent_id: string | null; user_id: string | null };
}

const TIMES = ["last_changed", "last_updated", "last_reported"] as const;

const nullableString = (value: unknown): boolean =>
  value === null || typeof value === "string";

/**
 * What is wrong with one state object, or null when it has every field `ha_state` reads, of the
 * right kind. Every supported release gives all three times (research R5); keys it does not read
 * are allowed, so a later release that adds one still works.
 */
function problemOf(value: unknown): string | null {
  if (!isObject<JsonObject>(value)) return "a state was not an object";
  const id = value["entity_id"];
  if (typeof id !== "string" || !id.includes("."))
    return "a state had no entity ID";
  if (typeof value["state"] !== "string")
    return `the state of ${id} was not a string`;
  if (!isObject(value["attributes"]))
    return `the attributes of ${id} were not an object`;
  for (const key of TIMES) {
    const time = value[key];
    if (typeof time !== "string" || Number.isNaN(Date.parse(time)))
      return `the state of ${id} had no valid ${key}`;
  }
  const context = value["context"];
  if (
    !isObject<JsonObject>(context) ||
    typeof context["id"] !== "string" ||
    !nullableString(context["parent_id"]) ||
    !nullableString(context["user_id"])
  )
    return `the state of ${id} had no valid context`;
  return null;
}

/** Reads every current state. A malformed answer is a protocol error, never a partial result. */
export async function readStates(client: HaClient): Promise<HaState[]> {
  const states = await client.command("get_states");
  if (!Array.isArray(states)) {
    throw errors.protocolError("the states were not a list", client.haVersion);
  }
  for (const state of states) {
    const problem = problemOf(state);
    if (problem !== null) throw errors.protocolError(problem, client.haVersion);
  }
  return states as HaState[];
}
