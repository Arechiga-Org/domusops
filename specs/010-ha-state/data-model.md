# Data Model: ha_state

## 1. Envelope (`domusops.state/0.1`)

Both detail levels share these keys, in this order; minified JSON.

| Key                 | Type                      | Rule                                                                                                 |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `format`            | `"domusops.state/0.1"`    | Constant                                                                                             |
| `detail`            | `"summary" \| "standard"` | The requested level                                                                                  |
| `ha_version`        | string                    | From the handshake                                                                                   |
| `compression_ratio` | number                    | Raw bytes of the selected states over the document's bytes, two decimals (research R10)              |
| `time_zone`         | string                    | IANA name, from `get_config`                                                                         |
| `utc_offset`        | `±HH:MM`                  | The offset at `anchor`; the default for every local time in the document                             |
| `anchor`            | string                    | Local ISO 8601 with offset, to the second: the latest `last_updated` selected, or the call time (R5) |
| `selectors`         | string array, optional    | `entities` as parsed, when given                                                                     |
| `domains`           | string array, optional    | `domain` as parsed, when given                                                                       |
| `states`            | string array, optional    | `state` as parsed, when given                                                                        |
| `attributes`        | string array, optional    | `attributes` as parsed, when given (`standard` only)                                                 |

`exclude` is not echoed: the exclusion note names it (feature 008).

## 2. Standard document

Envelope, then:

| Key         | Type                              | Rule                                                                                                        |
| ----------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `templates` | map of template key to `Template` | Shared by every domain; `{ const, cols }`, as in the snapshot                                               |
| `entities`  | map of domain to `Groups`         | Domains in name order; within each group, records in object-ID order; `expandState` returns entity-ID order |

A record, positional in a template row or an inline object under `_`:

- Head: `object_id` (the entity ID after `<domain>.`), then `state`. In an inline object the head
  keys are `id` and `state`.
- Fields, after the head:
  - Every kept attribute, its key escaped with `escapeKey` (a key starting with `st.`, `reg.` or
    `~`, or equal to `entity_id`, `state`, `device`, `alias` or `id`, gains a leading `~`).
  - The state fields, prefixed `st.`:

| Field              | Value                   | Default (left out when)         |
| ------------------ | ----------------------- | ------------------------------- |
| `st.last_changed`  | local time (§4)         | never left out                  |
| `st.last_updated`  | local time              | `null`: equal to `last_changed` |
| `st.last_reported` | local time              | `null`: equal to `last_updated` |
| `st.context`       | compact context ID (§5) | never left out                  |
| `st.parent_id`     | compact context ID      | `null`: the instance gave none  |
| `st.user_id`       | the user ID as given    | `null`: the instance gave none  |

Within a template, a field every member holds with one value is a constant, and a field every
member leaves at its default is absent, as in the snapshot's `TemplateBook`.

## 3. Summary document

Envelope, then:

| Key         | Type                                                | Rule                                           |
| ----------- | --------------------------------------------------- | ---------------------------------------------- |
| `counts`    | `{ entities, domains }`                             | Of the selected entities                       |
| `by_domain` | map of domain to `[entities, unavailable, unknown]` | Domains in name order; states compared exactly |

## 4. Times

`YYYY-MM-DDTHH:MM:SS` in the instance's time zone, with `±HH:MM` appended only when its offset
differs from `utc_offset` (`formatLocalIso`). Sub-second digits are dropped.

## 5. Context IDs

A 26-character ULID becomes `"<offset>:<last 16 characters>"`, the offset being its millisecond
timestamp minus `anchor`'s (`encodeContextId`). Any other ID is kept, and one that already looks
compact is wrapped as `{ "v": id }`. `ha_trace` and `ha_logbook_query` accept the compact form
in `context`.

## 6. Decoded record (`expandState`)

| Key             | Type                                                       |
| --------------- | ---------------------------------------------------------- |
| `entity_id`     | string                                                     |
| `state`         | string                                                     |
| `attributes`    | object, keys unescaped                                     |
| `last_changed`  | local ISO 8601 with offset                                 |
| `last_updated`  | local ISO 8601 with offset                                 |
| `last_reported` | local ISO 8601 with offset                                 |
| `context`       | `{ id, parent_id, user_id }`, full IDs, `null` when absent |

Records come in entity-ID order.

## 7. Validation

- Every document is valid against `stateJsonSchema`.
- `expandState(encode(redact(states)))` equals the redacted states, times compared to the
  second and in local form.
- Two calls against unchanged states give byte-identical documents.
- Inputs: see research R3; errors `selector_invalid`, `input_invalid`, `too_large`, and the
  shared connection errors.
