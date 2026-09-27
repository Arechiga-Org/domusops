import {
  encodeContextId,
  parseIsoMicros,
  TRACE_SUMMARY_COLUMNS,
  type TraceShortRecord,
  type TraceSummaryDocument,
} from "@domusops/schema";
import { formatLocalIso, localParts } from "../logbook/local-time.js";
import {
  buildEnvelope,
  groupByItem,
  type TraceEncodeContext,
} from "./encode-standard.js";

/** One selected run: its short record, and the ID of the context it ran in. */
export interface SummaryRun {
  record: TraceShortRecord;
  contextId: string;
}

/**
 * Encodes the selected runs as a `summary` document (data-model §4): one row per run, and no
 * steps, variables, or configuration (spec FR-008). The `compression_ratio` is a placeholder for
 * `finalize` to fill.
 */
export function encodeSummary(
  runs: readonly SummaryRun[],
  context: TraceEncodeContext,
): TraceSummaryDocument {
  const base = localParts(context.nowMs, context.timeZone).offsetMinutes;
  const contextOf = new Map(runs.map((r) => [r.record.run_id, r.contextId]));
  const items: Record<string, unknown[][]> = {};
  const grouped = groupByItem(
    runs.map((r) => r.record),
    context.items.keyOf,
  );
  for (const [key, records] of grouped) {
    items[key] = records.map((record) => {
      const startMicros = parseIsoMicros(record.timestamp.start) as number;
      const finish = record.timestamp.finish;
      const startMs = Math.floor(startMicros / 1000);
      const contextId = encodeContextId(
        contextOf.get(record.run_id) as string,
        Math.floor(startMs / 1000) * 1000,
      );
      const row: unknown[] = [
        record.run_id,
        formatLocalIso(startMs, context.timeZone, base).replace("T", " "),
        finish === null
          ? null
          : Math.round(
              ((parseIsoMicros(finish) as number) - startMicros) / 1000,
            ),
        "trigger" in record ? record.trigger : null,
        record.script_execution ?? record.state,
        record.last_step,
        contextId,
      ];
      if (typeof record.error === "string") row.push(record.error);
      return row;
    });
  }
  return {
    ...buildEnvelope(
      context,
      "summary",
      runs.map((r) => r.record),
    ),
    columns: TRACE_SUMMARY_COLUMNS,
    items,
  };
}
