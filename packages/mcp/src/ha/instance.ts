import { errors } from "../errors.js";
import { isObject } from "../util/json.js";
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
  /**
   * The configuration directory, from `get_config`, when it is a non-empty string. Optional here
   * so no tool fails on it; `ha_system_log` requires it (specs/012-ha-system-log research R2, R7).
   */
  configDir?: string;
}

/** The current user as `auth/current_user` answered, and whether they are an administrator. */
export interface CurrentUser {
  raw: Record<string, unknown>;
  isAdmin: boolean;
}

/** Reads the current user. Does not require an administrator: `readInstance` does. */
export async function readCurrentUser(client: HaClient): Promise<CurrentUser> {
  const user = await client.command("auth/current_user");
  if (!isObject(user)) {
    throw errors.protocolError(
      "the current user was not an object",
      client.haVersion,
    );
  }
  return { raw: user, isAdmin: user["is_admin"] === true };
}

/** The core configuration as `get_config` answered, and the part of it tools use. */
export interface Core {
  raw: Record<string, unknown>;
  instance: Instance;
}

/** Reads the core config: the time zone times are resolved in, and the loaded integrations. */
export async function readCore(client: HaClient): Promise<Core> {
  const haVersion = client.haVersion;
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
  const configDir = config["config_dir"];
  return {
    raw: config,
    instance: {
      haVersion,
      timeZone,
      latitude: config["latitude"],
      longitude: config["longitude"],
      components,
      ...(typeof configDir === "string" && configDir !== ""
        ? { configDir }
        : {}),
    },
  };
}

/**
 * Requires an administrator user (one shared configuration and error set for every tool, 002
 * research R2), then reads the core config: the time zone times are resolved in, and the list of
 * loaded integrations, so a tool can tell that its integration is missing.
 */
export async function readInstance(client: HaClient): Promise<Instance> {
  const user = await readCurrentUser(client);
  if (!user.isAdmin) throw errors.notAdmin("history");
  return (await readCore(client)).instance;
}

/**
 * Sends the current user and core config reads together, then requires an administrator before
 * using the core config: nothing of the instance is used for a user who is not one. The reads
 * settle in the order they are sent.
 */
export async function readAdminInstance(client: HaClient): Promise<Instance> {
  const current = readCurrentUser(client);
  const core = readCore(client);
  core.catch(() => undefined);
  const user = await current;
  if (!user.isAdmin) throw errors.notAdmin("required");
  return (await core).instance;
}
