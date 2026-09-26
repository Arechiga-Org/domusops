# Data Model: `domusops.logbook/0.1`

The response format of `ha_logbook_query`, a public contract published in `@domusops/schema`
(FR-020). Design rationale and measurements are in [research.md](./research.md). Configuration,
redaction, and errors shared with `ha_snapshot` are referenced, not repeated.

## 1. Input records (retrieved from the instance)

| Record       | Source command       | Used for                                                                                                             |
| ------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Current user | `auth/current_user`  | `is_admin` check only; never emitted                                                                                 |
| Core config  | `get_config`         | `time_zone`, `components` (logbook present), `latitude` and `longitude` (redaction rule C3); nothing else is emitted |
| Logbook row  | `logbook/get_events` | Every emitted event                                                                                                  |

A **logbook row** is a JSON object. Every key is optional except `when`:

| Key                                                                                                                                                                                               | Type   | Meaning                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `when`                                                                                                                                                                                            | number | Seconds since the epoch                                      |
| `entity_id`                                                                                                                                                                                       | string | The entity the event belongs to; absent for some events      |
| `state`                                                                                                                                                                                           | string | New state (state changes)                                    |
| `name`, `message`, `domain`, `source`, `icon`                                                                                                                                                     | string | Description of the event                                     |
| `context_id`                                                                                                                                                                                      | string | ID of the run that produced the event (automations, scripts) |
| `attributes`                                                                                                                                                                                      | object | Exposed state attributes (currently `event_type` only)       |
| `context_user_id`, `context_entity_id`, `context_state`, `context_event_type`, `context_domain`, `context_service`, `context_name`, `context_message`, `context_source`, `context_entity_id_name` | string | The **cause** fields                                         |

Keys not listed are carried through unchanged, as columns or constants, so newer instances with
new keys stay lossless. Older instances that lack a key are accepted.

## 2. Envelope (both detail levels)

| Field               | Type                        | Meaning                                                                                                                                                          |
| ------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`            | string                      | Always `"domusops.logbook/0.1"`                                                                                                                                  |
| `detail`            | `"summary"` \| `"standard"` | The detail level produced                                                                                                                                        |
| `ha_version`        | string                      | Core version reported by the instance                                                                                                                            |
| `compression_ratio` | number                      | `raw_bytes / emitted_bytes`, two decimals (§6)                                                                                                                   |
| `time_zone`         | string                      | The instance's IANA time zone                                                                                                                                    |
| `utc_offset`        | string                      | `±HH:MM`, the offset at the window start; the default for every local time in the document                                                                       |
| `window`            | `{ start, end }`            | The resolved window, local ISO 8601 with offset, to the second (`2026-09-26T03:00:00-06:00`)                                                                     |
| `first`, `last`     | string \| null              | Local time of the earliest and latest event in the response (`2026-09-26T03:12:45`, with the offset appended when it differs from `utc_offset`), null when empty |
| `selectors`         | string[]                    | The selectors as requested, deduplicated, in request order. Absent when none were given                                                                          |
| `no_events`         | string[]                    | The selectors that matched no event, in request order. Absent when every selector matched                                                                        |

## 3. `standard` document

Example (values invented). An automation ran twice and turned on a light each time:

```json
{
  "format": "domusops.logbook/0.1",
  "detail": "standard",
  "ha_version": "2026.9.3",
  "compression_ratio": 1.21,
  "time_zone": "America/Mexico_City",
  "utc_offset": "-06:00",
  "window": {
    "start": "2026-09-26T00:00:00-06:00",
    "end": "2026-09-26T06:00:00-06:00"
  },
  "first": "2026-09-26T03:12:44",
  "last": "2026-09-26T04:20:10",
  "selectors": ["light.hallway", "automation.*"],
  "strings": [
    "Hallway night light",
    "automation",
    "state of binary_sensor.hallway_motion",
    "triggered by state of binary_sensor.hallway_motion"
  ],
  "entities": [
    [
      "automation.hallway_night",
      { "name": 0, "message": 3, "source": 2, "domain": 1 },
      ["context_id"]
    ],
    "light.hallway"
  ],
  "causes": [
    {
      "event_type": "automation_triggered",
      "domain": 1,
      "name": 0,
      "message": 3,
      "source": 2,
      "entity_id": "automation.hallway_night"
    }
  ],
  "events": {
    "2026-09-26": {
      "03:00": [
        ["12:44", 0, null, null, "-3:ZK4M9Q2W7XR5T8BN"],
        ["12:44", 1, "on", 0],
        ["58:02", 1, "off"]
      ],
      "04:00": [
        ["20:10", 0, null, null, "0:1B7C9D2E3F4G5H6J"],
        ["20:10", 1, "on", 0]
      ]
    }
  }
}
```

Reading it: at 03:12:44 the automation `automation.hallway_night` was triggered by the hallway
motion sensor, and in the same second the light turned on, caused by that automation (cause 0).
The light turned off at 03:58:02 with no recorded cause. The automation's `name`, `message`,
`source`, and `domain` are the same in both of its rows, so they are constants; only its
`context_id` varies. A tiny example like this one compresses poorly (the tables are a fixed
cost); see [research R6](./research.md#r6-compression-approach-for-standard).

### 3.1 Sections

| Section    | Form                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strings`  | Array of strings. Absent when empty                                                                                                                                                         |
| `entities` | Array. Entry `i` is either a bare entity ID string (no constants, no columns) or `[entity_id \| null, constants, columns]`. At most one entry has a `null` ID: the events without an entity |
| `causes`   | Array of objects: the `context_*` fields of a row, with the `context_` prefix removed. Absent when empty                                                                                    |
| `events`   | Object: local date `YYYY-MM-DD` → hour key → array of rows                                                                                                                                  |

**Hour keys** are `"HH:00"` in local time. If the hour's UTC offset differs from `utc_offset`, the
key is `"HH:00±HH:MM"` with that hour's offset (a daylight-saving change inside the window).

**Rows** are arrays: `[time, entity, state, cause, column_1, …, column_n]`.

| Position | Content                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| 0        | `"MM:SS"` within the bucket's hour                                                          |
| 1        | Index into `entities`                                                                       |
| 2        | `state`, or `null` when the row has none                                                    |
| 3        | Index into `causes`, or `null` when the row has no cause field                              |
| 4 …      | The entity's columns, in the order of its `columns` list; `null` when the row lacks the key |

Trailing `null` values are dropped, so a row has between 2 and 4 + n elements.

### 3.2 Value encoding

Applies to `state`, constants, column values, and cause values:

| Emitted value        | Meaning                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integer              | Reference into `strings`                                                                                                                                    |
| String               | Literal string                                                                                                                                              |
| `{ "v": <value> }`   | A literal that would otherwise be read as a reference: a number, or an object whose only key is `v` (never observed in logbook data; kept for losslessness) |
| Any other JSON value | Literal (objects such as `attributes`, booleans)                                                                                                            |

A string goes into `strings` when it has at least four characters and occurs at least twice across
those positions. `entity_id` values in the entity table are never replaced by references.

**Context IDs** (the `context_id` column or constant): a 26-character ULID is emitted as
`"<offset>:<last 16 characters>"`, where `offset` is the ULID's millisecond timestamp minus the
start of the event's second. Any other value is emitted verbatim. The two forms are distinguished
by the `:`, which neither a ULID nor a UUID contains. `context_id` values never go into `strings`,
in either form, so a context ID is always a string in the document.

### 3.3 Constants and columns

For an entity with two or more rows, a key other than `when`, `entity_id`, `state`, and the cause
fields is a **constant** when every row has it with the same value. Every other such key is a
**column**. `context_id` is never a constant: its compact form depends on each event's second. Columns are sorted by key. An entity with one row has no constants.

### 3.4 Determinism

Identical input produces byte-identical output:

- Rows keep the order the instance returned (chronological, with recorded order for ties).
- `entities` in order of first appearance; `causes` in order of first appearance.
- `strings` sorted by descending occurrence count, then by code point.
- Object keys: envelope in the order of §2, then `strings`, `entities`, `causes`, `events`.
  Constants in key order; cause objects in the fixed order of the cause fields (§1).
- No object key is integer-like, so insertion order is emission order in every JavaScript engine.

## 4. `summary` document

Envelope (§2) plus:

| Field       | Form                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `counts`    | `{ events, entities, causes, no_entity_events }`                                                       |
| `by_domain` | Object: domain → event count, descending count then domain                                             |
| `by_entity` | Object: entity ID → `[count, first, last]`, local times as in `first`/`last`; descending count then ID |
| `by_cause`  | Array of `[cause, count]`, the cause as in `causes` without the string table; descending count         |

`summary` lists no individual event (FR-009) and is not subject to the size limit.

## 5. Projection (what `standard` does not preserve)

`standard` is lossless relative to the rows after this projection; the round-trip test compares
`expandLogbook(standard)` with `projectLogbook(rows)`:

| #   | Rule                                                                               |
| --- | ---------------------------------------------------------------------------------- |
| P1  | `when` is truncated to the whole second (row order still records sub-second order) |
| P2  | Top-level keys whose value is `null` are removed                                   |

Redaction (§7) is applied before the projection. Nothing else is dropped: every other key and
value of every selected row is recoverable.

## 6. Compression ratio

`raw_bytes` is the UTF-8 byte length of the JSON array of the **selected** rows (after selector
filtering, before redaction), so filtering in the tool does not inflate the ratio. `emitted_bytes`
and rounding follow [001 research R7](../001-ha-snapshot/research.md#r7-compression-ratio-measurement).
An empty result has `compression_ratio` equal to `raw_bytes / emitted_bytes` of the empty
document, a well-defined number below 1.

## 7. Redaction

The rules of [001 data-model §8](../001-ha-snapshot/data-model.md#8-redaction-rules) (K1, V1 to
V6, C1) apply to every row, plus two rules added for free text (both also apply to
`ha_snapshot`):

| #   | Rule                    | Matches                                                                                                                                                                           | Replacement          |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| C2  | Coordinate pair in text | Two decimal numbers with at least three decimals each, separated by a comma or whitespace, the first within ±90 and the second within ±180                                        | Match → `[redacted]` |
| C3  | Configured coordinates  | Any occurrence of the instance's `latitude` or `longitude` from `get_config`, as written in decimal, when it has at least three decimals (shorter values match unrelated numbers) | Match → `[redacted]` |

Exempt keys (identifiers, never redacted): `entity_id`, `context_entity_id`, `context_user_id`,
`context_id`.

## 8. Errors

The error kinds of [001 data-model §9](../001-ha-snapshot/data-model.md#9-errors) apply unchanged,
with the text prefix `ha_logbook_query failed [<kind>]:`. Added kinds:

| `kind`                | Trigger                                                                                      | Next step named in the message                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `window_invalid`      | Unparseable `start`/`end`; `end` not after `start`; `start` after the time of the call       | The problem and the accepted form (`2026-09-26T03:00`, with optional offset)                                                |
| `selector_invalid`    | Empty selector, or a character other than `a-z 0-9 _ . *`                                    | The offending selector and the accepted form                                                                                |
| `history_unavailable` | `logbook` missing from `get_config.components`, or `logbook/get_events` is `unknown_command` | Enable the `logbook` and `recorder` integrations                                                                            |
| `too_large`           | Emitted `standard` document above the size limit                                             | Event count, emitted size, limit; use `summary`, a shorter window, or fewer entities, or raise `DOMUSOPS_LOGBOOK_MAX_BYTES` |

`config_invalid` also covers a `DOMUSOPS_LOGBOOK_MAX_BYTES` that is not a positive integer, naming
that variable. `timeout` during `logbook/get_events` suggests a shorter window.

## 9. Invariants (checked by tests)

1. `expandLogbook(standard) == projectLogbook(redact(selected rows))`, element by element, in
   order (FR-007, SC-002).
2. Every selected row appears exactly once; no other row appears.
3. With selectors, no row without an `entity_id` appears; without selectors, all do.
4. Every selector in `no_events` matched no selected row, and every other selector matched one.
5. Every index in a row resolves (`entities`, `causes`, `strings`).
6. No fragment of six or more characters of any planted secret, coordinate, or e-mail address
   appears in the output, at both detail levels (SC-003).
7. Identical input gives byte-identical output.
8. `standard` on the reference fixture has `compression_ratio >= 5` (FR-018).
9. The emitted `standard` document never exceeds the configured limit; above it, `too_large` is
   returned and no event is (FR-019).
