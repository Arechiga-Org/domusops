import type { LogbookRow } from "@domusops/schema";
import { errors, ToolError } from "../errors.js";
import type { HaClient } from "./client.js";
import { isObject, readInstance, type Instance } from "./instance.js";

/** What a logbook query needs to know about the instance before it can resolve a window. */
export type LogbookContext = Omit<Instance, "components">;

/**
 * Requires an administrator user and reads the core config (`readInstance`), then requires the
 * logbook to be loaded at all.
 */
export async function readContext(client: HaClient): Promise<LogbookContext> {
  const { components, ...context } = await readInstance(client);
  if (!components.includes("logbook")) throw errors.historyUnavailable();
  return context;
}

/**
 * Reads the events of one window. Any failure is an error and no rows: a partial history looks
 * like a complete one (spec FR-017). The result is validated, never trusted.
 */
export async function fetchEvents(
  client: HaClient,
  startIso: string,
  endIso: string,
  entityIds?: string[],
): Promise<LogbookRow[]> {
  let result: unknown;
  try {
    result = await client.command("logbook/get_events", {
      start_time: startIso,
      end_time: endIso,
      ...(entityIds === undefined ? {} : { entity_ids: entityIds }),
    });
  } catch (error) {
    if (
      error instanceof ToolError &&
      error.kind === "retrieval_failed" &&
      error.causeText.includes("unknown_command")
    ) {
      throw errors.historyUnavailable();
    }
    throw error;
  }
  if (!Array.isArray(result)) {
    throw errors.protocolError(
      "the logbook events were not a list",
      client.haVersion,
    );
  }
  for (const row of result) {
    if (!isObject(row) || typeof row["when"] !== "number") {
      throw errors.protocolError(
        'a logbook event had no numeric "when"',
        client.haVersion,
      );
    }
  }
  return result as LogbookRow[];
}
