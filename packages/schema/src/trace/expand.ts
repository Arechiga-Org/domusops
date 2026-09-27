import type { JsonObject } from "../format.js";
import type {
  TraceExtendedRecord,
  TraceRun,
  TraceStandardDocument,
  TraceStepRecord,
} from "./format.js";
import {
  decodeValue,
  formatIsoMicros,
  parseLocalIsoMicros,
  type DecodeAnchor,
  type DecodeBases,
  type DecodeTables,
} from "./values.js";

/** Splits an item key into the domain and item ID of its traces (data-model §3.1). */
function splitKey(
  key: string,
  ids: Readonly<Record<string, string>>,
): { domain: string; itemId: string } {
  const colon = key.indexOf(":");
  if (colon >= 0) {
    return { domain: key.slice(0, colon), itemId: key.slice(colon + 1) };
  }
  const dot = key.indexOf(".");
  return { domain: key.slice(0, dot), itemId: ids[key] ?? key.slice(dot + 1) };
}

/**
 * The reference decoder of the `standard` trace format (data-model §5): rebuilds the extended
 * record of every run, as `trace/get` returned it, in document order. Object key order is not
 * preserved.
 */
export function expandTrace(
  document: TraceStandardDocument,
): TraceExtendedRecord[] {
  const tables: DecodeTables = {
    strings: document.strings ?? [],
    values: document.values ?? [],
  };
  const ids = document.ids ?? {};
  const configs: unknown[] = [];
  const out: TraceExtendedRecord[] = [];

  for (const [key, item] of Object.entries(document.items)) {
    const { domain, itemId } = splitKey(key, ids);
    const bases: DecodeBases =
      item.this === undefined
        ? {}
        : {
            this: {
              entity_id: item.this.entity_id,
              attributes: decodeValue(
                item.this.attributes,
                null,
                tables,
              ) as JsonObject,
            },
          };
    for (const run of item.runs) {
      out.push(
        expandRun(run, domain, itemId, document, tables, bases, configs, ids),
      );
    }
  }
  return out;
}

function expandRun(
  run: TraceRun,
  domain: string,
  itemId: string,
  document: TraceStandardDocument,
  tables: DecodeTables,
  bases: DecodeBases,
  configs: unknown[],
  ids: Readonly<Record<string, string>>,
): TraceExtendedRecord {
  const startMicros = parseLocalIsoMicros(run.start);
  if (startMicros === null) throw new Error(`invalid run start ${run.start}`);
  const anchor: DecodeAnchor = { startMicros };
  const at = (value: unknown): unknown =>
    decodeValue(value, anchor, tables, bases);

  const trace: Record<string, TraceStepRecord[]> = {};
  for (const row of run.steps) {
    const step = expandStep(row, anchor, tables, bases, ids);
    (trace[step.path] ??= []).push(step);
  }

  let config: JsonObject | null = null;
  if (run.config !== null) {
    configs[run.config] ??= decodeValue(
      document.configs[run.config],
      null,
      tables,
    );
    config = configs[run.config] as JsonObject;
  }
  const outcome = run.outcome;
  const record: Record<string, unknown> = {
    last_step: run.last_step ?? Object.keys(trace).at(-1) ?? null,
    run_id: run.run,
    state:
      outcome === undefined
        ? run.state
        : outcome === "running"
          ? "running"
          : "stopped",
    script_execution:
      outcome === undefined
        ? run.script_execution
        : outcome === "running"
          ? null
          : outcome,
    timestamp: {
      start: formatIsoMicros(startMicros),
      finish:
        run.duration_ms === undefined
          ? null
          : formatIsoMicros(startMicros + Math.round(run.duration_ms * 1000)),
    },
    domain,
    item_id: itemId,
  };
  if ("trigger" in run) record["trigger"] = run.trigger;
  if (run.error !== undefined) record["error"] = run.error;
  if (run.not_triggered === true) record["not_triggered"] = true;
  record["trace"] = trace;
  record["config"] = config;
  record["blueprint_inputs"] =
    run.blueprint_inputs === undefined
      ? null
      : decodeValue(run.blueprint_inputs, null, tables);
  record["context"] = {
    id: at(run.context),
    parent_id: run.parent_context === undefined ? null : at(run.parent_context),
    user_id: run.user ?? null,
  };
  Object.assign(record, run.extra);
  return record as TraceExtendedRecord;
}

function expandStep(
  row: unknown,
  anchor: DecodeAnchor,
  tables: DecodeTables,
  bases: DecodeBases,
  ids: Readonly<Record<string, string>>,
): TraceStepRecord {
  const at = (value: unknown): unknown =>
    decodeValue(value, anchor, tables, bases);
  const time = (t: unknown): string =>
    formatIsoMicros(anchor.startMicros + Math.round(Number(t) * 1000));
  if (!Array.isArray(row)) {
    const { path, t, ...rest } = (row as { step: JsonObject }).step;
    const step: Record<string, unknown> = {
      path,
      timestamp: time(t),
    };
    for (const [key, value] of Object.entries(rest)) step[key] = at(value);
    return step as TraceStepRecord;
  }
  const step: Record<string, unknown> = {
    path: at(row[0]),
    timestamp: time(row[1]),
  };
  const present = (index: number): boolean =>
    row[index] !== undefined && row[index] !== 0;
  if (present(3)) step["changed_variables"] = at(row[3]);
  if (present(2)) step["result"] = at(row[2]);
  if (present(4)) {
    const [key, runId] = row[4] as [string, string];
    const { domain, itemId } = splitKey(key, ids);
    step["child_id"] = { domain, item_id: itemId, run_id: runId };
  }
  if (present(5)) step["error"] = row[5];
  if (present(6)) step["template_errors"] = row[6];
  return step as TraceStepRecord;
}
