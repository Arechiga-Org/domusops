import type {
  SystemLogEntryRow,
  SystemLogStandardDocument,
} from "@domusops/schema";
import { put } from "../util/json.js";
import type { PreparedEntry } from "./entries.js";
import {
  firstOccurrence,
  localStamp,
  type SystemLogFrame,
} from "./envelope.js";
import { PartTable, splitTraceback } from "./traceback.js";

/**
 * The `standard` document (data-model §3, research R6): `files` and `parts` shared by every entry,
 * then the entries grouped by the local date of their last occurrence, in the order given. Each
 * entry is positional, trailing `null` values dropped. The `compression_ratio` is a placeholder
 * for `finalize` to fill.
 */
export function encodeStandardSystemLog(
  frame: SystemLogFrame,
  entries: readonly PreparedEntry[],
): SystemLogStandardDocument {
  const tracebacks = entries.map((entry) =>
    entry.traceback === null ? null : splitTraceback(entry.traceback),
  );
  const table = new PartTable(tracebacks.filter((items) => items !== null));
  const byDate: Record<string, SystemLogEntryRow[]> = {};
  entries.forEach((entry, i) => {
    const { raw } = entry;
    const last = localStamp(raw.timestamp, frame);
    const source: [number, number] = [
      table.file(entry.sourcePath),
      raw.source[1],
    ];
    const items = tracebacks[i];
    const row: unknown[] = [
      last.time,
      entry.level,
      raw.name,
      entry.integration?.domain ?? null,
      source,
      raw.count,
      entry.messages,
      firstOccurrence(raw.first_occurred, raw.timestamp, last, frame),
      items === null || items === undefined ? null : table.items(items),
      entry.integration?.bySource === true ? 1 : null,
    ];
    while (row.at(-1) === null) row.pop();
    let rows = byDate[last.date];
    if (rows === undefined) {
      rows = [];
      put(byDate, last.date, rows);
    }
    rows.push(row as SystemLogEntryRow);
  });
  return {
    ...frame.envelope,
    detail: "standard",
    files: table.files,
    parts: table.parts,
    entries: byDate,
  };
}
