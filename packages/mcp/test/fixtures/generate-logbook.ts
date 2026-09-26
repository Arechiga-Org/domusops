import type { LogbookRow } from "@domusops/schema";
import { Rng, type Fixture } from "./generate.js";

/**
 * Deterministic generator of raw `logbook/get_events` rows, shaped like the rows of research R1 and
 * calibrated to the live measurements of research R5 and R7.
 *
 * Calibration (fixed before encoder work; changing it needs a comment here saying why): the mix of
 * events by domain (sensor 34%, automation 25%, media_player 10%, light 8%, script 6%,
 * binary_sensor 5%, the rest spread over about 16 other domains), 21% of events with a cause drawn
 * from about 50 distinct ones, automation and script rows with `name`, `message`, `source`,
 * `domain`, and a ULID `context_id` (0 to 27 s before the event), 1% of events without an entity,
 * events arriving in bursts within about a second, and about 200 raw bytes per event. Every entity
 * and cause is generated from the seed, never copied from a real instance.
 */

export interface LogbookFixture extends Fixture {
  logbook: LogbookRow[];
  /** The window the rows were generated for, in seconds since the epoch. */
  window: { start: number; end: number };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 2026-03-14T10:00:00Z: a fixed past instant, so no test depends on the clock, and no DST change falls in the 24 hours before it in Europe/Madrid (UTC+1). */
const WINDOW_END = 1_773_482_400;

function ulidAt(rng: Rng, ms: number): string {
  let stamp = "";
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    stamp = CROCKFORD.charAt(rest % 32) + stamp;
    rest = Math.floor(rest / 32);
  }
  let tail = "";
  for (let i = 0; i < 16; i++) tail += CROCKFORD.charAt(rng.int(0, 31));
  return stamp + tail;
}

const WORDS = [
  "hallway", "kitchen", "garage", "porch", "bedroom", "office", "garden", "attic", "basement",
  "studio", "terrace", "laundry", "nursery", "lounge", "pantry", "cellar", "balcony", "entry",
];
const AREAS = ["upstairs", "downstairs", "north", "south", "east", "west", "main", "guest"];
const THINGS = [
  "motion", "door", "window", "lamp", "fan", "speaker", "vacuum", "heater", "blind", "camera",
  "sensor", "plug", "strip", "lock", "scene", "timer",
];
const KINDS = ["occupancy", "status", "presence", "activity", "mode", "state", "schedule", "alert"];
const IDLE = ["idle", "playing", "paused", "off", "standby", "unavailable"];

interface Entity {
  id: string;
  domain: string;
  name: string;
  weight: number;
}

/** Share of events by domain (research R5); the remainder is spread over the tail domains. */
const MIX: readonly { domain: string; share: number; entities: number }[] = [
  { domain: "sensor", share: 0.34, entities: 30 },
  { domain: "automation", share: 0.25, entities: 18 },
  { domain: "media_player", share: 0.1, entities: 8 },
  { domain: "light", share: 0.08, entities: 16 },
  { domain: "script", share: 0.06, entities: 8 },
  { domain: "binary_sensor", share: 0.05, entities: 20 },
];
const TAIL = [
  "number", "input_number", "button", "weather", "update", "select", "input_select", "event",
  "remote", "device_tracker", "person", "zone", "switch", "conversation", "sun", "climate",
];

function buildEntities(rng: Rng, count: number): Entity[] {
  const scale = count / 150;
  const entities: Entity[] = [];
  const used = new Set<string>();
  const add = (domain: string, share: number, n: number): void => {
    const each = share / Math.max(n, 1);
    for (let i = 0; i < n; i++) {
      let object: string;
      do {
        object = `${rng.pick(AREAS)}_${rng.pick(WORDS)}_${rng.pick(THINGS)}_${rng.pick(KINDS)}${rng.chance(0.4) ? `_${rng.int(1, 9)}` : ""}`;
      } while (used.has(`${domain}.${object}`));
      used.add(`${domain}.${object}`);
      // Zipf-like: a few entities dominate, as on a real instance.
      const weight = each * (0.2 + 1.6 * rng.next() ** 2);
      entities.push({
        id: `${domain}.${object}`,
        domain,
        name: object.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
        weight,
      });
    }
  };
  for (const m of MIX) add(m.domain, m.share, Math.max(1, Math.round(m.entities * scale)));
  const tailShare = 1 - MIX.reduce((sum, m) => sum + m.share, 0);
  for (const domain of TAIL) add(domain, tailShare / TAIL.length, Math.max(1, Math.round(scale)));
  return entities;
}

interface Cause {
  fields: Record<string, string>;
}

function buildCauses(rng: Rng, entities: Entity[], count: number): Cause[] {
  const automations = entities.filter((e) => e.domain === "automation");
  const lights = entities.filter((e) => e.domain === "light" || e.domain === "media_player");
  const causes: Cause[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    if (roll < 0.5 && automations.length > 0) {
      const a = rng.pick(automations);
      causes.push({
        fields: {
          context_event_type: "automation_triggered",
          context_domain: "automation",
          context_name: a.name,
          context_message: "triggered",
          context_source: `state of ${rng.pick(AREAS)} ${rng.pick(WORDS)} ${rng.pick(THINGS)} ${rng.pick(KINDS)}`,
          context_entity_id: a.id,
        },
      });
    } else if (roll < 0.8 && lights.length > 0) {
      const e = rng.pick(lights);
      causes.push({
        fields: { context_state: rng.pick(["on", "off", "playing", "idle"]), context_entity_id: e.id },
      });
    } else if (roll < 0.95) {
      causes.push({
        fields: {
          context_event_type: "call_service",
          context_domain: rng.pick(["light", "media_player", "script", "switch"]),
          context_service: rng.pick(["turn_on", "turn_off", "toggle", "media_play"]),
        },
      });
    } else {
      causes.push({
        fields: {
          context_user_id: rng.hex(32),
          context_domain: rng.pick(["light", "climate"]),
          context_service: "turn_on",
          context_event_type: "call_service",
        },
      });
    }
  }
  return causes;
}

function pickWeighted(rng: Rng, entities: Entity[], total: number): Entity {
  let roll = rng.next() * total;
  for (const e of entities) {
    roll -= e.weight;
    if (roll < 0) return e;
  }
  return entities[entities.length - 1] as Entity;
}

function stateFor(rng: Rng, e: Entity): string {
  switch (e.domain) {
    case "light":
    case "switch":
    case "binary_sensor":
    case "remote":
      return rng.pick(["on", "off"]);
    case "media_player":
      return rng.pick(["playing", "paused", "idle", "off", "unavailable"]);
    case "automation":
    case "script":
      return "on";
    case "person":
    case "device_tracker":
      return rng.pick(["home", "not_home"]);
    case "sensor":
      return rng.pick(IDLE);
    case "update":
      return rng.pick(["on", "off"]);
    case "number":
    case "input_number":
      return String(rng.int(0, 100));
    case "weather":
      return rng.pick(["sunny", "cloudy", "rainy", "clear-night", "partlycloudy"]);
    default:
      return rng.pick(["idle", "on", "off", "unknown", "2026-09-26T08:12:44+00:00"]);
  }
}

export function generateLogbook(
  eventCount: number,
  entityCount: number,
  seed: number,
): LogbookFixture {
  const rng = new Rng(seed);
  const end = WINDOW_END;
  const start = end - 24 * 3600;
  const rows: LogbookRow[] = [];
  const entities = buildEntities(rng, entityCount);
  const total = entities.reduce((sum, e) => sum + e.weight, 0);
  const causes = buildCauses(rng, entities, 50);
  const autoSources = new Map<string, string[]>();

  while (rows.length < eventCount) {
    // A burst: one moment, one cause, one to a few rows within about a second.
    const at = start + rng.next() * (end - start);
    const burst = rng.weighted([
      { w: 6, v: 1 },
      { w: 3, v: 2 },
      { w: 1, v: 5 },
    ]);
    const cause = rng.chance(0.21) ? rng.pick(causes) : null;
    for (let i = 0; i < burst && rows.length < eventCount; i++) {
      const when = Number((at + rng.next() * 0.9).toFixed(6));
      if (rng.chance(0.01)) {
        rows.push({
          when,
          name: "Home Assistant",
          message: rng.pick(["started", "stopped"]),
          domain: "homeassistant",
        });
        continue;
      }
      const e = pickWeighted(rng, entities, total);
      const row: LogbookRow = { when, entity_id: e.id };
      if (e.domain === "automation" || e.domain === "script") {
        let sources = autoSources.get(e.id);
        if (sources === undefined) {
          sources = Array.from({ length: rng.int(1, 3) }, () => `state of ${rng.pick(AREAS)} ${rng.pick(WORDS)} ${rng.pick(THINGS)} ${rng.pick(KINDS)}`);
          autoSources.set(e.id, sources);
        }
        const source = rng.pick(sources);
        row.name = e.name;
        row.message = `triggered by ${source}`;
        row.source = source;
        row.domain = e.domain;
        row.context_id = ulidAt(rng, Math.round(when * 1000) - rng.weighted([{ w: 5, v: 0 }, { w: 40, v: rng.int(1, 5) }, { w: 2, v: rng.int(1000, 27000) }]));
      } else {
        row.state = stateFor(rng, e);
        if (rng.chance(0.16)) row.icon = `mdi:${rng.pick(["lightbulb", "speaker", "motion-sensor", "door", "fan"])}`;
      }
      if (cause !== null) Object.assign(row, cause.fields);
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.when - b.when);

  return {
    haVersion: "2026.9.1",
    user: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Owner", is_owner: true, is_admin: true },
    records: {
      config: {
        version: "2026.9.1",
        time_zone: "Europe/Madrid",
        components: ["logbook", "recorder", "light", "sensor"],
        latitude: 41.385064,
        longitude: 2.173404,
        location_name: "Home",
      },
      states: [],
      entity_registry: [],
      device_registry: [],
      area_registry: [],
      config_entries: [],
    },
    logbook: rows,
    window: { start, end },
  };
}

export const REFERENCE_LOGBOOK_24H: LogbookFixture = generateLogbook(2100, 150, 2100);
export const PERFORMANCE_LOGBOOK: LogbookFixture = generateLogbook(10_000, 1000, 10_000);
export const LOGBOOK_EMPTY: LogbookFixture = generateLogbook(0, 10, 0);
