# Contract: response notes

Notes are text blocks that follow the document in a successful `ha_logbook_query` or `ha_trace`
response (research R2). The document block is unchanged and stays first. Notes are plain English
and start with `Note:`. Tests assert the wording below, with the placeholders filled.

## Exclusion note

Sent by both tools when `exclude` was given, even when it matched nothing.

```text
Note: excluded <selectors>. Counts, the size check and compression_ratio leave them out.
```

- `<selectors>`: the exclusion list after validation, in request order, comma-separated.

## Discarded-runs note

Sent by `ha_trace` when the query has a window and at least one selected item is affected
(data-model §2). It follows the exclusion note when both are sent.

```text
Note: these automations and scripts store as many runs as they keep, so older runs from the window may be gone: <items>. To keep more, raise stored_traces in the trace options of the automation or script. ha_logbook_query has the full history.
```

- `<items>`: up to 10 entries, ordered by entity ID, `; `-separated, each
  `<entity_id> (keeps <limit>)`, with `, limit assumed` inside the parentheses when the limit
  could not be read. When more than 10 items are affected, `; and <N> more` follows the tenth.
- The note is sent with an empty result as well.
- It is never sent for a query by `run` or `context`, nor for a query without `start` or `end`.

## Unchanged

- Error responses: one block, `isError: true`, no notes.
- Responses of calls that use neither `exclude` nor a window that triggers the warning: exactly
  the single block of 0.1.1.
