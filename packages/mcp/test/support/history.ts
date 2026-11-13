import type { JsonObject } from "@domusops/schema";
import type { Fixture, RecordedState } from "../fixtures/generate.js";
import { REFERENCE_HISTORY } from "../fixtures/generate-history.js";

/** Synthetic recorded histories for `ha_history` tests (specs/011-ha-history). */

/** 2026-09-28T08:00:00 in Europe/Madrid (+02:00), the start of the test window, in seconds. */
export const W0 = Date.UTC(2026, 8, 28, 6, 0, 0) / 1000;
/** Two hours after `W0`. */
export const W1 = W0 + 7200;
/** The call time of every test: ten minutes after the window. */
export const NOW_MS = (W1 + 600) * 1000;
export const WINDOW = {
  start: "2026-09-28T08:00:00",
  end: "2026-09-28T10:00:00",
};

/**
 * One entity's recorded states from `[seconds after W0, state, attributes]` steps, with the
 * recorder's `lc` and a sub-second part on every time, as the instance gives.
 */
export function timeline(
  steps: readonly [number, string, JsonObject][],
): RecordedState[] {
  const entries: RecordedState[] = [];
  for (const [offset, state, attributes] of steps) {
    const lu = W0 + offset + 0.123456;
    const previous = entries.at(-1);
    entries.push({
      s: state,
      a: attributes,
      lu,
      lc: previous === undefined || previous.s !== state ? lu : previous.lc,
    });
  }
  return entries;
}

const iso = (seconds: number): string =>
  new Date(Math.round(seconds * 1000)).toISOString().replace("Z", "+00:00");

/**
 * A fixture with the reference history's config and user, these histories, and current states
 * for `current` (every entity with a history by default).
 */
export function historyFixture(
  history: Record<string, RecordedState[]>,
  current: readonly string[] = Object.keys(history),
): Fixture {
  const states = [...current].sort().map((id) => {
    const last = history[id]?.at(-1) ?? {
      s: "on",
      a: {},
      lu: W0 - 60,
      lc: W0 - 60,
    };
    return {
      entity_id: id,
      state: last.s,
      attributes: last.a,
      last_changed: iso(last.lc),
      last_updated: iso(last.lu),
      last_reported: iso(last.lu),
      context: {
        id: "01JAF5Q2W8E4R6T1Y3V7M9N0PQ",
        parent_id: null,
        user_id: null,
      },
    };
  });
  return {
    ...REFERENCE_HISTORY,
    records: {
      ...REFERENCE_HISTORY.records,
      states: states as unknown as Fixture["records"]["states"],
    },
    history,
  };
}

/** A small home's last hours, with every case of the listing rule (data-model §5). */
export const SMALL_HISTORY: Record<string, RecordedState[]> = {
  "light.porch": timeline([
    [-3600, "off", { brightness: null, friendly_name: "Porch" }],
    [600, "on", { brightness: 100, friendly_name: "Porch" }],
    [900, "on", { brightness: 150, friendly_name: "Porch" }],
    [1800, "off", { brightness: null, friendly_name: "Porch" }],
  ]),
  "device_tracker.phone": timeline([
    [-7200, "home", { battery_level: 80, friendly_name: "Phone" }],
    [300, "home", { battery_level: 79, friendly_name: "Phone" }],
    [1200, "not_home", { battery_level: 79, friendly_name: "Phone" }],
  ]),
  "switch.kettle": timeline([[-86400, "off", { friendly_name: "Kettle" }]]),
  "sensor.outdoor": timeline([
    [-600, "14.2", { unit_of_measurement: "°C" }],
    [400, "unavailable", { unit_of_measurement: "°C" }],
    [500, "unknown", { unit_of_measurement: "°C" }],
  ]),
  "switch.new": timeline([
    [1000, "on", { friendly_name: "New" }],
    [1000.5, "off", { friendly_name: "New" }],
  ]),
  "sensor.gone": timeline([
    [-300, "1", { friendly_name: "Gone" }],
    [100, "2", { friendly_name: "Gone" }],
  ]),
};

/** `SMALL_HISTORY`, with every entity current except `sensor.gone` (removed since). */
export const SMALL_HOME = historyFixture(
  SMALL_HISTORY,
  Object.keys(SMALL_HISTORY).filter((id) => id !== "sensor.gone"),
);
