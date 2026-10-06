import { errors } from "../errors.js";
import type { HaClient } from "./client.js";

/** What every tool that reads history needs to know about the instance before it queries it. */
export interface Instance {
  haVersion: string;
  /** IANA name, from `get_config`. */
  timeZone: string;
  /** The instance's own coordinates, for redaction rule C3. Never emitted. */
  latitude: unknown;
  longitude: unknown;
  /** The loaded integrations, from `get_config`. */
  components: readonly unknown[];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Requires an administrator user (one shared configuration and error set for every tool, 002
 * research R2), then reads the core config: the time zone times are resolved in, and the list of
 * loaded integrations, so a tool can tell that its integration is missing.
 */
export async function readInstance(client: HaClient): Promise<Instance> {
  const haVersion = client.haVersion;
  const user = await client.command("auth/current_user");
  if (!isObject(user)) {
    throw errors.protocolError("the current user was not an object", haVersion);
  }
  if (user["is_admin"] !== true) throw errors.notAdmin("history");

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
  return {
    haVersion,
    timeZone,
    latitude: config["latitude"],
    longitude: config["longitude"],
    components,
  };
}
