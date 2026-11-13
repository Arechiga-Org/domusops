import { exclusion, matcher } from "../logbook/selectors.js";
import type { EntityHistory } from "./entries.js";

/** The entity IDs the history is read for, before the history is read (research R3). */
export interface Candidates {
  /** In entity-ID order. */
  ids: string[];
  /** The exact IDs of `entities` that are not excluded, in request order. */
  exact: string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isPattern = (selector: string): boolean => selector.includes("*");

/** Whether the current entity IDs are needed: a pattern, or no `entities`, must be expanded. */
export function needsCurrentIds(
  selectors: readonly string[] | undefined,
): boolean {
  return selectors === undefined || selectors.some(isPattern);
}

/**
 * Without `entities`, every current entity; with it, the current IDs a pattern matches plus every
 * exact ID as given, whether or not a current entity has it. `exclude` applies after `entities`,
 * to exact IDs too, so it never hides a typo in `entities`.
 */
export function candidates(
  currentIds: readonly string[] | null,
  selectors: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): Candidates {
  const excluded = exclusion(exclude);
  const exact = (selectors ?? []).filter(
    (selector) => !isPattern(selector) && !excluded(selector),
  );
  const ids = new Set(exact);
  if (currentIds !== null) {
    const chosen =
      selectors === undefined
        ? () => true
        : matcher(selectors.filter(isPattern));
    for (const id of currentIds) {
      if (chosen(id) && !excluded(id)) ids.add(id);
    }
  }
  return { ids: [...ids].sort(compare), exact };
}

export interface Listing {
  /** The entities the document lists, in entity-ID order (data-model §5). */
  listed: EntityHistory[];
  /** The exact IDs with no recorded history, in request order. */
  noHistory: string[];
}

/**
 * An entity that changed in the window is listed; one that did not is listed only when it was
 * named by exact ID (FR-012, clarification of 2026-11-12).
 */
export function listing(
  histories: readonly EntityHistory[],
  chosen: Candidates,
): Listing {
  const exact = new Set(chosen.exact);
  const recorded = new Set(histories.map((history) => history.entityId));
  return {
    listed: histories
      .filter(
        (history) => history.changes.length > 0 || exact.has(history.entityId),
      )
      .sort((a, b) => compare(a.entityId, b.entityId)),
    noHistory: chosen.exact.filter((id) => !recorded.has(id)),
  };
}
