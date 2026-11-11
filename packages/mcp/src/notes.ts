/**
 * Notes that follow the document in a successful response, as further text blocks. The document
 * stays first and unchanged; the wording is specs/008-mcp-reliability/contracts/response-notes.md.
 */

/** A tool's outcome: the minified document, then the notes that follow it, in order. */
export interface Response {
  document: string;
  notes: string[];
}

/** Sent when `exclude` was given, even when it matched nothing. */
export function exclusionNote(selectors: readonly string[]): string {
  return `Note: excluded ${selectors.join(", ")}. Counts, the size check and compression_ratio leave them out.`;
}

/** The most items the discarded-runs note names (research R5). */
export const MAX_NOTE_ITEMS = 10;

/**
 * Sent by `ha_trace` when a windowed query selected items whose stored runs may no longer reach
 * the window start. `items` is in entity-ID order; past the tenth, only their number is given.
 */
export function discardedRunsNote(
  items: readonly { entityId: string; limit: number; assumed: boolean }[],
): string {
  const named = items
    .slice(0, MAX_NOTE_ITEMS)
    .map(
      (item) =>
        `${item.entityId} (keeps ${item.limit}${item.assumed ? ", limit assumed" : ""})`,
    );
  const more =
    items.length > MAX_NOTE_ITEMS
      ? `; and ${items.length - MAX_NOTE_ITEMS} more`
      : "";
  return `Note: these automations and scripts keep only their most recent runs, and older runs that may fall in the window are gone: ${named.join("; ")}${more}. To keep more, raise stored_traces in the trace options of the automation or script. ha_logbook_query has the full history.`;
}
