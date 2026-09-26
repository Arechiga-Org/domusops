import type { LogbookRow } from "@domusops/schema";
import { errors, ToolError } from "../errors.js";
import type { HaClient } from "./client.js";

/** What a logbook query needs to know about the instance before it can resolve a window. */
export interface LogbookContext {
  haVersion: string;
  /** IANA name, from `get_config`. */
  timeZone: string;
  /** The instance's own coordinates, for redaction rule C3. Never emitted. */
  latitude: unknown;
  longitude: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Requires an administrator user (one shared configuration and error set with `ha_snapshot`,
 * research R2), then reads the core config: the time zone the window is resolved in, and whether
 * the logbook is loaded at all.
 */
export async function readContext(client: HaClient): Promise<LogbookContext> {
  const haVersion = client.haVersion;
  const user = await client.command("auth/current_user");
  if (!isObject(user)) {
    throw errors.protocolError("the current user was not an object", haVersion);
  }
  if (user["is_admin"] !== true) throw errors.notAdmin();

  const config = await client.command("get_config");
  if (!isObject(config)) {
    throw errors.protocolError("the core config was not an object", haVersion);
  }
  const timeZone = config["time_zone"];
  if (typeof timeZone !== "string" || timeZone === "") {
    throw errors.protocolError("the core config has no time zone", haVersion);
  }
  const components = config["components"];
  if (!Array.isArray(components)) {
    throw errors.protocolError(
      "the core config has no list of components",
      haVersion,
    );
  }
  if (!components.includes("logbook")) throw errors.historyUnavailable();
  return {
    haVersion,
    timeZone,
    latitude: config["latitude"],
    longitude: config["longitude"],
  };
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
    throw errors.protocolError("the logbook events were not a list", client.haVersion);
  }
  for (const row of result) {
    if (!isObject(row) || typeof row["when"] !== "number") {
      throw errors.protocolError(
        "a logbook event had no numeric \"when\"",
        client.haVersion,
      );
    }
  }
  return result as LogbookRow[];
}
