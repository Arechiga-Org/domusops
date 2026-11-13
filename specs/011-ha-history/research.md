# Research: ha_history

Each entry records a decision, why it was taken, and what was rejected. The instance's behaviour
was measured on 2026-11-12 with a probe against disposable sandbox instances of 2026.10.0 and
2026.9.4 (`default_config`, virtual devices and states posted to the sandbox; no data from a real
home). Sizes were measured with a prototype of the encoding of R6 on a synthetic day of history
(R12).

## R1. The history command

- **Facts** (both releases answer the same):
  - `history/history_during_period` takes `start_time` (required), `end_time` (optional; now when
    absent), `entity_ids` (required: a call without it fails with `invalid_format`, an empty list
    answers `{}`), and four flags with these defaults: `include_start_time_state` true,
    `significant_changes_only` true, `minimal_response` false, `no_attributes` false. Any other key
    fails with `invalid_format`. An ID that is not a valid entity ID (`light`, `sensor.foo_`,
    `sensor.a__b`, `a.b.c`) fails the whole call with `invalid_entity_ids`; a valid ID that names
    nothing answers `{}` (measured during the review of #39).
  - The answer is an object from entity ID to a list of compressed states, in time order:
    `{ "s": state, "a": attributes, "lu": last_updated, "lc": last_changed }`. Times are seconds
    since the epoch with microseconds. `lc` is present only when it differs from `lu`, that is when
    the state did not change. There is no context and no `last_reported`. An entity with
    `force_update` that sets the same state again records an entry without `lc`: a state change
    to the same value.
  - An entity with no recorded state in the window is absent from the object, as is an ID that
    names no entity.
  - With `include_start_time_state`, an entity that had a state before `start_time` gets that state
    as its first entry, with `lu` set to `start_time` exactly and no `lc`: its real change times are
    not given. An entity created inside the window has no such entry; its first entry is its
    creation.
  - `significant_changes_only` drops the changes in which only attributes changed (outside a few
    domains such as `climate`). `no_attributes` answers `"a": {}` and keeps `lc`.
    `minimal_response` changes the shape of every entry after the first and is not used.
- **Decision**: a new allowlisted read, sent with every key explicit so no default of the instance
  can change the result:
  `history/history_during_period` with required `start_time`, `end_time`, `entity_ids`,
  `include_start_time_state` (always true), `significant_changes_only` (the `significant_only`
  input, false by default) and `no_attributes` (true for `summary`, false for `standard`), and no
  optional key. Its budget is `overall`, as for `logbook/get_events`, with the timeout hint "Use a
  shorter window, fewer entities, or detail=summary, then try again". The client's parameter type
  gains booleans and a string list.
- **Context**: the history gives none, so FR-010's second branch applies: the document carries no
  context, no other source is read, and the README says to find a change's cause with
  `ha_logbook_query` over the same window.
- **Why**: FR-015 asks for the history read over the WebSocket, with its parameters justified.
  Every flag is a read option; none writes.
- **Rejected**: the REST `/api/history/period` endpoint (another transport, rejected by the
  roadmap); `minimal_response` (drops attributes, which is what the tool is for).

## R2. Reads and their order

- **Decision**: on one connection, `auth/current_user` and `get_config` together, as in
  `ha_state`. The user must be an administrator, then `history` must be among the loaded
  components. `get_states` is read only when `entities` is absent or holds a pattern, to expand it
  (R3). Then one `history/history_during_period`.
- **Errors**:
  - Not an administrator: `notAdmin` gains a subject, `entity_history`, with the remediation "Use
    a token of an administrator user. Every DomusOps tool requires one, so a result never depends
    on what a restricted user may read". The other wordings do not change (FR-021).
  - History not loaded, or the command answered `unknown_command`: `historyUnavailable` gains a
    subject, `states`: kind `history_unavailable`, "The instance does not provide recorded state
    history", remediation "Enable the history and recorder integrations in Home Assistant (both are
    part of default_config), then try again". The logbook's wording does not change.
- **Why**: FR-014, FR-015. `recorder` is not checked: `history` depends on it and is not loaded
  without it, and feature 009's research lists only what a tool checks.
- **Rejected**: `config/entity_registry/list` to expand patterns: an entity without a unique ID is
  not in the registry, and FR-015 forbids registries.

## R3. Selection

- **Decision**: every input is validated before connecting. Then:
  1. Without `entities`, the candidates are the entity IDs of `get_states`. With `entities`, each
     pattern is matched against those IDs with the logbook matcher (`parseSelectors`, `matcher`)
     and each exact ID is taken as given, whether or not a current state has it, when it is a
     valid entity ID by the instance's own rule; any other exact ID is never sent (R1) and is
     named in the no-history note.
  2. `exclude` (`exclusion`) removes candidates, exact IDs included.
  3. The candidates, in entity-ID order, are the `entity_ids` of the history read. No candidate:
     no history read, an empty document and the nothing-selected note (R14).
  4. In the answer, an entity whose only entry is the start state (R1) is listed only if it was
     named by exact ID (FR-012, clarification of 2026-11-12). An exact ID absent from the answer is
     named in the no-history note.
- **Why**: the same matcher and order as the other tools, so `exclude` never hides a typo in
  `entities`; exact IDs reach an entity removed since the window (spec edge cases).

## R4. Input validation

- **Decision**:
  - `entities`, `exclude`: `parseSelectors`, the same limits and errors as the other tools.
  - `start`, `end`: `parseWindowInput` and `resolveWindow` of `logbook/window.ts`, unchanged.
  - `attributes`: 1 to 100 entries of 1 to 128 characters (code points), as in `ha_state`, with
    duplicates removed; refused with `detail=summary`.
  - `significant_only`: a boolean, default false.
  - `detail`: `summary` or `standard`.
  - Errors: `inputInvalid` gains a subject, `history`, whose remediation names the `attributes`
    limit and the summary rule; `ha_state`'s wording does not change.
- **Why**: the same rules as the neighbouring tools; the input schema advertises them.

## R5. Window

- **Decision**: `resolveWindow` gives the defaults (`end` now, `start` 24 hours before `end`), the
  clamp of a future `end`, and the order check, exactly as for the logbook. Then a window longer
  than 10 days of the instance's wall clock is refused, so a daylight-saving change inside it
  neither adds nor removes an hour, with a new `windowTooLong` error: kind `window_invalid`,
  "The time window is not valid: it is longer than 10 days", remediation "Use a window of at most
  10 days; read a longer period in several calls". The check runs after the core config is read
  (an offset-less time needs the instance's time zone) and before the history read.
- **Why**: FR-004 and clarification 2. The logbook's window has no maximum and keeps none
  (FR-021).

## R6. Document layout

- **Decision**: `entities` maps each listed entity ID, in order, to an entry:
  - `start`: `[state, attributes]` or `[state, attributes, since]`, the state at the window start
    (R1). `since` is the local time its state took effect, given when the history gives it (the
    `lc` of a change before the first state change in the window). Absent when the entity has no
    state before the window.
  - `changes`: `{ "YYYY-MM-DD": { "HH:00": [row, ...] } }`, buckets by local date and hour as in
    the logbook, the hour key gaining `±HH:MM` when its offset differs from `utc_offset`. A row is
    `["MM:SS", state, set, unset]`: `state` is given when the instance recorded a state change
    (no `lc`), even to the same value, and is `null` otherwise; `set` holds the attributes
    added or changed since the entity's previous listed entry, with their new values; `unset`
    lists the attributes removed; trailing `null` values are dropped. The first change of an
    entity without `start` carries its state and every attribute in `set`.
  - `skipped`: the number of changes the `attributes` filter left out (R9), when there are any.
- **Why**: FR-017. On the prototype, the deltas carry almost all of the gain (R12): the full
  attribute set appears once per entity, and a sensor change becomes `["MM:SS","21.4"]`.
- **Rejected**:
  - The snapshot's templates for the start states: one start state per entity, so the repetition
    they remove is small next to the changes.
  - A string table as in the logbook: states and attribute values within one entity's deltas
    rarely repeat long strings.
  - Attribute keys go into plain objects; like `ha_state`, a key `__proto__` is lost (issue #38),
    which this feature does not fix.

## R7. Times

- **Decision**: a change's time is its `lu`, truncated to the second, in local time, split into
  its bucket and `MM:SS`. Changes keep the instance's order within a second (clarification 4). `lc`
  is not emitted: within the window it is the time of the latest change whose state changed, and
  before that it is `since`. `window` gives the resolved start and end as local ISO 8601 to the
  second; `utc_offset` is the offset at the window start.
- **Why**: FR-008, the logbook's form. The decoder restores `last_changed` from the sequence
  (R13).

## R8. Redaction

- **Decision**: every entry is turned into `{ entity_id, state, attributes }` and redacted with
  `redactRows(rows, { token, exemptKeys: EXEMPT_KEYS, coordinates })`, the rules `ha_state` and
  `ha_snapshot` apply, before the deltas are computed. A redacted value that changes (a moving
  phone's coordinates) is therefore equal from one entry to the next and is not repeated.
- **Why**: FR-009; one set of rules for the same values in three tools.

## R9. Attribute filter

- **Decision**: after redaction, every entry keeps only the listed attributes. A change is listed
  only when its state or a kept attribute differs from the entity's previous listed entry (the
  start, or the last listed change); the rest are counted in `skipped`. The start is always
  listed.
- **Why**: clarification 3, FR-006. Comparing with the previous listed entry, not the previous
  raw one, keeps every visible change when several in a row are left out.

## R10. Size limit

- **Decision**: `DOMUSOPS_HISTORY_MAX_BYTES`, default 100,000, read with the shared `readLimit`. A
  larger `standard` result, or a `summary` with `entities` whose rows per entity exceed it, is
  refused with `tooLargeHistory(entities, changes, bytes, limit, detail)`: kind `too_large`, "The
  result has E entities and C changes and would be B bytes, above the limit of L bytes". The
  remediation for `standard`: "Use detail=summary to see which entities are busy, or narrow the
  query with a shorter window, fewer entities, exclude, or attributes; to allow larger results,
  raise DOMUSOPS_HISTORY_MAX_BYTES". For `summary`: "Leave out entities to get the counts per
  domain, or narrow the query with fewer entities or exclude; to allow larger results, raise
  DOMUSOPS_HISTORY_MAX_BYTES".
- **Why**: FR-011, FR-013, the logbook's contract. A noisy sensor reporting every 10 seconds
  encodes to about 146 KB a day on the prototype, so a single entity can be refused (spec edge
  cases).

## R11. Summary

- **Decision**: the history is read with `no_attributes`: the counts need only the states and
  `lc`. An entry other than the start is a change; it is a state change when it has no `lc`, and
  attribute-only otherwise. The document gives `counts: { entities, changes, state_changes,
attribute_only }`, `by_domain: { <domain>: [entities, changes, state_changes, attribute_only] }`
  for the domains with a change, in name order, and, only when the call has `entities`,
  `by_entity: { <id>: [changes, state_changes, attribute_only] }` for the entities with a change.
- **Bound**: without `entities` there are no rows per entity. A row per domain is about 35
  bytes, and a home has a few dozen entity domains; a test builds 100 domains and asserts the
  document stays under 4,000 bytes (FR-013). The envelope's `selectors` and `attributes` are absent
  without `entities` and with `summary`.
- **Why**: clarification 2; reading without attributes makes the whole-home summary cheap for
  the instance too.

## R12. Compression ratio and its floor

- **Facts**: the prototype on a synthetic day: a temperature sensor every minute 9.7, a power
  sensor every 10 seconds 8.5, a phone tracker 6.0, a binary sensor 5.2, a light 4.6; all five
  together 8.5. The raw history repeats every attribute in every entry; the document does not.
- **Decision**: `rawBytes` is the UTF-8 size of the history answer as received for the listed
  entities. CI asserts a floor of 5 for `standard` on the reference fixture (`generate-history.ts`,
  R16) as a whole and on its noisiest sensor, the entity SC-002 names. The sandbox test asserts the
  ratio is reported and above 1; the bound is measured on each release before the container test
  is written, as for `ha_state`.
- **Measured** (T035, 2026-11-12): on the reference fixture the implementation gives 8.30 for the
  whole day, 8.50 for the power sensor, 9.59 for the temperature sensors, 6.08 for the binary
  sensors, 5.39 for the lights and 4.25 for the phone. On a `default_config` sandbox of 2026.10.0
  with a virtual light switched three times in an eight-second window, an unfiltered `standard`
  call gives 7.32 (the start states of the unchanged entities are read but not listed), an
  unfiltered `summary` 4.87, and a `standard` call for the light and one switch 0.96: the envelope
  outweighs four raw entries. The container test asserts above 1 on the unfiltered call. The same
  probe confirmed the simulated instance of R16: the start state's `lu` equals the window start
  to the millisecond, a state change has no `lc`, an unknown ID is absent, and `no_attributes`
  keeps `lc`.
- **Why**: §4 has no exemption; 5 leaves room under the prototype's 8.5 without hiding a
  regression, and equals the logbook's floor.

## R13. Decoder

- **Decision**: `expandHistory(document)` in `@domusops/schema` returns, in entity-ID order, each
  entity's entries: `{ entity_id, start, state, attributes, last_updated, last_changed }`, where
  `start` is true for the start state. Times are local ISO 8601 with their offset. `last_updated`
  of the start is the window start; `last_changed` of the start is `since` or `null`. A change's
  `last_changed` is its own time when its state changed, otherwise the previous entry's.
  Attributes are rebuilt by applying `set` and `unset` to the previous entry's.
- **Why**: FR-017. The round-trip test compares the decoder's output with the redacted, filtered
  input, times compared to the second.

## R14. Notes

- **Decision**: after the document, in this order:
  1. The exclusion note, the existing `exclusionNote`.
  2. No history: "Note: no recorded history for the ID <ids>." At most 10 IDs, then "and N
     more".
  3. Nothing selected: the existing "Note: no entity matched the query.", when no candidate was
     left (R3).
  4. Nothing changed: "Note: no selected entity changed in the window.", when there were
     candidates but nothing is listed.
- **Why**: FR-012; the document stays first and unchanged.

## R15. ha_ping

- **Decision**: `REQUIREMENTS` gains `ha_history: { admin: true, integrations: ["history"] }`,
  and the tool registers after `ha_state` and before `ha_ping`.
- **Why**: FR-019; `tool.test.ts` fails without the row.

## R16. Test instance

- **Decision**:
  - `packages/mcp/test/fixtures/generate-history.ts`: a deterministic synthetic history,
    calibrated to the prototype's mix (minute and ten-second sensors, a phone tracker with
    coordinates and battery, lights with attribute changes, binary sensors), every name generated
    from the seed.
  - The simulated instance (`test/support/fake-ha.ts`) answers `history/history_during_period`
    from such a history as R1 records: the window, `entity_ids`, the start state with `lu` set to
    the start, `significant_changes_only`, `no_attributes`, `lc` only when the state did not
    change, absent entities left out, and `invalid_format` for a missing `entity_ids` or an
    unknown key.
- **Why**: SC-001 and SC-002 need a known history; the fake follows the measured behaviour, and
  the sandbox test (§8) checks it against the real releases.

## R17. Release

- **Decision**: minor changesets for `@domusops/mcp` and `@domusops/schema`. The Version Packages
  pull request (#36) updates itself and stays unmerged until feature 012 merges.
