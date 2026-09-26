import {
  CAUSE_FIELDS,
  CAUSE_PREFIX,
  type JsonObject,
  type LogbookRow,
} from "@domusops/schema";

/**
 * The cause of a row: its `context_*` fields without the prefix, in the fixed order of
 * `CAUSE_FIELDS` (data-model §3.4), or null when it has none. Shared by both detail levels so a
 * change to what a cause is happens in one place.
 */
export function extractCause(row: LogbookRow): JsonObject | null {
  const cause: JsonObject = {};
  for (const field of CAUSE_FIELDS) {
    if (field in row) cause[field.slice(CAUSE_PREFIX.length)] = row[field];
  }
  return Object.keys(cause).length === 0 ? null : cause;
}
