import {
  CAUSE_FIELDS,
  CAUSE_PREFIX,
  LOGBOOK_FORMAT,
  deepEqual,
  encodeContextId,
  projectLogbook,
  type JsonObject,
  type LogbookEntity,
  type LogbookEvents,
  type LogbookRow,
  type LogbookStandardDocument,
} from "@domusops/schema";
import {
  formatLocalIso,
  formatOffset,
  localParts,
} from "./local-time.js";
import type { ResolvedWindow } from "./window.js";

export interface EncodeContext {
  haVersion: string;
  timeZone: string;
  window: ResolvedWindow;
  selectors: string[] | undefined;
  noEvents: string[];
}

/** Keys that are never a column or a constant: they have a fixed place in the row. */
const FIXED = new Set(["when", "entity_id", "state", ...CAUSE_FIELDS]);
const MIN_STRING = 4;

const pad = (n: number): string => String(n).padStart(2, "0");

interface EntityLayout {
  id: string | null;
  constants: JsonObject;
  columns: string[];
}

/** A value that is already in its final encoded form and must not enter the string table. */
class Encoded {
  constructor(readonly value: unknown) {}
}

/** An encoded row before string references are assigned: values are still raw. */
interface RawRow {
  time: string;
  bucketDate: string;
  hourKey: string;
  entity: number;
  state: unknown;
  cause: number | null;
  columns: unknown[];
  whenSeconds: number;
}

/** A value that is an object of exactly `{ v }` is escaped, so decoding stays unambiguous. */
function isEscapeShaped(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "v" in value
  );
}

/**
 * Encodes the redacted rows of a window as a `domusops.logbook/0.1` standard document (data-model
 * §3). Rows must already be in chronological order. The `compression_ratio` is a placeholder for
 * `finalize` to fill.
 */
export function encodeStandard(
  rows: readonly LogbookRow[],
  context: EncodeContext,
): LogbookStandardDocument {
  const projected = projectLogbook(rows);
  const baseOffset = localParts(context.window.startMs, context.timeZone)
    .offsetMinutes;

  // Entity table, in order of first appearance; the entity of a row without one is null.
  const byEntity = new Map<string | null, LogbookRow[]>();
  for (const row of projected) {
    const id = typeof row.entity_id === "string" ? row.entity_id : null;
    const list = byEntity.get(id);
    if (list === undefined) byEntity.set(id, [row]);
    else list.push(row);
  }
  const layouts: EntityLayout[] = [];
  const entityIndex = new Map<string | null, number>();
  for (const [id, list] of byEntity) {
    const keys = new Set<string>();
    for (const row of list) {
      for (const key of Object.keys(row)) if (!FIXED.has(key)) keys.add(key);
    }
    const constants: JsonObject = {};
    const columns: string[] = [];
    for (const key of [...keys].sort()) {
      const first = list[0]?.[key];
      const constant =
        key !== "context_id" &&
        list.length >= 2 &&
        list.every((row) => key in row && deepEqual(row[key], first));
      if (constant) constants[key] = first;
      else columns.push(key);
    }
    entityIndex.set(id, layouts.length);
    layouts.push({ id, constants, columns });
  }

  // Cause table, in order of first appearance.
  const causes: JsonObject[] = [];
  const causeIndex = new Map<string, number>();
  const causeOf = (row: LogbookRow): number | null => {
    const cause: JsonObject = {};
    for (const field of CAUSE_FIELDS) {
      if (field in row) cause[field.slice(CAUSE_PREFIX.length)] = row[field];
    }
    if (Object.keys(cause).length === 0) return null;
    const key = JSON.stringify(cause);
    let index = causeIndex.get(key);
    if (index === undefined) {
      index = causes.length;
      causeIndex.set(key, index);
      causes.push(cause);
    }
    return index;
  };

  const rawRows: RawRow[] = projected.map((row) => {
    const entity = entityIndex.get(
      typeof row.entity_id === "string" ? row.entity_id : null,
    ) as number;
    const layout = layouts[entity] as EntityLayout;
    const local = localParts(row.when * 1000, context.timeZone);
    const hour = `${pad(local.hour)}:00`;
    return {
      time: `${pad(local.minute)}:${pad(local.second)}`,
      bucketDate: local.date,
      hourKey:
        local.offsetMinutes === baseOffset
          ? hour
          : `${hour}${formatOffset(local.offsetMinutes)}`,
      entity,
      state: row.state,
      cause: causeOf(row),
      columns: layout.columns.map((name) => {
        if (!(name in row)) return null;
        const value = row[name];
        return name === "context_id" && typeof value === "string"
          ? new Encoded(encodeContextId(value, row.when * 1000))
          : value;
      }),
      whenSeconds: row.when,
    };
  });

  // String table: strings of at least four characters that are emitted at least twice.
  const uses = new Map<string, number>();
  const count = (value: unknown): void => {
    if (typeof value === "string" && value.length >= MIN_STRING) {
      uses.set(value, (uses.get(value) ?? 0) + 1);
    }
  };
  for (const layout of layouts) Object.values(layout.constants).forEach(count);
  for (const cause of causes) Object.values(cause).forEach(count);
  for (const row of rawRows) {
    count(row.state);
    row.columns.forEach(count);
  }
  const strings = [...uses]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([text]) => text);
  const stringIndex = new Map(strings.map((text, i) => [text, i]));

  const encodeValue = (value: unknown): unknown => {
    if (value instanceof Encoded) return value.value;
    if (typeof value === "string") return stringIndex.get(value) ?? value;
    if (typeof value === "number" || isEscapeShaped(value)) return { v: value };
    return value;
  };
  const encodeObject = (object: JsonObject): JsonObject =>
    Object.fromEntries(
      Object.entries(object).map(([key, value]) => [key, encodeValue(value)]),
    );

  const entities: LogbookEntity[] = layouts.map((layout) =>
    layout.id !== null &&
    Object.keys(layout.constants).length === 0 &&
    layout.columns.length === 0
      ? layout.id
      : [layout.id, encodeObject(layout.constants), layout.columns],
  );

  const events: LogbookEvents = {};
  for (const row of rawRows) {
    const encoded: unknown[] = [
      row.time,
      row.entity,
      row.state === undefined ? null : encodeValue(row.state),
      row.cause,
      ...row.columns.map((value) => (value === null ? null : encodeValue(value))),
    ];
    while (encoded.length > 2 && encoded[encoded.length - 1] === null) {
      encoded.pop();
    }
    const day = (events[row.bucketDate] ??= {});
    (day[row.hourKey] ??= []).push(encoded);
  }

  const firstRow = projected[0];
  const lastRow = projected[projected.length - 1];
  const document: LogbookStandardDocument = {
    format: LOGBOOK_FORMAT,
    detail: "standard",
    ha_version: context.haVersion,
    compression_ratio: 0,
    time_zone: context.timeZone,
    utc_offset: formatOffset(baseOffset),
    window: {
      start: formatLocalIso(context.window.startMs, context.timeZone, null),
      end: formatLocalIso(context.window.endMs, context.timeZone, null),
    },
    first:
      firstRow === undefined
        ? null
        : formatLocalIso(firstRow.when * 1000, context.timeZone, baseOffset),
    last:
      lastRow === undefined
        ? null
        : formatLocalIso(lastRow.when * 1000, context.timeZone, baseOffset),
    ...(context.selectors === undefined ? {} : { selectors: context.selectors }),
    ...(context.selectors === undefined || context.noEvents.length === 0
      ? {}
      : { no_events: context.noEvents }),
    ...(strings.length === 0 ? {} : { strings }),
    entities,
    ...(causes.length === 0
      ? {}
      : { causes: causes.map((cause) => encodeObject(cause)) }),
    events,
  };
  return document;
}
