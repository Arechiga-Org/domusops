import { decodeGroups } from "../expand.js";
import type { JsonObject } from "../format.js";
import { STATE_PREFIX, unescapeKey } from "../keyspace.js";
import { decodeContextId } from "../logbook/ulid.js";
import {
  STATE_HEAD_KEYS,
  type StateRecord,
  type StateStandardDocument,
} from "./format.js";

const WITH_OFFSET = /[+-]\d{2}:\d{2}$/;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Reference decoder of the `standard` state document (data-model §6, research R11). It returns
 * one record per entity in entity-ID order, with every time in local ISO 8601 with its offset and
 * every context ID in full. A `summary` document has no records and is refused.
 */
export function expandState(document: StateStandardDocument): StateRecord[] {
  if ((document.detail as string) !== "standard") {
    throw new Error(
      `expandState decodes detail=standard documents, not detail=${String(document.detail)}`,
    );
  }
  const anchorMs = Date.parse(document.anchor);
  const time = (value: unknown): string => {
    const text = String(value);
    return WITH_OFFSET.test(text) ? text : `${text}${document.utc_offset}`;
  };
  const context = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return decodeContextId(value, anchorMs);
    return String((value as { v: unknown }).v);
  };

  const records: StateRecord[] = [];
  for (const [domain, groups] of Object.entries(document.entities)) {
    for (const item of decodeGroups(
      groups,
      document.templates,
      STATE_HEAD_KEYS,
    )) {
      const [objectId, state] = item.head as [string, string];
      const st: JsonObject = {};
      const attributes: JsonObject = {};
      for (const [key, value] of Object.entries(item.fields)) {
        if (key.startsWith(STATE_PREFIX))
          st[key.slice(STATE_PREFIX.length)] = value;
        else attributes[unescapeKey(key)] = value;
      }
      const lastChanged = time(st["last_changed"]);
      const lastUpdated =
        st["last_updated"] === null || st["last_updated"] === undefined
          ? lastChanged
          : time(st["last_updated"]);
      const lastReported =
        st["last_reported"] === null || st["last_reported"] === undefined
          ? lastUpdated
          : time(st["last_reported"]);
      records.push({
        entity_id: `${domain}.${objectId}`,
        state,
        attributes,
        last_changed: lastChanged,
        last_updated: lastUpdated,
        last_reported: lastReported,
        context: {
          id: context(st["context"]) as string,
          parent_id: context(st["parent_id"]),
          user_id:
            st["user_id"] === null || st["user_id"] === undefined
              ? null
              : String(st["user_id"]),
        },
      });
    }
  }
  return records.sort((a, b) => compare(a.entity_id, b.entity_id));
}
