import type {
  RawArea,
  RawConfig,
  RawConfigEntry,
  RawDevice,
  RawEntityRegistryEntry,
  RawRecords,
  RawState,
} from "@domusops/schema";
import { errors } from "../errors.js";
import type { HaClient } from "./client.js";

export interface Retrieved {
  haVersion: string;
  records: RawRecords;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(
  value: unknown,
  what: string,
  haVersion: string,
): Record<string, unknown> {
  if (!isObject(value))
    throw errors.protocolError(`${what} was not an object`, haVersion);
  return value;
}

/** Checks that `value` is an array of objects that each carry a string identity field. */
function expectRecords<T>(
  value: unknown,
  what: string,
  identity: string,
  haVersion: string,
): T[] {
  if (!Array.isArray(value))
    throw errors.protocolError(`${what} was not a list`, haVersion);
  for (const item of value) {
    if (!isObject(item) || typeof item[identity] !== "string") {
      throw errors.protocolError(
        `${what} contained a record without a string "${identity}"`,
        haVersion,
      );
    }
  }
  return value as T[];
}

/**
 * Reads everything a snapshot needs, all or nothing. It first requires an administrator user, so
 * entity states are unfiltered, then sends the six data commands together and awaits them all.
 */
export async function retrieve(client: HaClient): Promise<Retrieved> {
  const haVersion = client.haVersion;
  const user = expectObject(
    await client.command("auth/current_user"),
    "the current user",
    haVersion,
  );
  if (user["is_admin"] !== true) throw errors.notAdmin();

  const [
    config,
    states,
    entityRegistry,
    deviceRegistry,
    areaRegistry,
    configEntries,
  ] = await Promise.all([
    client.command("get_config"),
    client.command("get_states"),
    client.command("config/entity_registry/list"),
    client.command("config/device_registry/list"),
    client.command("config/area_registry/list"),
    client.command("config_entries/get"),
  ]);

  const records: RawRecords = {
    config: expectObject(config, "the core config", haVersion) as RawConfig,
    states: expectRecords<RawState>(
      states,
      "the states",
      "entity_id",
      haVersion,
    ),
    entity_registry: expectRecords<RawEntityRegistryEntry>(
      entityRegistry,
      "the entity registry",
      "entity_id",
      haVersion,
    ),
    device_registry: expectRecords<RawDevice>(
      deviceRegistry,
      "the device registry",
      "id",
      haVersion,
    ),
    area_registry: expectRecords<RawArea>(
      areaRegistry,
      "the area registry",
      "area_id",
      haVersion,
    ),
    config_entries: expectRecords<RawConfigEntry>(
      configEntries,
      "the config entries",
      "entry_id",
      haVersion,
    ),
  };
  return { haVersion, records };
}
