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
 * Sent by `ha_state` when exact IDs in `entities` name no entity (specs/010-ha-state FR-013,
 * research R13). Past the tenth, only their number is given.
 */
export function notFoundNote(ids: readonly string[]): string {
  const named = ids.slice(0, MAX_NOTE_ITEMS).join(", ");
  const more =
    ids.length > MAX_NOTE_ITEMS
      ? `, and ${ids.length - MAX_NOTE_ITEMS} more`
      : "";
  return `Note: no entity has the ID ${named}${more}.`;
}

/**
 * Sent by `ha_history` when exact IDs in `entities` have no recorded history (specs/011-ha-history
 * FR-012, research R14). Past the tenth, only their number is given.
 */
export function noHistoryNote(ids: readonly string[]): string {
  const named = ids.slice(0, MAX_NOTE_ITEMS).join(", ");
  const more =
    ids.length > MAX_NOTE_ITEMS
      ? `, and ${ids.length - MAX_NOTE_ITEMS} more`
      : "";
  return `Note: no recorded history for the ID ${named}${more}.`;
}

/** Sent by `ha_history` when entities were selected but none of them is listed (research R14). */
export function nothingChangedNote(): string {
  return "Note: no selected entity changed in the window.";
}

/** Sent by `ha_state` when the query selected no entity, after the not-found note if any. */
export function nothingMatchedNote(): string {
  return "Note: no entity matched the query.";
}

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
  return `Note: these automations and scripts store as many runs as they keep, so older runs from the window may be gone: ${named.join("; ")}${more}. To keep more, raise stored_traces in the trace options of the automation or script. ha_logbook_query has the full history.`;
}
