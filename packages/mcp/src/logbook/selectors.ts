import type { LogbookRow } from "@domusops/schema";
import { errors } from "../errors.js";

/** The most selectors one call may carry. The advertised input schema uses the same number. */
export const MAX_SELECTORS = 100;
/** The longest selector, in characters. A real entity ID is far shorter. */
export const MAX_SELECTOR_LENGTH = 128;
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
    if (selector.length > MAX_SELECTOR_LENGTH) {
      throw errors.selectorInvalid(
        selector,
        `An entity selector is ${selector.length} characters long, and the limit is ${MAX_SELECTOR_LENGTH}`,
      );
    }
    if (!VALID.test(selector)) throw errors.selectorInvalid(selector);
  }
  return [...new Set(list)];
}

/**
 * Anchored, case-sensitive match; `*` matches any sequence, including an empty one. It walks the
 * text once, remembering only the last `*`, so it never backtracks exponentially: a regular
 * expression built from many `*` can take seconds, or hang the process, on a pattern that fails
 * (CWE-1333). The work is at most the selector length times the ID length.
 */
export function matches(selector: string, entityId: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < entityId.length) {
    const c = selector.charAt(p);
    if (p < selector.length && c === "*") {
      star = p++;
      mark = t;
    } else if (p < selector.length && c === entityId.charAt(t)) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (selector.charAt(p) === "*") p++;
  return p === selector.length;
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
  return rows.filter(
    (row) =>
      typeof row.entity_id === "string" &&
      selectors.some((selector) => matches(selector, row.entity_id as string)),
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
