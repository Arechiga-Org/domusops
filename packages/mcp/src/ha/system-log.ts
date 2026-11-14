import { errors, ToolError } from "../errors.js";
import { isObject } from "../util/json.js";
import type { HaClient } from "./client.js";

/** The levels the instance records, in its own spelling (specs/012-ha-system-log research R1). */
export const RAW_LEVELS = ["WARNING", "ERROR", "CRITICAL"] as const;
export type RawLevel = (typeof RAW_LEVELS)[number];

/**
 * One entry of `system_log/list` (data-model §1): the logger, 1 to 5 distinct messages, the level,
 * the source file and line, the last and first occurrence in seconds since the epoch, the
 * formatted traceback (`""` when none) and the number of occurrences.
 */
export interface RawLogEntry {
  name: string;
  message: string[];
  level: RawLevel;
  source: [string, number];
  timestamp: number;
  exception: string;
  count: number;
  first_occurred: number;
}

/** Why `entry` is not a system log entry, or `null` when it is one. */
function problemOf(entry: unknown): string | null {
  if (!isObject(entry)) return "an entry was not an object";
  if (typeof entry["name"] !== "string") return 'an entry had no string "name"';
  const message = entry["message"];
  if (
    !Array.isArray(message) ||
    message.length === 0 ||
    !message.every((m) => typeof m === "string")
  ) {
    return 'an entry had no list of strings "message"';
  }
  if (!RAW_LEVELS.includes(entry["level"] as RawLevel)) {
    return 'an entry had a "level" other than WARNING, ERROR or CRITICAL';
  }
  const source = entry["source"];
  if (
    !Array.isArray(source) ||
    source.length !== 2 ||
    typeof source[0] !== "string" ||
    !Number.isInteger(source[1])
  ) {
    return 'an entry had no "source" of a path and a line';
  }
  if (typeof entry["timestamp"] !== "number") {
    return 'an entry had no numeric "timestamp"';
  }
  if (typeof entry["first_occurred"] !== "number") {
    return 'an entry had no numeric "first_occurred"';
  }
  if (typeof entry["exception"] !== "string") {
    return 'an entry had no string "exception"';
  }
  const count = entry["count"];
  if (!Number.isInteger(count) || (count as number) < 1) {
    return 'an entry had no "count" of at least 1';
  }
  return null;
}

/**
 * Reads the instance's system log (research R1). Any failure is an error and no entries; an
 * unknown command means the integration is not loaded. The answer is validated, never trusted.
 */
export async function readSystemLog(client: HaClient): Promise<RawLogEntry[]> {
  let result: unknown;
  try {
    result = await client.command("system_log/list");
  } catch (error) {
    if (
      error instanceof ToolError &&
      error.kind === "retrieval_failed" &&
      error.haCode === "unknown_command"
    ) {
      throw errors.systemLogUnavailable();
    }
    throw error;
  }
  if (!Array.isArray(result)) {
    throw errors.protocolError(
      "the system log was not a list",
      client.haVersion,
    );
  }
  for (const entry of result) {
    const problem = problemOf(entry);
    if (problem !== null) {
      throw errors.protocolError(
        `the system log is malformed: ${problem}`,
        client.haVersion,
      );
    }
  }
  return result as RawLogEntry[];
}
