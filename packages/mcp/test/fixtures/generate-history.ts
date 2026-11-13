import type { JsonObject } from "@domusops/schema";
import { Rng, type Fixture, type RecordedState } from "./generate.js";

/**
 * Deterministic generator of a recorded history, served by the fake instance's
 * `history/history_during_period` (specs/011-ha-history research R16).
 *
 * Calibration (fixed before encoder work; changing it needs a comment here saying why), from the
 * prototype of research R12: two temperature sensors reporting every minute, one power sensor
 * every 10 seconds, one phone tracker every 5 to 6 minutes (battery, accuracy and coordinates
 * change, its zone rarely), three lights changing about 60 times a day (brightness and color
 * temperature, with and without a state change), four binary sensors about every 15 minutes, one
 * switch created inside the window, and one firmware sensor with no change in the window. Every
 * entity but the new switch has a recorded state before the window. Times carry microseconds, as
 * the instance's do. Every name is generated from the seed, never copied from a real instance.
 */

export interface HistoryFixture extends Fixture {
  history: Record<string, RecordedState[]>;
  /** The window the history was generated for, in seconds since the epoch. */
  window: { start: number; end: number };
}

/** 2026-03-14T10:00:00Z: a fixed past instant with no DST change in the 24 hours before it in Europe/Madrid. */
const WINDOW_END = 1_773_482_400;
const DAY = 86_400;

const PLACES = [
  "attic",
  "cellar",
  "studio",
  "landing",
  "pantry",
  "loft",
  "porch",
  "nook",
  "gallery",
  "annex",
  "foyer",
  "mezzanine",
  "veranda",
];

/** Builds one entity's recorded states, keeping `lc` as the recorder does. */
class Timeline {
  readonly entries: RecordedState[] = [];

  record(at: number, state: string, attributes: JsonObject): void {
    const previous = this.entries.at(-1);
    const lu = Math.round(at * 1e6) / 1e6;
    const lc =
      previous === undefined || previous.s !== state ? lu : previous.lc;
    this.entries.push({ s: state, a: attributes, lu, lc });
  }

  get last(): RecordedState | undefined {
    return this.entries.at(-1);
  }
}

function iso(seconds: number): string {
  return new Date(Math.round(seconds * 1000))
    .toISOString()
    .replace("Z", "+00:00");
}

export function generateHistory(
  seed: number,
  end = WINDOW_END,
): HistoryFixture {
  const rng = new Rng(seed);
  const start = end - DAY;
  const places = [...PLACES];
  const place = (): string =>
    places.splice(rng.int(0, places.length - 1), 1)[0] as string;
  const jitter = (): number => rng.next();
  const history: Record<string, Timeline> = {};
  const timeline = (id: string): Timeline => (history[id] ??= new Timeline());

  for (let n = 0; n < 2; n++) {
    const where = place();
    const id = `sensor.${where}_temperature`;
    const attributes = {
      state_class: "measurement",
      unit_of_measurement: "°C",
      device_class: "temperature",
      friendly_name: `${where} temperature`,
    };
    for (let t = start - 50 - 60 * rng.next(); t < end; t += 60 + jitter()) {
      timeline(id).record(t, (19 + rng.next() * 3).toFixed(1), attributes);
    }
  }

  {
    const where = place();
    const id = `sensor.${where}_power`;
    const attributes = {
      state_class: "measurement",
      unit_of_measurement: "W",
      device_class: "power",
      friendly_name: `${where} power`,
    };
    for (let t = start - 7; t < end; t += 10 + jitter()) {
      timeline(id).record(t, (rng.next() * 300).toFixed(1), attributes);
    }
  }

  {
    const id = `device_tracker.${place()}_phone`;
    let zone = "home";
    let battery = 90;
    for (let t = start - 200; t < end; t += 300 + rng.next() * 60) {
      if (rng.chance(0.3)) battery = Math.max(5, battery - 1);
      if (rng.chance(0.02)) zone = zone === "home" ? "not_home" : "home";
      timeline(id).record(t, zone, {
        source_type: "gps",
        battery_level: battery,
        battery_state: "Not Charging",
        gps_accuracy: rng.pick([5, 8, 12, 20]),
        latitude: Math.round(rng.next() * 1e5) / 1e5,
        longitude: Math.round(rng.next() * 1e5) / 1e5,
        altitude: rng.int(0, 40),
        friendly_name: "Phone",
      });
    }
  }

  for (let n = 0; n < 3; n++) {
    const where = place();
    const id = `light.${where}`;
    const base = {
      supported_color_modes: ["color_temp"],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6535,
      friendly_name: `${where} light`,
      supported_features: 44,
    };
    const off = {
      ...base,
      color_mode: null,
      brightness: null,
      color_temp_kelvin: null,
    };
    timeline(id).record(start - 3600 * rng.next() - 1, "off", off);
    let t = start;
    for (let k = 0; k < 60; k++) {
      t += rng.next() * 1400;
      if (t >= end) break;
      const state = rng.chance(0.3)
        ? timeline(id).last?.s === "on"
          ? "off"
          : "on"
        : (timeline(id).last?.s ?? "off");
      timeline(id).record(
        t,
        state,
        state === "on"
          ? {
              ...base,
              color_mode: "color_temp",
              brightness: rng.int(1, 255),
              color_temp_kelvin: rng.pick([2700, 3000, 4000]),
            }
          : off,
      );
    }
  }

  for (let n = 0; n < 4; n++) {
    const where = place();
    const id = `binary_sensor.${where}_door`;
    const attributes = { device_class: "door", friendly_name: `${where} door` };
    for (let t = start - 600; t < end; t += 900 + rng.next() * 60) {
      timeline(id).record(t, rng.pick(["on", "off"]), attributes);
    }
  }

  {
    const id = "switch.new_heater";
    const attributes = { friendly_name: "New heater" };
    for (let t = start + 3 * 3600; t < end; t += 3600 + rng.next() * 600) {
      timeline(id).record(
        t,
        timeline(id).last?.s === "on" ? "off" : "on",
        attributes,
      );
    }
  }

  timeline("sensor.hub_firmware").record(start - 5 * DAY, "1.2.3", {
    friendly_name: "Hub firmware",
  });

  const ids = Object.keys(history).sort();
  const states = ids.map((id) => {
    const last = history[id]?.last as RecordedState;
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
    haVersion: "2026.10.0",
    user: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Owner",
      is_owner: true,
      is_admin: true,
    },
    records: {
      config: {
        version: "2026.10.0",
        time_zone: "Europe/Madrid",
        components: ["history", "recorder", "logbook", "light", "sensor"],
        latitude: 41.385064,
        longitude: 2.173404,
        location_name: "Home",
      },
      states: states as unknown as Fixture["records"]["states"],
      entity_registry: [],
      device_registry: [],
      area_registry: [],
      config_entries: [],
    },
    history: Object.fromEntries(
      ids.map((id) => [id, history[id]?.entries ?? []]),
    ),
    window: { start, end },
  };
}

export const REFERENCE_HISTORY: HistoryFixture = generateHistory(1100);
