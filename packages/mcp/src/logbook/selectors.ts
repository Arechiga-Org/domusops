import type { LogbookRow } from "@domusops/schema";
import { errors } from "../errors.js";

const MAX_SELECTORS = 100;
const VALID = /^[a-z0-9_.*]+$/;

export type Strategy = "all" | "exact" | "filtered";

/**
 * Validates and deduplicates the requested selectors, keeping the request order. Returns
 * `undefined` when none were given.
 */
export function parseSelectors(
  list: readonly string[] | undefined,
): string[] | undefined {
  if (list === undefined) return undefined;
  if (list.length === 0) {
    throw errors.selectorInvalid(
      "(empty list)",
      "The entity selector list is empty",
    );
  }
  if (list.length > MAX_SELECTORS) {
    throw errors.selectorInvalid(
      "(too many)",
      `There are ${list.length} entity selectors, and the limit is ${MAX_SELECTORS}`,
    );
  }
  for (const selector of list) {
    if (!VALID.test(selector)) throw errors.selectorInvalid(selector);
  }
  return [...new Set(list)];
}

const compiled = new Map<string, RegExp>();

function patternOf(selector: string): RegExp {
  let pattern = compiled.get(selector);
  if (pattern === undefined) {
    // The valid alphabet has one regex metacharacter besides `*`: the dot.
    pattern = new RegExp(
      `^${selector.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`,
    );
    compiled.set(selector, pattern);
  }
  return pattern;
}

/** Anchored, case-sensitive match; `*` matches any sequence, including an empty one. */
export function matches(selector: string, entityId: string): boolean {
  return patternOf(selector).test(entityId);
}

/** How the query is sent to the instance (research R4). */
export function strategy(selectors: readonly string[] | undefined): Strategy {
  if (selectors === undefined) return "all";
  return selectors.some((s) => s.includes("*")) ? "filtered" : "exact";
}

/**
 * The rows a query selected. Without selectors that is every row, including those that belong to
 * no entity; with selectors, rows without an entity cannot match and are dropped. A row matched by
 * several selectors is selected once.
 */
export function selectRows(
  rows: readonly LogbookRow[],
  selectors: readonly string[] | undefined,
): LogbookRow[] {
  if (selectors === undefined) return [...rows];
  const patterns = selectors.map(patternOf);
  return rows.filter(
    (row) =>
      typeof row.entity_id === "string" &&
      patterns.some((pattern) => pattern.test(row.entity_id as string)),
  );
}

/** The selectors that matched no selected row, in request order. */
export function noEvents(
  selectors: readonly string[],
  selected: readonly LogbookRow[],
): string[] {
  const ids = new Set<string>();
  for (const row of selected) {
    if (typeof row.entity_id === "string") ids.add(row.entity_id);
  }
  const all = [...ids];
  return selectors.filter(
    (selector) => !all.some((id) => matches(selector, id)),
  );
}
