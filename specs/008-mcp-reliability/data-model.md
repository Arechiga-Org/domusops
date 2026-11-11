# Data Model: mcp reliability

No published format changes (spec FR-015). The entities below exist only inside
`@domusops/mcp` or in the text of a response.

## 1. Exclusion list

| Field      | Rule                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entries    | 1 to 100 strings, each 1 to 128 characters of `a-z`, `0-9`, `_`, `.`, `*`; duplicates dropped, request order kept (the `entities` rules, `parseSelectors`) |
| Match      | Anchored, case-sensitive; `*` matches any sequence, including an empty one (`matches`)                                                                     |
| Applies to | Logbook rows with an `entity_id`; trace runs by their item's entity ID                                                                                     |
| Order      | After `entities`; an entity matched by both is excluded                                                                                                    |
| Absent     | No filtering and no exclusion note; the document is identical to 0.1.1                                                                                     |

Selection with exclusion, for one entity ID `e`:

| `entities` | `e` matched by `entities` | `e` matched by `exclude` | Kept |
| ---------- | ------------------------- | ------------------------ | ---- |
| absent     | —                         | no                       | yes  |
| absent     | —                         | yes                      | no   |
| given      | no                        | any                      | no   |
| given      | yes                       | no                       | yes  |
| given      | yes                       | yes                      | no   |

Logbook rows without an entity are kept when `entities` is absent, whatever `exclude` says.

When every exact ID in `entities` is excluded, nothing is requested from the instance and the
result is an empty, valid document.

## 2. Stored-run limit

Per automation or script, per bucket (`runs`, `not_triggered`):

| Field    | Source                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `count`  | Records of that item and bucket in the `trace/list` result                                                                       |
| `oldest` | Earliest `timestamp.start` among them                                                                                            |
| `limit`  | `raw_config.trace.stored_traces` from `automation/config` or `script/config`; 5 when absent; 5 and `assumed` when the read fails |

An item is **affected** when the query has a window and, for at least one bucket,
`count ≥ limit` and `oldest` is after the window start (with only `end`, the window starts 24 hours before it). Excluded
items are never affected.

## 3. Response notes

A response is a list of text blocks:

1. the document, unchanged (JSON in the tool's published format);
2. zero or more notes, in this order: the exclusion note (logbook and trace, when `exclude` was
   given), then the discarded-runs note (trace, when at least one item is affected).

An error response is unchanged: one block, no notes. The exact wording is in
[contracts/response-notes.md](./contracts/response-notes.md).
