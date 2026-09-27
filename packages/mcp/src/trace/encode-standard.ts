import {
  ENCODED_CONTEXT_ID,
  formatMsOffset,
  parseIsoMicros,
  TRACE_FORMAT,
  type JsonObject,
  type TraceEnvelope,
  type TraceExtendedRecord,
  type TraceItem,
  type TraceRun,
  type TraceStandardDocument,
  type TraceStepRecord,
} from "@domusops/schema";
import { formatOffset, localParts } from "../logbook/local-time.js";
import type { ItemResolver } from "./items.js";
import type { NoRuns } from "./select.js";
import {
  buildTables,
  encodeValue,
  encodeVariables,
  isContextObject,
  isObject,
  isStateObject,
  type EncodeAnchor,
  type Root,
  type ThisTemplate,
} from "./values.js";

/** What the encoder needs besides the records (data-model §2). */
export interface TraceEncodeContext {
  haVersion: string;
  timeZone: string;
  /** The time of the call: the offset at that time is the document's `utc_offset`. */
  nowMs: number;
  selection: TraceEnvelope["selection"];
  items: Pick<ItemResolver, "keyOf" | "itemIdOf">;
  noRuns: NoRuns | null;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Local ISO 8601 with offset; six fraction digits exactly when the microsecond is not zero. */
export function localIsoMicros(micros: number, timeZone: string): string {
  const p = localParts(Math.floor(micros / 1000), timeZone);
  const fraction = ((micros % 1_000_000) + 1_000_000) % 1_000_000;
  return `${p.date}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${
    fraction === 0 ? "" : `.${pad(fraction, 6)}`
  }${formatOffset(p.offsetMinutes)}`;
}

/** The envelope both detail levels share (data-model §2), in emission order. */
export function buildEnvelope<D extends "summary" | "standard">(
  context: TraceEncodeContext,
  detail: D,
  records: readonly {
    domain: string;
    item_id: string;
    not_triggered?: unknown;
  }[],
): TraceEnvelope & { detail: D } {
  const keys = new Set(
    records.map((r) => context.items.keyOf(r.domain, r.item_id)),
  );
  const notTriggered = records.filter((r) => r.not_triggered === true).length;
  return {
    format: TRACE_FORMAT,
    detail,
    ha_version: context.haVersion,
    compression_ratio: 0,
    time_zone: context.timeZone,
    utc_offset: formatOffset(
      localParts(context.nowMs, context.timeZone).offsetMinutes,
    ),
    selection: context.selection,
    counts: {
      items: keys.size,
      runs: records.length - notTriggered,
      not_triggered: notTriggered,
    },
    ...(context.noRuns === null ? {} : { no_runs: context.noRuns }),
  };
}

const startOf = (record: TraceExtendedRecord): number =>
  parseIsoMicros(record.timestamp.start) as number;

/** Runs of an item, newest first, then by run ID (data-model §3.1). */
export function runOrder(
  a: TraceExtendedRecord,
  b: TraceExtendedRecord,
): number {
  return (
    startOf(b) - startOf(a) ||
    (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0)
  );
}

/** Groups records by item key: items by their newest run, newest first, then by key. */
export function groupByItem(
  records: readonly TraceExtendedRecord[],
  keyOf: (domain: string, itemId: string) => string,
): [string, TraceExtendedRecord[]][] {
  const groups = new Map<string, TraceExtendedRecord[]>();
  for (const record of [...records].sort(runOrder)) {
    const key = keyOf(record.domain, record.item_id);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [record]);
    else list.push(record);
  }
  return [...groups].sort(
    ([ka, a], [kb, b]) =>
      startOf(b[0] as TraceExtendedRecord) -
        startOf(a[0] as TraceExtendedRecord) ||
      (ka < kb ? -1 : ka > kb ? 1 : 0),
  );
}

const STEP_KEYS = new Set([
  "path",
  "timestamp",
  "changed_variables",
  "result",
  "child_id",
  "error",
  "template_errors",
]);

function isRegularStep(step: TraceStepRecord): boolean {
  if (Object.keys(step).some((key) => !STEP_KEYS.has(key))) return false;
  // A path that could be mistaken for one of the format's own forms is kept verbatim in a
  // fallback step, never replaced by a table reference.
  if (
    step.path.startsWith("#") ||
    step.path.startsWith("@") ||
    ENCODED_CONTEXT_ID.test(step.path)
  ) {
    return false;
  }
  const objectOrAbsent = (value: unknown): boolean =>
    value === undefined || isObject(value);
  if (!objectOrAbsent(step.changed_variables)) return false;
  if (!objectOrAbsent(step.result)) return false;
  const child = step.child_id;
  if (
    child !== undefined &&
    !(
      isObject(child) &&
      typeof child["domain"] === "string" &&
      typeof child["item_id"] === "string" &&
      typeof child["run_id"] === "string"
    )
  ) {
    return false;
  }
  if (step.error !== undefined && typeof step.error !== "string") return false;
  const errs = step.template_errors;
  return (
    errs === undefined ||
    (Array.isArray(errs) && errs.every((e) => typeof e === "string"))
  );
}

interface FlatStep {
  path: string;
  step: TraceStepRecord;
  micros: number;
}

/**
 * The steps in time order, ties in recorded order, unless regrouping them by path would not
 * reproduce the recorded map (a clock that stepped backwards): then in recorded order (research
 * R7).
 */
function orderSteps(record: TraceExtendedRecord): {
  steps: FlatStep[];
  recorded: boolean;
} {
  const flat: FlatStep[] = [];
  for (const [path, list] of Object.entries(record.trace)) {
    for (const step of list) {
      flat.push({
        path,
        step,
        micros: parseIsoMicros(step.timestamp) as number,
      });
    }
  }
  const sorted = flat
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.micros - b.item.micros || a.index - b.index);
  const byPath = new Map<string, number[]>();
  for (const { item, index } of sorted) {
    const list = byPath.get(item.path);
    if (list === undefined) byPath.set(item.path, [index]);
    else list.push(index);
  }
  const regrouped = [...byPath.values()].flat();
  const reproduces = regrouped.every((index, at) => index === at);
  return reproduces
    ? { steps: sorted.map(({ item }) => item), recorded: false }
    : { steps: flat, recorded: true };
}

/** The `this` template of an item (data-model §3.1), or null when no run carries a `this` state. */
function thisTemplate(
  records: readonly TraceExtendedRecord[],
): ThisTemplate | null {
  const states: ReturnType<typeof stateAt>[] = [];
  for (const record of records) {
    for (const list of Object.values(record.trace)) {
      for (const step of list) {
        const found = stateAt(step);
        if (found !== null) states.push(found);
      }
    }
  }
  const first = states[0];
  if (first === undefined || first === null) return null;
  const same = states.filter(
    (s) => s !== null && s.entity_id === first.entity_id,
  );
  const attributes: JsonObject = {};
  for (const [key, value] of Object.entries(first.attributes)) {
    const json = JSON.stringify(value);
    if (
      same.every(
        (s) =>
          s !== null &&
          key in s.attributes &&
          JSON.stringify(s.attributes[key]) === json,
      )
    ) {
      attributes[key] = value;
    }
  }
  return { entity_id: first.entity_id, attributes };
}

function stateAt(step: TraceStepRecord) {
  const value = step.changed_variables?.["this"];
  return isStateObject(value) ? value : null;
}

interface Slot {
  root: Root;
  assign: (replaced: unknown) => void;
}

const KNOWN_KEYS = new Set([
  "run_id",
  "domain",
  "item_id",
  "state",
  "script_execution",
  "timestamp",
  "last_step",
  "trigger",
  "error",
  "not_triggered",
  "trace",
  "config",
  "blueprint_inputs",
  "context",
]);

const ms = (micros: number): number => Number(formatMsOffset(micros));

/**
 * Encodes the extended records of a selection (already redacted) as a `standard` document
 * (data-model §3). Lossless: `expandTrace` returns the records.
 */
export function encodeStandard(
  records: readonly TraceExtendedRecord[],
  context: TraceEncodeContext,
): TraceStandardDocument {
  const slots: Slot[] = [];
  const track = (root: Root, assign: (replaced: unknown) => void): void => {
    slots.push({ root, assign });
  };
  const configs: unknown[] = [];
  const configIndex = new Map<string, number>();
  const ids: Record<string, string> = {};
  const noteKey = (key: string): void => {
    if (key.includes(":")) return;
    const itemId = context.items.itemIdOf(key);
    if (itemId !== undefined && itemId !== key.slice(key.indexOf(".") + 1)) {
      ids[key] = itemId;
    }
  };

  const items: Record<string, TraceItem> = {};
  for (const [key, group] of groupByItem(records, context.items.keyOf)) {
    noteKey(key);
    const template = thisTemplate(group);
    const item: TraceItem = { runs: [] };
    if (template !== null) {
      const holder = {
        entity_id: template.entity_id,
        attributes: {} as unknown,
      };
      const encodedAttributes = encodeValue(template.attributes, null);
      holder.attributes = encodedAttributes;
      item.this = holder as TraceItem["this"] & object;
      track({ value: encodedAttributes, replaceTop: false }, (replaced) => {
        holder.attributes = replaced;
      });
    }
    for (const record of group) {
      item.runs.push(
        encodeRun(
          record,
          template,
          context,
          track,
          configs,
          configIndex,
          noteKey,
        ),
      );
    }
    items[key] = item;
  }

  const tables = buildTables(slots.map((slot) => slot.root));
  slots.forEach((slot, at) => slot.assign(tables.roots[at]));

  return {
    ...buildEnvelope(context, "standard", records),
    ...(tables.strings.length === 0 ? {} : { strings: tables.strings }),
    ...(tables.values.length === 0 ? {} : { values: tables.values }),
    configs,
    ...(Object.keys(ids).length === 0 ? {} : { ids }),
    items,
  };
}

function encodeRun(
  record: TraceExtendedRecord,
  template: ThisTemplate | null,
  context: TraceEncodeContext,
  track: (root: Root, assign: (replaced: unknown) => void) => void,
  configs: unknown[],
  configIndex: Map<string, number>,
  noteKey: (key: string) => void,
): TraceRun {
  const startMicros = startOf(record);
  const anchor: EncodeAnchor = { startMicros };
  const finish = record.timestamp.finish;
  const run: Record<string, unknown> = {
    run: record.run_id,
    start: localIsoMicros(startMicros, context.timeZone),
  };
  if (finish !== null) {
    run["duration_ms"] = ms((parseIsoMicros(finish) as number) - startMicros);
  }
  if (
    "trigger" in record &&
    (record.trigger === null || typeof record.trigger === "string")
  ) {
    run["trigger"] = record.trigger;
  }
  const extra: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }
  const { state, script_execution: execution } = record;
  if (
    state === "stopped" &&
    typeof execution === "string" &&
    execution !== "running"
  ) {
    run["outcome"] = execution;
  } else if (state === "running" && execution === null) {
    run["outcome"] = "running";
  } else {
    run["state"] = state;
    run["script_execution"] = execution;
  }
  if (typeof record.error === "string") run["error"] = record.error;
  else if ("error" in record) extra["error"] = record.error;
  if (record.not_triggered === true) run["not_triggered"] = true;
  else if ("not_triggered" in record)
    extra["not_triggered"] = record.not_triggered;
  const ctx = record.context;
  run["context"] = encodeValue(ctx.id, anchor);
  if (isContextObject(ctx)) {
    if (ctx.parent_id !== null)
      run["parent_context"] = encodeValue(ctx.parent_id, anchor);
    if (ctx.user_id !== null) run["user"] = ctx.user_id;
  } else {
    extra["context"] = ctx;
  }
  if (record.config === null) {
    run["config"] = null;
  } else {
    const key = JSON.stringify(record.config);
    let at = configIndex.get(key);
    if (at === undefined) {
      at = configs.length;
      configIndex.set(key, at);
      const encoded = encodeValue(record.config, null);
      const position = at;
      configs.push(encoded);
      track({ value: encoded, replaceTop: false }, (replaced) => {
        configs[position] = replaced;
      });
    }
    run["config"] = at;
  }
  if (record.blueprint_inputs !== null) {
    const encoded = encodeValue(record.blueprint_inputs, null);
    run["blueprint_inputs"] = encoded;
    track({ value: encoded, replaceTop: true }, (replaced) => {
      run["blueprint_inputs"] = replaced;
    });
  }
  const { steps, recorded } = orderSteps(record);
  const lastKey = Object.keys(record.trace).at(-1) ?? null;
  if (record.last_step !== lastKey) run["last_step"] = record.last_step;
  if (recorded) run["steps_order"] = "recorded";
  if (Object.keys(extra).length > 0) run["extra"] = extra;

  const rows: unknown[] = [];
  for (const { path, step, micros } of steps) {
    rows.push(
      encodeStep(path, step, micros, anchor, template, context, track, noteKey),
    );
  }
  run["steps"] = rows;
  return run as unknown as TraceRun;
}

function encodeStep(
  path: string,
  step: TraceStepRecord,
  micros: number,
  anchor: EncodeAnchor,
  template: ThisTemplate | null,
  context: TraceEncodeContext,
  track: (root: Root, assign: (replaced: unknown) => void) => void,
  noteKey: (key: string) => void,
): unknown {
  const t = ms(micros - anchor.startMicros);
  if (!isRegularStep(step)) {
    const rest: JsonObject = {};
    for (const [key, value] of Object.entries(step)) {
      if (key === "path" || key === "timestamp") continue;
      rest[key] =
        key === "changed_variables" && isObject(value)
          ? encodeVariables(value, anchor, template)
          : encodeValue(value, anchor);
    }
    const holder = { step: { path, t, ...rest } };
    track({ value: rest, replaceTop: false }, (replaced) => {
      holder.step = { path, t, ...(replaced as JsonObject) };
    });
    return holder;
  }
  const row: unknown[] = [path, t, 0, 0, 0, 0, 0];
  track({ value: path, replaceTop: false }, (replaced) => {
    row[0] = replaced;
  });
  if (step.result !== undefined) {
    const encoded = encodeValue(step.result, anchor);
    row[2] = encoded;
    track({ value: encoded, replaceTop: true }, (replaced) => {
      row[2] = replaced;
    });
  }
  if (step.changed_variables !== undefined) {
    const encoded = encodeVariables(step.changed_variables, anchor, template);
    row[3] = encoded;
    track({ value: encoded, replaceTop: true }, (replaced) => {
      row[3] = replaced;
    });
  }
  if (step.child_id !== undefined) {
    const key = context.items.keyOf(
      step.child_id.domain,
      step.child_id.item_id,
    );
    noteKey(key);
    row[4] = [key, step.child_id.run_id];
  }
  if (step.error !== undefined) row[5] = step.error;
  if (step.template_errors !== undefined) row[6] = step.template_errors;
  while (row.length > 2 && row[row.length - 1] === 0) row.pop();
  return row;
}
