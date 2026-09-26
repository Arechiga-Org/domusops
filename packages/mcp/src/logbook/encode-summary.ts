import {
  CAUSE_FIELDS,
  CAUSE_PREFIX,
  projectLogbook,
  type JsonObject,
  type LogbookRow,
  type LogbookSummaryDocument,
} from "@domusops/schema";
import {
  buildEnvelope,
  baseOffsetMinutes,
  type EncodeContext,
} from "./envelope.js";
import { formatLocalIso } from "./local-time.js";

const byCountThenKey = <T>(
  a: [string, T, number],
  b: [string, T, number],
): number => b[2] - a[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * Encodes the redacted rows of a window as a `domusops.logbook/0.1` summary document (data-model
 * §4): counts and topology only, never an individual event. The `compression_ratio` is a
 * placeholder for `finalize` to fill.
 */
export function encodeSummary(
  rows: readonly LogbookRow[],
  context: EncodeContext,
): LogbookSummaryDocument {
  const projected = projectLogbook(rows);
  const base = baseOffsetMinutes(context);

  const entities = new Map<
    string,
    { count: number; first: number; last: number }
  >();
  const domains = new Map<string, number>();
  const causes = new Map<string, { cause: JsonObject; count: number }>();
  let noEntity = 0;

  for (const row of projected) {
    if (typeof row.entity_id !== "string") {
      noEntity++;
    } else {
      const seen = entities.get(row.entity_id);
      if (seen === undefined) {
        entities.set(row.entity_id, {
          count: 1,
          first: row.when,
          last: row.when,
        });
      } else {
        seen.count++;
        seen.first = Math.min(seen.first, row.when);
        seen.last = Math.max(seen.last, row.when);
      }
      const domain = row.entity_id.split(".")[0] as string;
      domains.set(domain, (domains.get(domain) ?? 0) + 1);
    }
    const cause: JsonObject = {};
    for (const field of CAUSE_FIELDS) {
      if (field in row) cause[field.slice(CAUSE_PREFIX.length)] = row[field];
    }
    if (Object.keys(cause).length > 0) {
      const key = JSON.stringify(cause);
      const seen = causes.get(key);
      if (seen === undefined) causes.set(key, { cause, count: 1 });
      else seen.count++;
    }
  }

  const local = (seconds: number): string =>
    formatLocalIso(seconds * 1000, context.timeZone, base);

  return {
    ...buildEnvelope(context, projected, "summary"),
    counts: {
      events: projected.length,
      entities: entities.size,
      causes: causes.size,
      no_entity_events: noEntity,
    },
    by_domain: Object.fromEntries(
      [...domains]
        .map(([domain, count]): [string, number, number] => [
          domain,
          count,
          count,
        ])
        .sort(byCountThenKey)
        .map(([domain, count]) => [domain, count]),
    ),
    by_entity: Object.fromEntries(
      [...entities]
        .map(([id, e]): [string, typeof e, number] => [id, e, e.count])
        .sort(byCountThenKey)
        .map(([id, e]) => [id, [e.count, local(e.first), local(e.last)]]),
    ),
    by_cause: [...causes]
      .map(([key, c]): [string, typeof c, number] => [key, c, c.count])
      .sort(byCountThenKey)
      .map(([, c]): [JsonObject, number] => [c.cause, c.count]),
  };
}
