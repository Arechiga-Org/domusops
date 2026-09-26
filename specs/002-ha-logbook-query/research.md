# Research: ha_logbook_query

Phase 0 output for [plan.md](./plan.md). Every open question from the Technical Context is
resolved here. Facts about the Home Assistant logbook were verified against the
`home-assistant/core` source (`dev` branch, `homeassistant/components/logbook/`) on 2026-09-26,
not recalled from memory. Measurements come from the maintainer's live instance (2026.9.3, 1,175
entities) on the same day. Only aggregate numbers were recorded: no entity ID, state, name, or
message left the probe.

Decisions inherited unchanged from [001 research](../001-ha-snapshot/research.md): the WebSocket
client and handshake (R2, R3), the version floor `2025.1.0` as a refusal threshold (R2), the MCP
result shape (R5), the ratio definition (R7), and the test tooling (R9).

## R1. Logbook command and its semantics

**Decision**: Use `logbook/get_events`, a single request/response command:

| Parameter    | Use                                                              |
| ------------ | ---------------------------------------------------------------- |
| `start_time` | Always sent: the resolved window start, as a UTC ISO 8601 string |
| `end_time`   | Always sent: the resolved window end                             |
| `entity_ids` | Sent only when every selector is an exact entity ID (see R4)     |
| `device_ids` | Never sent (filtering by device is out of scope)                 |
| `context_id` | Never sent                                                       |

It returns a JSON array of rows, in chronological order. `logbook/event_stream` (a subscription
for live updates) is not used: live streaming is out of scope, and a one-shot read needs no
subscription.

**Verified behaviour** (source, then confirmed live):

- **Row keys.** State changes: `state`, `entity_id`, `when`, optionally `icon` and `attributes`
  (only `event_type`, on newer versions). Described external events (automation triggered, script
  started, instance start and stop, and integration-specific events): `name`, `message`, `domain`,
  `entity_id`, `when`, and optionally `source` and `context_id`. Custom logbook entries: `name`,
  `message`, `domain`, `entity_id` (may be absent). Any row may carry `context_user_id` and the
  cause fields `context_entity_id`, `context_state`, `context_event_type`, `context_domain`,
  `context_service`, `context_name`, `context_message`, `context_source`.
- **`when`** is a float number of seconds since the epoch (the websocket handler sets
  `timestamp=True`), with sub-millisecond precision.
- **No entity names.** The handler sets `include_entity_name=False`, so state-change rows carry
  no `name` and cause fields carry no `context_entity_id_name`. Nothing needs to be resolved to
  keep the output lossless.
- **Rows do not carry their own context ID.** The cause arrives as the flat `context_*` fields
  only. Two events share a cause exactly when those fields are equal (R6).
- **Continuous entities are excluded** by the logbook itself: `counter`, `image`, `proximity`,
  and sensors with a unit of measurement, a state class, or a numeric device class. When every
  requested entity ID is continuous, the handler returns `[]` without querying. Confirmed live: a
  sensor with a unit returned 0 events.
- **Errors.** An unparseable `start_time` or `end_time` returns `invalid_start_time` /
  `invalid_end_time`. A start in the future returns `[]` (confirmed live). A missing logbook
  integration makes the command unknown (`unknown_command`).
- **YAML logbook filters.** The unfiltered query applies the instance's `logbook:`
  include/exclude configuration; the `entity_ids` query does not. See R4 for the consequence.

**Alternatives considered**: `history/history_during_period` (state history for all entities,
including continuous sensors). It is a different data set with a different compression problem
(sampling), out of scope per spec Clarifications.

## R2. Privileges

**Decision**: Keep the administrator requirement of `ha_snapshot` (`auth/current_user.is_admin`),
with the same `not_admin` error.

**Finding**: `logbook/get_events` has no permission check and no per-user filtering (no
`require_admin`, no use of the user's permissions anywhere in the component). A non-administrator
token would currently receive the same events. The spec's original rationale ("the instance may
filter the events such a user can see") was therefore wrong and has been corrected in its
Assumptions.

**Rationale** (maintainer decision, 2026-09-26): one token and one configuration work for both
tools, the error set stays identical (FR-014), and a future per-user filter in the logbook could
not silently shrink results.

**Alternatives considered**: accepting any user. It saves one command, but the two tools would
diverge: a non-administrator token would work for one and fail for the other.

## R3. Time window and time zone

**Decision**:

- Input timestamps are ISO 8601: `YYYY-MM-DDTHH:MM[:SS[.fff]]`, optionally followed by `Z` or
  `±HH:MM`. Anything else is `window_invalid`. Syntax is checked before connecting; the order
  checks (`end` after `start`, `start` not in the future) need the time zone, so they run after
  `get_config` and before `logbook/get_events`.
- A timestamp without an offset is interpreted in the instance's time zone (`get_config.time_zone`,
  an IANA name). Resolution uses `Intl.DateTimeFormat` (no dependency). In a daylight-saving gap
  the time is shifted forward by the gap; in an overlap the earlier instant is used. Both cases
  are documented in the contract.
- Defaults: `end` is the time of the call; `start` is `end` minus 24 hours.
- `end` is fixed when the call starts. An `end` later than that is clamped to it, and the response
  states the clamped window, so nothing is hidden.
- A `start` later than the time of the call, or an `end` not after `start`, is `window_invalid`
  (the instance itself would return an empty list for a future start, which would look like "no
  activity").
- There is no maximum window. Large windows are bounded by the size limit (R8) and the timeouts
  (R9).

**Rationale**: agents produce ISO 8601 reliably; the instance's time zone is the one the user
thinks in ("at 3 a.m.").

## R4. Entity selectors

**Decision**: Input `entities`: an optional list of 1 to 100 selectors. A selector is an exact
entity ID (`light.hallway`) or a pattern in which `*` matches any sequence, including an empty one
(`light.*`, `*_motion`, `*`). Valid characters are `a-z`, `0-9`, `_`, `.`, and `*`; anything else
(including uppercase, since entity IDs are lowercase) is `selector_invalid`. Duplicates are
removed.

Retrieval strategy:

| Selectors            | Command                                      | Filtering in the tool                       |
| -------------------- | -------------------------------------------- | ------------------------------------------- |
| None                 | `logbook/get_events` without `entity_ids`    | None; events without entity kept            |
| Only exact IDs       | `logbook/get_events` with those `entity_ids` | Rows whose `entity_id` matches              |
| At least one pattern | `logbook/get_events` without `entity_ids`    | Rows whose `entity_id` matches any selector |

With selectors, rows without an `entity_id` are dropped (spec Clarifications). Matching is
anchored and case-sensitive. Each selector that matched no row is listed in `no_events`.

**Live check**: for the five most active entities over 24 hours, the exact-ID query and the
unfiltered query filtered in the tool returned the same 965 rows, and the exact-ID query returned
no row for any other entity.

**Known difference**: an entity excluded by the instance's YAML `logbook:` filters appears when
requested by exact ID but not through a pattern or an unfiltered query (R1). This is the
instance's own configuration; the tool description states it.

**Alternatives considered**: expanding patterns against the current state list and always sending
`entity_ids`. That would miss entities that no longer exist, which the spec requires (FR-005), and
would need an extra retrieval.

## R5. Live measurements

Aggregates from the maintainer's instance (1,175 entities, most of them continuous sensors the
logbook excludes):

| Window | Events | Raw bytes | Bytes per event | Instance time | Distinct entities | Distinct causes |
| ------ | ------ | --------- | --------------- | ------------- | ----------------- | --------------- |
| 1 h    | 98     | 20,441    | 209             | 34 ms         | 27                | 11              |
| 24 h   | 2,129  | 418,019   | 196             | 437 ms        | 154               | 51              |
| 7 d    | 15,658 | 3,119,995 | 199             | 3.3 s         | 222               | 64              |

Over 24 hours: 21% of events have a cause, 27% carry a `context_id`, 1% have no entity. Events by
domain: sensor (non-continuous) 34%, automation 25%, media player 10%, light 8%, script 6%,
binary sensor 5%, then about 16 other domains. Raw bytes by key: `entity_id` 26%, `when` 13%,
`state` 8%, `name` 7%, `context_entity_id` 6%, `message` 6%, `context_id` 6%.

The raw logbook is already compact (about 200 bytes per event, against about 1.2 KB per entity
for the registries in `ha_snapshot`), so the encoding has less repetition to remove.

## R6. Compression approach for `standard`

**Decision**: Lossless relative to a two-rule projection (data-model §5): times truncated to the
second, and `null` values treated as absent. Mechanisms:

1. **Entity table.** Each entity appears once; rows reference it by index. The events without an
   entity share one entry with a `null` ID.
2. **Per-entity constants and columns.** For each entity, keys whose value is the same in every
   row become constants in its table entry (for example an automation's `name` and `domain`); the
   remaining keys become positional columns, so key names are not repeated per row.
3. **Cause table.** Distinct combinations of the `context_*` fields are stored once, with the
   `context_` prefix removed, and referenced by index.
4. **String table.** Strings of four or more characters that occur at least twice (states,
   messages, sources, cause values) are stored once and referenced by index. Logbook values are
   strings (or the `attributes` object), so an integer in a value position is always a reference.
5. **Readable times.** Rows are grouped by local date and local hour; each row carries only
   `MM:SS`. Row order within a bucket is the recorded order, so events in the same second keep
   their order.
6. **Compact context IDs.** A `context_id` that is a ULID (26 characters, the first 10 encoding
   milliseconds) is emitted as `<offset>:<last 16 characters>`, where `offset` is its timestamp in
   milliseconds relative to the event's second. Any other value is emitted verbatim.

**Measured** on the live 24-hour and 7-day windows, with a prototype of this exact scheme:

| Scheme                                               | 24 h  | 7 d   |
| ---------------------------------------------------- | ----- | ----- |
| Entity and cause tables only, millisecond deltas     | 2.34x | 2.55x |
| + per-entity constants and string table              | 4.57x | 5.33x |
| + positional columns                                 | 5.61x | 6.94x |
| + compact context IDs                                | 5.99x | 7.52x |
| **Chosen**: readable `MM:SS` in day and hour buckets | 5.37x | 6.47x |
| Readable with milliseconds (`MM:SS.mmm`)             | 4.84x | 5.81x |
| Readable full `HH:MM:SS` per row, day buckets only   | 4.97x | 5.99x |

Short windows compress less, because the tables are a fixed cost: 1 hour 3.4x, 3 hours 4.8x,
6 hours 5.2x (millisecond-delta scheme).

**Rationale for readable times** (maintainer decision, 2026-09-26): millisecond deltas give the
best ratio, but an agent would have to add up hundreds of deltas to know when an event happened,
which models do unreliably. The question the tool exists to answer ("what happened at 3 a.m.")
needs times the agent can read directly. Sub-second precision carries no diagnostic value, and
order is preserved by row order. The spec's FR-007 now says "time to the second".

**Rationale for keeping `context_id`**: dropping it would give 6.26x (24 h), but it is the only
link between a logbook event and the automation run that produced it, which the planned `ha_trace`
tool will need.

**Hour keys** are `"HH:00"`, not `"HH"`: JavaScript orders integer-like object keys (`"10"`)
before others, which would break chronological order in any JavaScript producer or consumer.
When an hour's UTC offset differs from the document's `utc_offset` (a daylight-saving change
inside the window), its key carries the offset (`"01:00-05:00"`), so a repeated local hour is
never merged.

**Alternatives considered**:

- _Millisecond deltas_ (5.99x): unreadable, see above.
- _Omitting `context_id`_ (6.26x): see above.
- _Grouping rows by entity instead of by time_: smaller rows, but the agent loses the interleaved
  timeline, which is what reveals causality.

## R7. Compression floor and reference fixture

**Decision**: CI floor **5x** on the reference fixture, the minimum FR-018 allows.

- **Reference fixture**: a seeded generator producing a 24-hour window calibrated to R5: about
  2,100 events over about 150 entities, the measured domain mix, 21% of events with one of about
  50 causes, automation and script rows with `name`, `message`, `source`, and `context_id`, 1% of
  events without an entity, and about 200 raw bytes per event. Calibration target: the fixture's
  ratio within 5.2x to 5.6x (live: 5.37x).
- **Performance fixture**: 1,000 entities and 10,000 events in 24 hours (about five times the
  measured density), for SC-004.

**Risk**: the margin is small (the live 24-hour ratio is 7% above the floor), and a busier or
more varied instance could fall below it. The live check (SC-007) records the ratio; a live
24-hour ratio below 5 blocks release and triggers recalibration, as in `ha_snapshot`.

## R8. Size limit

**Decision**: The limit applies to the emitted `standard` document in UTF-8 bytes. Default
**100,000 bytes** (roughly 30,000 to 40,000 tokens), overridable with `DOMUSOPS_LOGBOOK_MAX_BYTES`
(a positive integer; anything else is `config_invalid`). The size is checked after encoding; an
oversized result is the error `too_large`, which states the event count, the emitted size, the
limit, and how to narrow the query. `summary` is not subject to it.

**Rationale**: at about 37 bytes per event, the default admits about 2,700 events: the
maintainer's full 24-hour logbook (about 79 KB) fits, a full week (about 490 KB) does not.
Bytes rather than tokens, because no tokenizer is canonical across MCP clients (001 R7).

**Alternatives considered**: an event-count limit (simpler, but unrelated to what fills the
context: a row with a long message costs more than a light switching on).

## R9. Timeouts

**Decision**: Connecting and authenticating 10 s and the overall deadline 30 s, as in
`ha_snapshot`. `auth/current_user` and `get_config` keep the 10 s command limit;
`logbook/get_events` may use the whole remaining overall budget, because a week-long window took
3.3 s on the maintainer's instance and a busier instance can take much longer. A timeout names
the retrieval and suggests a shorter window.

## R10. Redaction

**Decision**: Reuse the `ha_snapshot` rules (001 data-model §8) on every row, with the logbook's
identifier keys exempt: `entity_id`, `context_entity_id`, `context_user_id`, and `context_id`
(FR-013). Two value rules are added, because logbook messages are free text:

- **C2, coordinate pairs in text**: two decimal numbers with at least three decimals each,
  separated by a comma or whitespace, the first within ±90 and the second within ±180.
- **C3, configured coordinates**: any occurrence of the instance's own latitude or longitude from
  `get_config`, as the V5 rule does for the configured token. Only values written with at least
  three decimals are matched; a shorter one (for example `20.4`) would match unrelated numbers.

Both rules are added to the shared redaction module, so `ha_snapshot` gains them too: redaction
only becomes stricter. False positives (such as two temperatures written `21.500, 22.000`) are
accepted, as in 001.

## R11. Shared code

**Decision**: The error type, configuration reading, client, redaction, and ratio code are shared
between the two tools rather than copied:

- `SnapshotError` becomes a tool-neutral `ToolError`, and its text names the tool that failed
  (`ha_logbook_query failed [kind]: ...`). The `ha_snapshot` text does not change.
- The client's command allowlist gains `logbook/get_events`, and `command()` accepts parameters
  for it only. Every other command is still sent without parameters.
- The format types, JSON Schema, and reference decoder of the new format live in
  `@domusops/schema`, beside the snapshot format (constitution §5).
