import type { HistorySummaryDocument } from "@domusops/schema";
import type { HistoryAnswer } from "../ha/history.js";
import { domainOf } from "../state/select.js";
import type { HistoryFrame } from "./envelope.js";
import { isStartEntry } from "./entries.js";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The `summary` document (data-model §4, research R11), from a history read without attributes.
 * Every entry but the start is a change; it changed the state when it has no `lc`, and only
 * attributes otherwise. Only entities with a change are counted. Rows per entity are given only
 * when `withEntities`; without them the document stays small for any home. The
 * `compression_ratio` is a placeholder for `finalize` to fill.
 */
export function encodeSummaryHistory(
  frame: HistoryFrame,
  answer: HistoryAnswer,
  windowStartMs: number,
  withEntities: boolean,
): HistorySummaryDocument {
  const counts = {
    entities: 0,
    changes: 0,
    state_changes: 0,
    attribute_only: 0,
  };
  const byDomain: Record<string, [number, number, number, number]> = {};
  const byEntity: Record<string, [number, number, number]> = {};
  for (const id of Object.keys(answer).sort(compare)) {
    const entries = answer[id] ?? [];
    const changes = isStartEntry(entries[0], windowStartMs)
      ? entries.slice(1)
      : entries;
    if (changes.length === 0) continue;
    const states = changes.filter((entry) => entry.lc === undefined).length;
    const attributes = changes.length - states;
    counts.entities++;
    counts.changes += changes.length;
    counts.state_changes += states;
    counts.attribute_only += attributes;
    const domain = (byDomain[domainOf(id)] ??= [0, 0, 0, 0]);
    domain[0]++;
    domain[1] += changes.length;
    domain[2] += states;
    domain[3] += attributes;
    if (withEntities) byEntity[id] = [changes.length, states, attributes];
  }
  // `attributes` is refused with `summary`, so the envelope never carries it here.
  return {
    ...(frame.envelope as Omit<typeof frame.envelope, "attributes">),
    detail: "summary",
    counts,
    by_domain: Object.fromEntries(
      Object.keys(byDomain)
        .sort(compare)
        .map((domain) => [
          domain,
          byDomain[domain] as [number, number, number, number],
        ]),
    ),
    ...(withEntities ? { by_entity: byEntity } : {}),
  };
}
