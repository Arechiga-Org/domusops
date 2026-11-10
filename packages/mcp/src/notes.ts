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
