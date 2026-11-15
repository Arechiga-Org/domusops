import {
  SYSTEM_LOG_LEVELS,
  type SystemLogCount,
  type SystemLogLevel,
  type SystemLogSummaryDocument,
} from "@domusops/schema";
import { put } from "../util/json.js";
import type { LogEntry } from "./entries.js";
import type { SystemLogFrame } from "./envelope.js";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type Counts = Map<SystemLogLevel, SystemLogCount>;

/** level -> `[entries, occurrences]`, levels in severity order. */
function byLevel(
  counts: Counts,
): Partial<Record<SystemLogLevel, SystemLogCount>> {
  const out: Partial<Record<SystemLogLevel, SystemLogCount>> = {};
  for (const level of SYSTEM_LOG_LEVELS) {
    const count = counts.get(level);
    if (count !== undefined) out[level] = count;
  }
  return out;
}

/**
 * The `summary` document (data-model §4, research R10): the number of entries and of occurrences
 * per integration and level, domains in name order, with the entries that have no integration in
 * a row of their own. No message, source or traceback. The `compression_ratio` is a placeholder
 * for `finalize` to fill.
 */
export function encodeSummarySystemLog(
  frame: SystemLogFrame,
  entries: readonly LogEntry[],
): SystemLogSummaryDocument {
  const counts = { entries: 0, occurrences: 0 };
  const domains = new Map<string, Counts>();
  const without: Counts = new Map();
  for (const entry of entries) {
    counts.entries++;
    counts.occurrences += entry.raw.count;
    const domain = entry.integration?.domain;
    let levels = without;
    if (domain !== undefined) {
      levels = domains.get(domain) ?? new Map();
      domains.set(domain, levels);
    }
    const count = levels.get(entry.level) ?? [0, 0];
    levels.set(entry.level, [count[0] + 1, count[1] + entry.raw.count]);
  }
  const byIntegration: SystemLogSummaryDocument["by_integration"] = {};
  for (const domain of [...domains.keys()].sort(compare)) {
    put(byIntegration, domain, byLevel(domains.get(domain) as Counts));
  }
  return {
    ...frame.envelope,
    detail: "summary",
    counts,
    by_integration: byIntegration,
    ...(without.size === 0 ? {} : { without_integration: byLevel(without) }),
  };
}
