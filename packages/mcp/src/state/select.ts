import type { JsonObject } from "@domusops/schema";
import type { HaState } from "../ha/states.js";
import { exclusion, matcher } from "../logbook/selectors.js";

export interface StateFilters {
  entities?: readonly string[];
  domains?: readonly string[];
  states?: readonly string[];
  exclude?: readonly string[];
}

export interface StateSelection {
  /** The selected states, in entity-ID order. */
  selected: HaState[];
  /** The exact IDs of `entities` that name no state and are not excluded, in request order. */
  notFound: string[];
}

export const domainOf = (entityId: string): string =>
  entityId.slice(0, entityId.indexOf("."));

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Selects by `entities`, then `domain`, then `state`, then `exclude`, the order of
 * specs/010-ha-state research R2, so `exclude` never hides a typo in `entities`.
 */
export function selectStates(
  states: readonly HaState[],
  filters: StateFilters,
): StateSelection {
  const chosen =
    filters.entities === undefined ? () => true : matcher(filters.entities);
  const domains =
    filters.domains === undefined ? null : new Set(filters.domains);
  const values = filters.states === undefined ? null : new Set(filters.states);
  const excluded = exclusion(filters.exclude);
  const selected = states
    .filter(
      (s) =>
        chosen(s.entity_id) &&
        (domains === null || domains.has(domainOf(s.entity_id))) &&
        (values === null || values.has(s.state)) &&
        !excluded(s.entity_id),
    )
    .sort((a, b) => compare(a.entity_id, b.entity_id));

  const known = new Set(states.map((s) => s.entity_id));
  const notFound = (filters.entities ?? []).filter(
    (id) => !id.includes("*") && !known.has(id) && !excluded(id),
  );
  return { selected, notFound };
}

/** Keeps only the named attributes of each state; the selection does not change (FR-006). */
export function trimAttributes(
  states: readonly HaState[],
  names: readonly string[],
): HaState[] {
  const keep = new Set(names);
  return states.map((state) => {
    const attributes: JsonObject = {};
    for (const [key, value] of Object.entries(state.attributes)) {
      if (keep.has(key)) attributes[key] = value;
    }
    return { ...state, attributes };
  });
}
