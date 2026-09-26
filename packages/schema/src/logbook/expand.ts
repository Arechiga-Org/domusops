import type { JsonObject } from "../format.js";
import {
  CAUSE_PREFIX,
  type LogbookRow,
  type LogbookStandardDocument,
} from "./format.js";
import { decodeContextId } from "./ulid.js";

const HOUR_KEY = /^(\d{2}):00([+-]\d{2}:\d{2})?$/;

function offsetSeconds(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  return (
    sign * (Number(offset.slice(1, 3)) * 3600 + Number(offset.slice(4, 6)) * 60)
  );
}

function isEscape(value: unknown): value is { v: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "v" in value
  );
}

/**
 * Reference decoder of the `standard` logbook document (data-model §3). It restores every row the
 * projection of data-model §5 keeps: `when` as whole seconds since the epoch, the entity, constants,
 * cause fields with their `context_` prefix, columns, and context IDs. Rows come back in document
 * order, which is chronological.
 */
export function expandLogbook(document: LogbookStandardDocument): LogbookRow[] {
  const strings = document.strings ?? [];
  const causes = document.causes ?? [];

  /** An integer is a reference into `strings`; `{ v }` is a literal; anything else is literal. */
  const value = (encoded: unknown): unknown => {
    if (typeof encoded === "number") return strings[encoded];
    return isEscape(encoded) ? encoded.v : encoded;
  };

  const rows: LogbookRow[] = [];
  for (const [date, hours] of Object.entries(document.events)) {
    const [year, month, day] = date.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    for (const [hourKey, bucket] of Object.entries(hours)) {
      const match = HOUR_KEY.exec(hourKey);
      if (match === null) throw new Error(`Invalid hour key "${hourKey}"`);
      const hour = Number(match[1]);
      const offset = offsetSeconds(match[2] ?? document.utc_offset);
      for (const encodedRow of bucket) {
        const [time, entityIndex, state, causeIndex, ...columns] = encodedRow as [
          string,
          number,
          unknown,
          unknown,
          ...unknown[],
        ];
        const minute = Number(time.slice(0, 2));
        const second = Number(time.slice(3, 5));
        const when =
          Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - offset;
        const row: LogbookRow = { when };

        const entry = document.entities[entityIndex];
        if (entry === undefined) throw new Error(`No entity ${entityIndex}`);
        const [id, constants, names]: [string | null, JsonObject, string[]] =
          typeof entry === "string" ? [entry, {}, []] : entry;
        if (id !== null) row.entity_id = id;
        for (const [key, encoded] of Object.entries(constants)) {
          row[key] = value(encoded);
        }
        if (state !== null && state !== undefined) row.state = value(state) as string;
        if (typeof causeIndex === "number") {
          const cause = causes[causeIndex];
          if (cause === undefined) throw new Error(`No cause ${causeIndex}`);
          for (const [key, encoded] of Object.entries(cause)) {
            row[`${CAUSE_PREFIX}${key}`] = value(encoded);
          }
        }
        names.forEach((name, i) => {
          const encoded = columns[i];
          if (encoded === null || encoded === undefined) return;
          row[name] =
            name === "context_id" && typeof encoded === "string"
              ? decodeContextId(encoded, when * 1000)
              : value(encoded);
        });
        rows.push(row);
      }
    }
  }
  return rows;
}
