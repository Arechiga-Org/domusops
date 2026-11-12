import type { StateSummaryDocument } from "@domusops/schema";
import type { HaState } from "../ha/states.js";
import type { StateFrame } from "./envelope.js";
import { domainOf } from "./select.js";

/**
 * The `summary` document (data-model §3, research R9): per domain, how many entities are selected
 * and how many of them are `unavailable` and `unknown`, compared exactly; domains in name order.
 */
export function encodeSummaryState(
  frame: StateFrame,
  states: readonly HaState[],
): StateSummaryDocument {
  const rows = new Map<string, [number, number, number]>();
  for (const state of states) {
    const domain = domainOf(state.entity_id);
    const row = rows.get(domain) ?? [0, 0, 0];
    rows.set(domain, row);
    row[0]++;
    if (state.state === "unavailable") row[1]++;
    if (state.state === "unknown") row[2]++;
  }
  const by_domain: Record<string, [number, number, number]> = {};
  for (const domain of [...rows.keys()].sort())
    by_domain[domain] = rows.get(domain) as [number, number, number];
  return {
    ...frame.envelope,
    detail: "summary",
    counts: { entities: states.length, domains: rows.size },
    by_domain,
  };
}
