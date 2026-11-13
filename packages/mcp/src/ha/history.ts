import { errors, ToolError } from "../errors.js";
import { isObject } from "../util/json.js";
import type { HaClient, HistoryParams } from "./client.js";

/**
 * One entry of `history/history_during_period` (specs/011-ha-history data-model §1): `lu` and `lc`
 * in seconds since the epoch, `lc` only when the state did not change.
 */
export interface HistoryEntry {
  s: string;
  a: Record<string, unknown>;
  lu: number;
  lc?: number;
}

/** entity ID -> entries in time order; an entity with nothing recorded is absent. */
export type HistoryAnswer = Record<string, HistoryEntry[]>;

/** Why `entry` is not a history entry, or `null` when it is one. */
function problemOf(entry: unknown): string | null {
  if (!isObject(entry)) return "an entry was not an object";
  if (typeof entry["s"] !== "string") return 'an entry had no string "s"';
  if (!isObject(entry["a"])) return 'an entry had no object "a"';
  if (typeof entry["lu"] !== "number") return 'an entry had no numeric "lu"';
  if (entry["lc"] !== undefined && typeof entry["lc"] !== "number") {
    return 'an entry had a "lc" that was not a number';
  }
  return null;
}

/**
 * Reads the recorded history of `params.entity_ids` (research R1). Any failure is an error and no
 * entries: a partial history looks like a complete one. The answer is validated, never trusted.
 */
export async function readHistory(
  client: HaClient,
  params: HistoryParams,
): Promise<HistoryAnswer> {
  let result: unknown;
  try {
    result = await client.command("history/history_during_period", params);
  } catch (error) {
    if (
      error instanceof ToolError &&
      error.kind === "retrieval_failed" &&
      error.haCode === "unknown_command"
    ) {
      throw errors.historyUnavailable("states");
    }
    throw error;
  }
  if (!isObject(result)) {
    throw errors.protocolError(
      "the history was not an object",
      client.haVersion,
    );
  }
  for (const entries of Object.values(result)) {
    if (!Array.isArray(entries)) {
      throw errors.protocolError(
        "an entity's history was not a list",
        client.haVersion,
      );
    }
    for (const entry of entries) {
      const problem = problemOf(entry);
      if (problem !== null) {
        throw errors.protocolError(
          `the history is malformed: ${problem}`,
          client.haVersion,
        );
      }
    }
  }
  return result as HistoryAnswer;
}
