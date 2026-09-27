import {
  formatIsoMicros,
  parseIsoMicros,
  type JsonObject,
  type LogbookRow,
  type TraceExtendedRecord,
  type TraceStepRecord,
} from "@domusops/schema";
import { Rng, type Fixture } from "./generate.js";

/**
 * Deterministic generator of raw `trace/get` records, shaped like the traces of research R1 and
 * calibrated to the live measurements of research R5 and R6.
 *
 * Calibration (fixed before encoder work; changing it needs a comment here saying why): one
 * configuration per item shared by its runs and about a third of the raw bytes, `this` and
 * `trigger` variables carrying full state objects on the first step, `choose` and `repeat` paths,
 * service-call results, free text (notification and prompt messages) on about a tenth of the
 * steps, canonical `isoformat()` timestamps, ULID contexts with about a third of the runs sharing
 * their parent's context, automations that start scripts (a fifth of the stored child runs are
 * already evicted), a median of 6 steps per run (1 to 89), and about 4.3 KB per run. The
 * reference set's `standard` ratio (about 3.15) was tuned to the live one (3.07 on 92 traces,
 * research R6), by adding computed-variable texts, after a first calibration read too high. Every name
 * and value is generated from the seed, never copied from a real instance.
 */

export interface TraceFixture extends Fixture {
  traces: TraceExtendedRecord[];
  /** The logbook rows the runs produced (automation triggered, script started), for SC-007. */
  logbook: LogbookRow[];
  /** The instant the runs were generated up to, in seconds since the epoch. */
  windowEnd: number;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 2026-03-14T10:00:00Z: a fixed past instant, so no test depends on the clock. */
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

const ROOMS = [
  "hallway",
  "kitchen",
  "garage",
  "porch",
  "bedroom",
  "office",
  "garden",
  "attic",
  "basement",
  "studio",
  "terrace",
  "laundry",
];
const KINDS = ["motion", "door", "window", "presence", "lux", "switch"];
const VERBS = [
  "turn the",
  "check the",
  "close the",
  "announce that the",
  "remind everyone about the",
  "warn that the",
];
const TAILS = [
  "is still open after the usual time and nobody has been detected nearby",
  "was left running while the house is in away mode, so it was stopped",
  "needs attention: the last reading is older than the configured limit",
  "changed state twice in a row within a minute, which is unusual today",
];

const sentence = (rng: Rng, room: string): string =>
  `${rng.pick(VERBS)} ${room} ${rng.pick(TAILS)} (${rng.hex(6)})`;

interface Ctx {
  rng: Rng;
  logbook: LogbookRow[];
  scripts: ScriptItem[];
}

interface Item {
  domain: "automation" | "script";
  itemId: string;
  entityId: string;
  alias: string;
  room: string;
  config: JsonObject;
  /** Entities its runs mention. */
  sensor: string;
  target: string;
}

type ScriptItem = Item & { domain: "script" };

const micros = (seconds: number, extra: number): number =>
  seconds * 1_000_000 + extra;

function buildConfig(rng: Rng, item: Item, size: number): JsonObject {
  const actions: JsonObject[] = [];
  for (let i = 0; i < size; i++) {
    const roll = rng.int(0, 3);
    if (roll === 0) {
      actions.push({
        choose: [
          {
            conditions: [
              {
                condition: "state",
                entity_id: item.sensor,
                state: "on",
              },
              { condition: "time", after: "22:00:00", before: "06:00:00" },
            ],
            sequence: [
              {
                action: "light.turn_on",
                target: { entity_id: item.target },
                data: { brightness_pct: rng.int(5, 60), transition: 2 },
              },
            ],
          },
        ],
        default: [
          {
            action: "light.turn_off",
            target: { entity_id: item.target },
          },
        ],
      });
    } else if (roll === 1) {
      actions.push({ delay: { seconds: rng.int(2, 30) } });
    } else if (roll === 2) {
      actions.push({
        action: "notify.mobile_app_phone",
        data: {
          title: `${item.alias} notice`,
          message: `The ${item.room} ${rng.pick(TAILS)}`,
        },
      });
    } else {
      actions.push({
        action: "media_player.play_media",
        target: { entity_id: `media_player.${item.room}_speaker` },
        data: {
          media_content_type: "music",
          media_content_id: `library://playlist/${rng.hex(8)}`,
        },
      });
    }
  }
  return item.domain === "automation"
    ? {
        id: item.itemId,
        alias: item.alias,
        description: `Runs when the ${item.room} ${rng.pick(KINDS)} changes`,
        triggers: [
          {
            trigger: "state",
            entity_id: item.sensor,
            from: "off",
            to: "on",
          },
        ],
        conditions: [
          { condition: "state", entity_id: "input_boolean.night", state: "on" },
        ],
        actions,
        mode: "single",
      }
    : {
        alias: item.alias,
        description: `Helper for the ${item.room}`,
        sequence: actions,
        mode: "queued",
        icon: "mdi:script-text",
      };
}

function buildItems(rng: Rng, count: number, scriptShare: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const script = i >= count - Math.round(count * scriptShare);
    const room = ROOMS[i % ROOMS.length] as string;
    const name = `${room}_${rng.pick(KINDS)}_${i}`;
    const domain = script ? "script" : "automation";
    const item: Item = {
      domain,
      itemId: script ? name : String(1_700_000_000_000 + i * 7919),
      entityId: `${domain}.${name}`,
      alias: `${room[0]?.toUpperCase()}${room.slice(1)} ${rng.pick(KINDS)} ${i}`,
      room,
      config: {},
      sensor: `binary_sensor.${room}_${rng.pick(KINDS)}`,
      target: `light.${room}_${rng.pick(["lamp", "ceiling", "strip"])}`,
    };
    item.config = buildConfig(rng, item, rng.int(6, 12));
    items.push(item);
  }
  return items;
}

function stateObject(
  rng: Rng,
  entityId: string,
  state: string,
  attributes: JsonObject,
  at: number,
  parent: string | null,
): JsonObject {
  const updated = formatIsoMicros(at);
  return {
    entity_id: entityId,
    state,
    attributes,
    last_changed: updated,
    last_reported: rng.chance(0.3)
      ? formatIsoMicros(at + rng.int(1, 900_000))
      : updated,
    last_updated: updated,
    context: {
      id: ulidAt(rng, Math.floor(at / 1000)),
      parent_id: parent,
      user_id: null,
    },
  };
}

function stepCount(rng: Rng): number {
  const roll = rng.next();
  if (roll < 0.6) return rng.int(3, 8);
  if (roll < 0.85) return rng.int(9, 20);
  if (roll < 0.97) return rng.int(1, 2);
  return rng.int(30, 89);
}

interface Made {
  record: TraceExtendedRecord;
  child: TraceExtendedRecord[];
}

function makeRun(
  ctx: Ctx,
  item: Item,
  startSeconds: number,
  parentContext: string | null,
  sharedContext: string | null,
  evictedChild: boolean,
): Made {
  const { rng } = ctx;
  const start = micros(startSeconds, rng.int(1, 999_999));
  const contextMs = Math.floor(start / 1000) - rng.int(0, 15_000);
  const contextId = sharedContext ?? ulidAt(rng, contextMs);
  const changeContext = parentContext ?? ulidAt(rng, contextMs - 5);
  const trace: Record<string, TraceStepRecord[]> = {};
  let at = start;
  const push = (path: string, step: Partial<TraceStepRecord> = {}): void => {
    at += rng.int(150, 40_000);
    (trace[path] ??= []).push({
      path,
      timestamp: formatIsoMicros(at),
      ...step,
    });
  };
  const child: TraceExtendedRecord[] = [];

  const sensorState = (state: string, offset: number): JsonObject =>
    stateObject(
      rng,
      item.sensor,
      state,
      {
        device_class: "motion",
        friendly_name: `${item.room} sensor`,
      },
      start - offset,
      changeContext,
    );
  const first: JsonObject =
    item.domain === "automation"
      ? {
          this: stateObject(
            rng,
            item.entityId,
            "on",
            {
              id: item.itemId,
              last_triggered: formatIsoMicros(
                start - rng.int(60, 86_400) * 1e6,
              ),
              mode: "single",
              current: 0,
              max: 10,
              friendly_name: item.alias,
            },
            start - 3_600_000_000,
            null,
          ),
          trigger: {
            id: "0",
            idx: "0",
            alias: null,
            platform: "state",
            entity_id: item.sensor,
            from_state: sensorState("off", 600_000_000),
            to_state: sensorState("on", 100_000),
            for: null,
            attribute: null,
            description: `state of ${item.sensor}`,
          },
        }
      : {
          this: stateObject(
            rng,
            item.entityId,
            "off",
            {
              last_triggered: formatIsoMicros(
                start - rng.int(60, 86_400) * 1e6,
              ),
              mode: "queued",
              current: 0,
              max: 10,
              friendly_name: item.alias,
            },
            start - 3_600_000_000,
            null,
          ),
        };
  push(item.domain === "automation" ? "trigger/0" : "sequence", {
    changed_variables: first,
  });

  const steps = stepCount(rng);
  let error: string | undefined;
  let scriptExecution = "finished";
  let childStarted = false;
  for (let s = 1; s < steps; s++) {
    const roll = rng.int(0, 9);
    const base = `action/${s % 6}`;
    if (roll <= 2) {
      push(base, {
        result: {
          params: {
            domain: "light",
            service: rng.pick(["turn_on", "turn_off"]),
            service_data: { brightness_pct: rng.int(5, 60) },
            target: { entity_id: [item.target] },
          },
          running_script: false,
          limit: 10,
        },
      });
    } else if (roll <= 4) {
      push(`${base}/choose/0`, { result: { choice: 0 } });
      push(`${base}/choose/0/conditions/0`, {
        result: { result: true, entities: [item.sensor] },
      });
    } else if (
      roll === 5 &&
      item.domain === "automation" &&
      ctx.scripts.length > 0 &&
      !childStarted
    ) {
      childStarted = true;
      const script = rng.pick(ctx.scripts);
      const childRun = makeRun(
        ctx,
        script,
        startSeconds + 1,
        contextId,
        rng.chance(0.75) ? contextId : null,
        false,
      );
      if (!evictedChild) child.push(childRun.record);
      child.push(...childRun.child);
      push(base, {
        result: {
          params: {
            domain: "script",
            service: script.itemId,
            service_data: {},
            target: {},
          },
          running_script: true,
          limit: 10,
        },
        child_id: {
          domain: "script",
          item_id: script.itemId,
          run_id: childRun.record.run_id,
        },
      });
    } else if (roll === 6) {
      push(base, {
        result: {
          params: {
            domain: "notify",
            service: "mobile_app_phone",
            service_data: {
              title: `${item.alias} notice`,
              message: sentence(rng, item.room),
            },
            target: {},
          },
          running_script: false,
          limit: 10,
        },
      });
    } else if (roll === 7) {
      push(`${base}/repeat/sequence/0`, {
        changed_variables: {
          repeat: { first: s === 1, index: s, last: false },
        },
        result: { delay: rng.int(1, 10), done: true },
      });
    } else if (roll === 8 && rng.chance(0.5)) {
      // A computed variable with a text of its own, as an AI prompt or a rendered message is.
      push(base, {
        changed_variables: {
          resultado_ia: `${sentence(rng, item.room)}; ${sentence(rng, item.room)}`,
        },
        result: { delay: rng.float(1, 30, 1), done: true },
      });
    } else {
      push(base, { result: { delay: rng.float(1, 30, 1), done: true } });
    }
  }
  if (rng.chance(0.012)) {
    scriptExecution = "failed_conditions";
    error = undefined;
  }
  const finish = at + rng.int(100, 5_000);
  const lastStep = Object.keys(trace).at(-1) as string;
  const record: TraceExtendedRecord = {
    last_step: lastStep,
    run_id: rng.hex(32),
    state: "stopped",
    script_execution: scriptExecution,
    timestamp: {
      start: formatIsoMicros(start),
      finish: formatIsoMicros(finish),
    },
    domain: item.domain,
    item_id: item.itemId,
    ...(item.domain === "automation"
      ? { trigger: `state of ${item.sensor}` }
      : {}),
    ...(error === undefined ? {} : { error }),
    trace,
    config: item.config,
    blueprint_inputs: null,
    context: {
      id: contextId,
      parent_id: item.domain === "automation" ? changeContext : parentContext,
      user_id: null,
    },
  };
  ctx.logbook.push({
    when: Math.floor(start / 1_000_000),
    name: item.alias,
    message: item.domain === "automation" ? "triggered" : "started",
    source: `state of ${item.sensor}`,
    domain: item.domain,
    entity_id: item.entityId,
    context_id: contextId,
  });
  return { record, child };
}

export function generateTraces(
  itemCount: number,
  runsPerItem: number,
  seed: number,
): TraceFixture {
  const rng = new Rng(seed);
  const items = buildItems(rng, itemCount, 0.3);
  const scripts = items.filter((i): i is ScriptItem => i.domain === "script");
  const ctx: Ctx = { rng, logbook: [], scripts };
  const traces: TraceExtendedRecord[] = [];
  // Scripts first, so a stored child run of a script is generated once and stays stored.
  const seen = new Set<string>();
  const add = (record: TraceExtendedRecord): void => {
    if (!seen.has(record.run_id)) {
      seen.add(record.run_id);
      traces.push(record);
    }
  };
  for (const item of items.filter((i) => i.domain === "automation")) {
    for (let r = 0; r < runsPerItem; r++) {
      const at = WINDOW_END - rng.int(60, 2 * 86_400);
      const made = makeRun(ctx, item, at, null, null, rng.chance(0.2));
      add(made.record);
      for (const child of made.child) add(child);
    }
  }
  // Direct runs of scripts (started by a user or another item), up to the per-item limit.
  for (const script of scripts) {
    const stored = traces.filter((t) => t.item_id === script.itemId).length;
    for (let r = stored; r < runsPerItem; r++) {
      const made = makeRun(
        ctx,
        script,
        WINDOW_END - rng.int(60, 2 * 86_400),
        null,
        null,
        false,
      );
      add(made.record);
    }
  }
  // The instance keeps at most `runsPerItem` runs of each item: keep the newest.
  const kept: TraceExtendedRecord[] = [];
  for (const item of items) {
    kept.push(
      ...traces
        .filter((t) => t.item_id === item.itemId)
        .sort((a, b) => (b.timestamp.start < a.timestamp.start ? -1 : 1))
        .slice(0, runsPerItem),
    );
  }
  kept.sort((a, b) => (a.timestamp.start < b.timestamp.start ? -1 : 1));
  return {
    haVersion: "2026.9.3",
    user: { id: "test-user", name: "Test Admin", is_admin: true },
    records: {
      config: {
        version: "2026.9.3",
        time_zone: "Europe/Madrid",
        components: ["automation", "script", "trace", "logbook", "recorder"],
        latitude: 41.385064,
        longitude: 2.173404,
        location_name: "Home",
      },
      states: items
        .filter((i) => i.domain === "automation")
        .map((i) => ({
          entity_id: i.entityId,
          state: "on",
          attributes: { id: i.itemId, friendly_name: i.alias },
        })),
      entity_registry: items.map((i) => ({
        entity_id: i.entityId,
        unique_id: i.itemId,
        platform: i.domain,
      })),
      device_registry: [],
      area_registry: [],
      config_entries: [],
    },
    traces: kept,
    logbook: ctx.logbook.filter((row) =>
      kept.some((t) => t.context.id === row["context_id"]),
    ),
    windowEnd: WINDOW_END,
  };
}

export const REFERENCE_TRACES: TraceFixture = generateTraces(20, 5, 2026);
export const PERFORMANCE_TRACES: TraceFixture = generateTraces(100, 5, 100);
export const TRACES_EMPTY: TraceFixture = generateTraces(0, 0, 0);

/**
 * Hand-shaped traces for the cases the generator does not produce (research R16): a not-triggered
 * trace, a running trace, an error, a failed condition, a removed item, an automation without an
 * `id`, an item with no stored runs, a blueprint automation, a long repeat, equal step
 * timestamps, and a clock that stepped backwards.
 */
export function generateEdgeTraces(): TraceFixture {
  const base = generateTraces(8, 2, 77);
  const rng = new Rng(4242);
  const automations = base.records.entity_registry.filter(
    (e) => e["platform"] === "automation",
  );
  const pick = (index: number): TraceExtendedRecord => {
    const id = (automations[index] as unknown as { unique_id: string })
      .unique_id;
    return structuredClone(
      base.traces.find(
        (t) => t.item_id === id && Object.keys(t.trace).length > 1,
      ) as TraceExtendedRecord,
    );
  };
  const fresh = (record: TraceExtendedRecord): TraceExtendedRecord => ({
    ...record,
    run_id: rng.hex(32),
    // A run of its own has a context of its own; only child script runs share their parent's.
    context: {
      ...record.context,
      id: ulidAt(
        rng,
        Math.floor((parseIsoMicros(record.timestamp.start) as number) / 1000) -
          rng.int(0, 5000),
      ),
    },
  });
  const extra: TraceExtendedRecord[] = [];

  // A trigger that evaluated a change but did not fire.
  const notTriggered = fresh(pick(0));
  const [triggerPath] = Object.keys(notTriggered.trace);
  notTriggered.trace = {
    [triggerPath as string]: [
      {
        ...(notTriggered.trace[triggerPath as string] as TraceStepRecord[])[0],
        result: { reason: "the state did not change to the wanted one" },
      } as TraceStepRecord,
    ],
  };
  notTriggered.not_triggered = true;
  notTriggered.script_execution = "not_triggered";
  notTriggered.last_step = triggerPath as string;
  extra.push(notTriggered);

  // A run still in progress.
  const running = fresh(pick(1));
  running.state = "running";
  running.script_execution = null;
  running.timestamp.finish = null;
  extra.push(running);

  // An error, with a template error on a step.
  const failing = fresh(pick(2));
  failing.script_execution = "error";
  failing.error = "Template variable warning: 'sensor' is undefined";
  const lastSteps = failing.trace[
    failing.last_step as string
  ] as TraceStepRecord[];
  (lastSteps[lastSteps.length - 1] as TraceStepRecord).error =
    "Template variable warning: 'sensor' is undefined";
  (lastSteps[0] as TraceStepRecord).template_errors = [
    "UndefinedError: 'sensor' is undefined",
  ];
  extra.push(failing);

  // A run stopped by a failed condition.
  const stopped = fresh(pick(3));
  stopped.script_execution = "failed_conditions";
  extra.push(stopped);

  // A trace of an item that was removed: no registry entry.
  const removed = fresh(pick(4));
  removed.item_id = "1699999999999";
  (removed.config as JsonObject)["id"] = "1699999999999";
  extra.push(removed);

  // A blueprint automation.
  const blueprint = fresh(pick(5));
  blueprint.blueprint_inputs = {
    motion_entity: "binary_sensor.hallway_motion",
    light_target: { entity_id: "light.hallway_lamp" },
  };
  extra.push(blueprint);

  // A long `repeat`: the same path many times.
  const repeated = fresh(pick(0));
  const repeatStart = parseIsoMicros(repeated.timestamp.start) as number;
  repeated.trace["action/2/repeat/sequence/0"] = Array.from(
    { length: 25 },
    (_, i) => ({
      path: "action/2/repeat/sequence/0",
      timestamp: formatIsoMicros(repeatStart + 1_000_000 + i * 1000),
      changed_variables: {
        repeat: { first: i === 0, index: i + 1, last: i === 24 },
      },
    }),
  );
  repeated.last_step = Object.keys(repeated.trace).at(-1) as string;
  extra.push(repeated);

  // Two steps with the same timestamp.
  const ties = fresh(pick(1));
  const tieSteps = Object.values(ties.trace).flat();
  if (tieSteps.length > 1) {
    (tieSteps[1] as TraceStepRecord).timestamp = (
      tieSteps[0] as TraceStepRecord
    ).timestamp;
  }
  extra.push(ties);

  // A clock that stepped backwards: a later step has an earlier timestamp.
  const backwards = fresh(pick(2));
  const bwSteps = Object.values(backwards.trace).flat();
  const stamp = (bwSteps[0] as TraceStepRecord).timestamp;
  (bwSteps[bwSteps.length - 1] as TraceStepRecord).timestamp = formatIsoMicros(
    (parseIsoMicros(stamp) as number) - 5_000_000,
  );
  extra.push(backwards);

  base.records.entity_registry.push({
    entity_id: "automation.never_ran",
    unique_id: "1700000099999",
    platform: "automation",
  });
  base.records.states.push(
    {
      entity_id: "automation.never_ran",
      state: "on",
      attributes: { id: "1700000099999", friendly_name: "Never ran" },
    },
    // An automation defined without an `id`: the instance cannot trace it.
    {
      entity_id: "automation.no_id",
      state: "on",
      attributes: { friendly_name: "No id" },
    },
  );
  base.traces.push(...extra);
  base.traces.sort((a, b) => (a.timestamp.start < b.timestamp.start ? -1 : 1));
  return base;
}

export const EDGE_TRACES: TraceFixture = generateEdgeTraces();
