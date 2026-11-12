import {
  STATE_HEAD_KEYS,
  STATE_PREFIX,
  encodeContextId,
  escapeKey,
  type Groups,
  type JsonObject,
  type StateStandardDocument,
} from "@domusops/schema";
import type { HaState } from "../ha/states.js";
import { formatLocalIso } from "../logbook/local-time.js";
import { TemplateBook, type Item } from "../snapshot/templates.js";
import type { StateFrame } from "./envelope.js";
import { domainOf } from "./select.js";

/** The state fields a record may leave out, and what an absent one means (data-model §2). */
const DEFAULTS: JsonObject = {
  [`${STATE_PREFIX}last_updated`]: null,
  [`${STATE_PREFIX}last_reported`]: null,
  [`${STATE_PREFIX}parent_id`]: null,
  [`${STATE_PREFIX}user_id`]: null,
};

/** One state as a template item: head `[object_id, state]`, then attributes and `st.` fields. */
function itemOf(state: HaState, frame: StateFrame): Item {
  const time = (text: string): string =>
    formatLocalIso(Date.parse(text), frame.timeZone, frame.offsetMinutes);
  const fields: JsonObject = {};
  for (const [key, value] of Object.entries(state.attributes))
    fields[escapeKey(key)] = value;
  const changed = time(state.last_changed);
  const updated = time(state.last_updated);
  const reported = time(state.last_reported);
  fields[`${STATE_PREFIX}last_changed`] = changed;
  // A time equal to the one before it, to the second, is left out (research R5).
  if (updated !== changed) fields[`${STATE_PREFIX}last_updated`] = updated;
  if (reported !== updated) fields[`${STATE_PREFIX}last_reported`] = reported;
  const { id, parent_id: parentId, user_id: userId } = state.context;
  fields[`${STATE_PREFIX}context`] = encodeContextId(id, frame.anchorMs);
  if (parentId !== null)
    fields[`${STATE_PREFIX}parent_id`] = encodeContextId(
      parentId,
      frame.anchorMs,
    );
  if (userId !== null) fields[`${STATE_PREFIX}user_id`] = userId;
  return {
    head: [
      state.entity_id.slice(state.entity_id.indexOf(".") + 1),
      state.state,
    ],
    headKeys: STATE_HEAD_KEYS,
    fields,
    defaults: DEFAULTS,
  };
}

/**
 * The `standard` document (data-model §2, research R4): one template book shared by every domain,
 * domains in name order. `states` must be in entity-ID order, redacted and trimmed.
 */
export function encodeStandardState(
  frame: StateFrame,
  states: readonly HaState[],
): StateStandardDocument {
  const byDomain = new Map<string, Item[]>();
  for (const state of states) {
    const domain = domainOf(state.entity_id);
    const items = byDomain.get(domain) ?? [];
    byDomain.set(domain, items);
    items.push(itemOf(state, frame));
  }
  const book = new TemplateBook();
  const entities: Record<string, Groups> = {};
  for (const domain of [...byDomain.keys()].sort()) {
    entities[domain] = book.group(byDomain.get(domain) as Item[]);
  }
  return {
    ...frame.envelope,
    detail: "standard",
    templates: book.defs,
    entities,
  };
}
