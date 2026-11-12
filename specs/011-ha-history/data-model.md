# Data Model: ha_history

## 1. Raw entry (`history/history_during_period`)

As measured in research R1. The answer maps each entity ID with recorded history to a list of
entries in time order.

| Key  | Type   | Rule                                                                              |
| ---- | ------ | --------------------------------------------------------------------------------- |
| `s`  | string | The state                                                                         |
| `a`  | object | The attributes; `{}` when read with `no_attributes`                               |
| `lu` | number | `last_updated`, seconds since the epoch with microseconds                         |
| `lc` | number | `last_changed`, present only when it differs from `lu` (the state did not change) |

The first entry is the start state when its `lu` equals the window start (R1, R3); the tool
compares at the millisecond.

## 2. Envelope (`domusops.history/0.1`)

Both detail levels share these keys, in this order; minified JSON.

| Key                 | Type                      | Rule                                                                        |
| ------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `format`            | `"domusops.history/0.1"`  | Constant                                                                    |
| `detail`            | `"summary" \| "standard"` | The requested level                                                         |
| `ha_version`        | string                    | From the handshake                                                          |
| `compression_ratio` | number                    | Raw bytes of the history read over the document's bytes, two decimals (R12) |
| `time_zone`         | string                    | IANA name, from `get_config`                                                |
| `utc_offset`        | `±HH:MM`                  | The offset at the window start; the default for every local time            |
| `window`            | `{ start, end }`          | The resolved window, local ISO 8601 with offset, to the second (R5)         |
| `selectors`         | string array, optional    | `entities` as parsed, when given                                            |
| `attributes`        | string array, optional    | `attributes` as parsed, when given (`standard` only)                        |
| `significant_only`  | `true`, optional          | Present only when the input was true                                        |

`exclude` is not echoed: the exclusion note names it (feature 008).

## 3. Standard document

Envelope, then `entities`: a map from entity ID to an entry, IDs in order. Only the entities
research R3 lists appear.

| Key       | Type                  | Rule                                                                                                           |
| --------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `start`   | array, optional       | `[state, attributes]` or `[state, attributes, since]`; absent when the entity began inside the window          |
| `changes` | bucket map, optional  | `{ "YYYY-MM-DD": { "HH:00" \| "HH:00±HH:MM": [row, ...] } }`; dates and hours in time order; absent when empty |
| `skipped` | integer ≥ 1, optional | Changes the `attributes` filter left out (R9)                                                                  |

- `attributes` in `start` are redacted (R8) and, with the `attributes` input, trimmed (R9).
- `since`: local ISO 8601 to the second, offset left out when it equals `utc_offset`; the time
  the start state took effect, when the history gives it (R6).
- An hour key carries `±HH:MM` only when its offset differs from `utc_offset` (a DST change in the
  window), as in the logbook.

A row, positional, trailing `null` values dropped:

| Position | Value                  | Rule                                                                    |
| -------- | ---------------------- | ----------------------------------------------------------------------- |
| 0        | `"MM:SS"`              | Minute and second within the bucket's hour, from `lu`, truncated        |
| 1        | string or `null`       | The new state, `null` when the state did not change                     |
| 2        | object or `null`       | Attributes added or changed since the previous listed entry, new values |
| 3        | string array or `null` | Attributes removed since the previous listed entry, in name order       |

A row `["MM:SS"]` is a change in which nothing visible changed (an attribute the filter left out
is never the reason: such changes are skipped, R9). The first change of an entity without `start`
carries its state and every attribute in position 2.

## 4. Summary document

Envelope (without `attributes`), then:

| Key         | Type                                                                     | Rule                                                                   |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `counts`    | `{ entities, changes, state_changes, attribute_only }`                   | Totals over the entities with a change                                 |
| `by_domain` | map of domain to `[entities, changes, state_changes, attribute_only]`    | Domains with a change, in name order                                   |
| `by_entity` | map of entity ID to `[changes, state_changes, attribute_only]`, optional | Only when the call has `entities`; entities with a change, in ID order |

`changes = state_changes + attribute_only` in every row. Without `entities`, the document stays
under 4,000 bytes (R11).

## 5. Selection and listing

| Selected by               | Changed in the window | Listed in `standard`       | In `by_entity` | Note       |
| ------------------------- | --------------------- | -------------------------- | -------------- | ---------- |
| Exact ID                  | yes                   | start (if any) and changes | yes            |            |
| Exact ID                  | no, has a start state | start only                 | no             |            |
| Exact ID                  | no recorded history   | no                         | no             | no history |
| Pattern, or no `entities` | yes                   | start (if any) and changes | yes            |            |
| Pattern, or no `entities` | no                    | no                         | no             |            |

## 6. Decoded entry (`expandHistory`)

`expandHistory(document)` returns `{ entity_id, entries }[]` in entity-ID order; each entry:

| Key            | Type           | Rule                                                                                                          |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `start`        | boolean        | True for the start state                                                                                      |
| `state`        | string         | Carried forward when a row's state is `null`                                                                  |
| `attributes`   | object         | The previous entry's, with `set` applied and `unset` removed                                                  |
| `last_updated` | string         | Local ISO 8601 with offset; the window start for the start state                                              |
| `last_changed` | string \| null | The entry's own time when its state changed; otherwise the previous entry's; for the start, `since` or `null` |

## 7. Errors

| Kind                           | When                                            | Source                              |
| ------------------------------ | ----------------------------------------------- | ----------------------------------- |
| `selector_invalid`             | `entities` or `exclude` malformed               | existing                            |
| `window_invalid`               | malformed, start after end, start in the future | existing                            |
| `window_invalid`               | longer than 10 days                             | new `windowTooLong` (R5)            |
| `input_invalid`                | `attributes` malformed, or with `summary`       | `inputInvalid("history")` (R4)      |
| `not_admin`                    | the token's user is not an administrator        | `notAdmin("entity_history")` (R2)   |
| `history_unavailable`          | `history` not loaded, or the command unknown    | `historyUnavailable("states")` (R2) |
| `too_large`                    | above `DOMUSOPS_HISTORY_MAX_BYTES`              | new `tooLargeHistory` (R10)         |
| connection and protocol errors | as in every tool                                | existing                            |
