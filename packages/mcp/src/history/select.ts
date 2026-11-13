import { exclusion, matcher } from "../logbook/selectors.js";
import type { EntityHistory } from "./entries.js";

/** The entity IDs the history is read for, before the history is read (research R3). */
export interface Candidates {
  /** In entity-ID order. */
  ids: string[];
  /**
   * The exact IDs of `entities` that are not excluded, in request order, including those that are
   * not valid entity IDs and so are not in `ids`.
   */
  exact: string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isPattern = (selector: string): boolean => selector.includes("*");

/**
 * The instance's own rule for an entity ID (`valid_entity_id`): one dot, no leading, trailing or
 * double underscore in either part. The history command refuses the whole call when one ID breaks
 * it (research R1), so such an ID is never sent; it can have no recorded history.
 */
const ENTITY_ID = /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/;

/** Whether the current entity IDs are needed: a pattern, or no `entities`, must be expanded. */
export function needsCurrentIds(
  selectors: readonly string[] | undefined,
): boolean {
  return selectors === undefined || selectors.some(isPattern);
}

/**
 * Without `entities`, every current entity; with it, the current IDs a pattern matches plus every
 * exact ID as given, whether or not a current entity has it, as long as it is a valid entity ID.
 * `exclude` applies after `entities`, to exact IDs too, so it never hides a typo in `entities`.
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
  const ids = new Set(exact.filter((id) => ENTITY_ID.test(id)));
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

/**
 * The entities the document lists, in the order given (data-model §5). An entity that changed in
 * the window is listed; one that did not is listed only when it was named by exact ID (FR-012,
 * clarification of 2026-11-12).
 */
export function listing(
  histories: readonly EntityHistory[],
  chosen: Candidates,
): EntityHistory[] {
  const exact = new Set(chosen.exact);
  return histories.filter(
    (history) => history.changes.length > 0 || exact.has(history.entityId),
  );
}

/** The exact IDs with no recorded history, in request order: absent from the answer. */
export function withoutHistory(
  chosen: Candidates,
  answer: Readonly<Record<string, unknown>>,
): string[] {
  return chosen.exact.filter((id) => !Object.hasOwn(answer, id));
}
