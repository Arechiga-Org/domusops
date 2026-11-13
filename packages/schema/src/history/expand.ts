import type { JsonObject } from "../format.js";
import type {
  HistoryEntityRecords,
  HistoryRecord,
  HistoryStandardDocument,
} from "./format.js";

const WITH_OFFSET = /[+-]\d{2}:\d{2}$/;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sets `key` as an own property even when it is `__proto__`, which plain assignment would turn into
 * a prototype change and lose.
 */
function put(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function copy(source: JsonObject): JsonObject {
  const target: JsonObject = {};
  for (const [key, value] of Object.entries(source)) put(target, key, value);
  return target;
}

/**
 * Reference decoder of the `standard` history document (data-model §6, research R13). It returns
 * each entity's entries in entity-ID order: the start state, then every change with its full
 * attributes, `last_updated` to the second and `last_changed` restored from the sequence, every
 * time in local ISO 8601 with its offset. Entries share nested attribute values. A `summary`
 * document has no entries and is refused.
 */
export function expandHistory(
  document: HistoryStandardDocument,
): HistoryEntityRecords[] {
  if ((document.detail as string) !== "standard") {
    throw new Error(
      `expandHistory decodes detail=standard documents, not detail=${String(document.detail)}`,
    );
  }
  const withOffset = (text: string): string =>
    WITH_OFFSET.test(text) ? text : `${text}${document.utc_offset}`;

  return Object.keys(document.entities)
    .sort(compare)
    .map((entityId) => {
      const entry = document.entities[entityId] ?? {};
      const entries: HistoryRecord[] = [];
      let previous: HistoryRecord | undefined;
      if (entry.start !== undefined) {
        const [state, attributes, since] = entry.start;
        previous = {
          start: true,
          state,
          attributes: copy(attributes),
          last_updated: document.window.start,
          last_changed: since === undefined ? null : withOffset(since),
        };
        entries.push(previous);
      }
      for (const [date, hours] of Object.entries(entry.changes ?? {})) {
        for (const [hourKey, rows] of Object.entries(hours)) {
          const hour = hourKey.slice(0, 2);
          const offset =
            hourKey.length > 5 ? hourKey.slice(5) : document.utc_offset;
          for (const row of rows) {
            const [time, state, set, unset] = row;
            const at = `${date}T${hour}:${time}${offset}`;
            const attributes = copy(previous?.attributes ?? {});
            for (const name of unset ?? []) delete attributes[name];
            for (const [key, value] of Object.entries(set ?? {}))
              put(attributes, key, value);
            const changed = state !== null && state !== undefined;
            const record: HistoryRecord = {
              start: false,
              state: changed ? state : (previous?.state ?? ""),
              attributes,
              last_updated: at,
              last_changed: changed ? at : (previous?.last_changed ?? null),
            };
            entries.push(record);
            previous = record;
          }
        }
      }
      return { entity_id: entityId, entries };
    });
}
