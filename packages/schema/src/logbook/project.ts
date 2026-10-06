import type { LogbookRow } from "./format.js";

/**
 * The projection `standard` is lossless against (data-model §5). P1 truncates `when` to the whole
 * second; P2 removes top-level keys whose value is `null`. Row order is kept.
 */
export function projectLogbook(rows: readonly LogbookRow[]): LogbookRow[] {
  return rows.map((row) => {
    const out: LogbookRow = { when: Math.floor(row.when) };
    for (const [key, value] of Object.entries(row)) {
      if (key === "when" || value === null) continue;
      out[key] = value;
    }
    return out;
  });
}
