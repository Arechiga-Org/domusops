import type { JsonObject } from "@domusops/schema";
import type { HaState } from "../../src/ha/states.js";
import { REFERENCE_500, type Fixture } from "../fixtures/generate.js";

/** Synthetic state objects and fixtures for `ha_state` tests (specs/010-ha-state). */

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A valid ULID whose timestamp is `ms` and whose random part is derived from `seed`. */
export function ulidAt(ms: number, seed: number): string {
  let time = "";
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  let random = "";
  let value = seed + 1;
  for (let i = 0; i < 16; i++) {
    random += ULID_ALPHABET.charAt((value * 7 + i * 13) % 32);
    value = Math.floor(value / 2) + i;
  }
  return time + random;
}

/** 2026-09-28T19:00:00Z, 21:00 in Europe/Amsterdam. */
export const BASE_MS = Date.UTC(2026, 8, 28, 19, 0, 0);

const iso = (ms: number): string =>
  new Date(ms).toISOString().replace("Z", "+00:00");

let seed = 0;

/** A state object; times are seconds after `BASE_MS`, and every time is equal by default. */
export function stateOf(
  entityId: string,
  state: string,
  attributes: JsonObject = {},
  options: {
    changed?: number;
    updated?: number;
    reported?: number;
    parent?: boolean;
    user?: string;
  } = {},
): HaState {
  const changed = BASE_MS + (options.changed ?? 0) * 1000 + 123;
  const updated =
    BASE_MS + (options.updated ?? options.changed ?? 0) * 1000 + 456;
  const reported =
    BASE_MS +
    (options.reported ?? options.updated ?? options.changed ?? 0) * 1000 +
    789;
  return {
    entity_id: entityId,
    state,
    attributes,
    last_changed: iso(changed),
    last_reported: iso(reported),
    last_updated: iso(updated),
    context: {
      id: ulidAt(updated, seed++),
      parent_id: options.parent === true ? ulidAt(updated - 50, seed++) : null,
      user_id: options.user ?? null,
    },
  };
}

/** A fixture with the reference instance's config and user, and only these states. */
export function fixtureOf(states: readonly unknown[]): Fixture {
  return {
    ...REFERENCE_500,
    records: {
      ...REFERENCE_500.records,
      states: states as Fixture["records"]["states"],
    },
  };
}

/** A small home: lights, switches, sensors and one firmware update entity. */
export const SMALL_HOME: HaState[] = [
  stateOf(
    "light.porch",
    "on",
    { brightness: 90, friendly_name: "Porch" },
    { changed: -7200 },
  ),
  stateOf(
    "light.kitchen",
    "on",
    { brightness: 255, friendly_name: "Kitchen" },
    { changed: 0, parent: true },
  ),
  stateOf(
    "light.desk",
    "off",
    { brightness: null, friendly_name: "Desk" },
    { changed: -86400, updated: -86398 },
  ),
  stateOf(
    "light.hallway",
    "unavailable",
    { friendly_name: "Hallway", restored: true },
    { changed: -3600 },
  ),
  stateOf(
    "switch.kettle",
    "off",
    { friendly_name: "Kettle" },
    { changed: -600, user: "a1b2c3d4e5f60718293a4b5c6d7e8f90" },
  ),
  stateOf("switch.fan", "on", { friendly_name: "Fan" }, { changed: -60 }),
  stateOf(
    "sensor.outdoor_temperature",
    "14.2",
    {
      unit_of_measurement: "°C",
      device_class: "temperature",
      friendly_name: "Outdoor temperature",
    },
    { changed: -30, reported: 0 },
  ),
  stateOf(
    "sensor.indoor_temperature",
    "unknown",
    {
      unit_of_measurement: "°C",
      device_class: "temperature",
      friendly_name: "Indoor temperature",
    },
    { changed: -45 },
  ),
  stateOf(
    "update.hub_firmware",
    "off",
    { friendly_name: "Hub firmware", installed_version: "1.2.3" },
    { changed: -9000 },
  ),
];
