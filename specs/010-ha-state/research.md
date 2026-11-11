# Research: ha_state

Each entry records a decision, why it was taken, and what was rejected. Sizes were measured on
2026-11-11 with a prototype of the encoding (templates per domain, local times, compact context
IDs, redaction) on the reference fixture `REFERENCE_500` of `packages/mcp/test/fixtures/generate.ts`
(493 states in 12 domains).

## R1. What the tool reads

- **Facts**:
  - `get_states` answers with every state object of the instance: `entity_id`, `state`,
    `attributes`, `last_changed`, `last_updated`, `last_reported` and `context` (`id`,
    `parent_id`, `user_id`). It takes no filter.
  - A user who is not an administrator can receive a filtered set of states, which is why
    `ha_snapshot` refuses one (`retrieve.ts`).
  - `auth/current_user`, `get_config` and `get_states` are already on the client's allowlist.
- **Decision**: on one connection, `readCurrentUser` (refusing a user who is not an
  administrator), then `get_config` and `get_states` together. From `get_config` the tool keeps
  the time zone and the instance's coordinates (for redaction rule C3) through `readCore`.
  Selection is local.
- **Why**: the only read that answers FR-006; no new command (FR-016). `readCore` and
  `readCurrentUser` are the helpers feature 009 split out.
- **Rejected**: `readInstance`, whose refusal (`notAdmin("history")`) speaks of the logbook and
  traces. The refusal gets a third subject, `states`, with its own remediation; the other two
  wordings do not change (FR-022). Also rejected: the REST `/api/states/<id>` endpoint (another
  transport, one request per entity).

## R2. Selection

- **Decision**: every input is validated before connecting. The states are then filtered in
  this order: `entities` (the logbook matcher, `parseSelectors` and `matcher`), `domain`,
  `state`, then `exclude` (`exclusion`). `attributes` then trims each selected entity's
  attributes and never changes which entities are selected (FR-006).
- **Not found**: an exact ID in `entities` that names no state and is not itself excluded is
  reported in a note (FR-013). A pattern that matches nothing is not reported by name: the note
  for an empty result covers it.
- **Why**: the same order and rules as `ha_logbook_query` and `ha_trace` (feature 008 research
  R3), so `exclude` never hides a typo in `entities`.

## R3. Input validation

- **Decision**:
  - `entities` and `exclude`: `parseSelectors`, with the same limits and `selector_invalid`
    errors as the other tools.
  - `domain`: 1 to 100 entries, each 1 to 64 characters of `[a-z0-9_]`.
  - `state`: 1 to 100 entries, each 1 to 255 characters (the instance's own limit for a state).
  - `attributes`: 1 to 100 entries, each 1 to 128 characters.
  - `detail`: `summary` or `standard`.
  - `attributes` with `detail=summary` is refused.
  - Duplicates are removed, keeping the first.
- **Errors**: a problem with `domain`, `state` or `attributes`, or the combination, is a new
  error kind, `input_invalid`, whose remediation names the limits. `selection_invalid` is not
  reused: its remediation is about `ha_trace`'s `run` and `context`.
- **Why**: the input schema advertises the same limits, so a client sees them before calling;
  the runtime check covers direct callers of `runState`, as `parseSelectors` does today.

## R4. Document layout

- **Decision**: a templated document, grouped by domain: `entities` maps each domain to a
  groups object built with the snapshot's `TemplateBook`. Each record's head is
  `[object_id, state]`. Its fields are the attributes, keys escaped with the snapshot's
  `escapeKey`, plus `st.last_changed`, `st.last_updated`, `st.last_reported`, `st.context`,
  `st.parent_id` and `st.user_id`, prefixed with `STATE_PREFIX` as the snapshot's `full` level
  does. Repeated attribute sets become template constants (FR-018).
- **Why**: it is the encoding the project already ships, decodes and tests, and its key space
  already separates state fields from attributes. In the measurement, templates per domain hold
  37 constant-heavy shapes for 493 entities.
- **Rejected**:
  - One plain object per entity: ratio 1.3 on the fixture, below any useful floor.
  - The logbook's string table and positional events: designed for a time series, not for one
    record per entity.

## R5. Times

- **Decision**: every time is local ISO 8601 to the second, `formatLocalIso`. The offset is
  left out when it equals the document's `utc_offset`, which is the offset at the `anchor`.
  `anchor` is the latest `last_updated` of the selected entities, truncated to the second, or
  the call time when nothing is selected. `st.last_updated` is left out (default `null`, meaning
  "equal to `last_changed`") when it equals `last_changed`. `st.last_reported` is left out when
  it equals `last_updated` or the instance does not give it.
- **Why**: FR-008 asks for the logbook's form; agents read the times as they are. The defaults
  remove most of the third time on a real instance, where most states have equal times.
- **Precision**: sub-second digits are dropped, the only change besides redaction (FR-018
  covers the state and attributes, which stay exact).
- **Measured**: times are the largest part of the document. On the fixture, which gives every
  entity three distinct times (its worst case), they are 47% of the encoded bytes.

## R6. Context

- **Decision**: `st.context` and `st.parent_id` are compact context IDs, `encodeContextId(id,
anchorMs)`. `st.user_id` is the user ID as the instance gives it. `parent_id` and `user_id` are
  left out when null (default `null`).
- **Why**: `ha_trace` and `ha_logbook_query` accept a compact ID in their `context` input and
  match on its last 16 characters (feature 003 research R8), so FR-009 holds without a full
  26-character ID. The decoder restores the full ID from the anchor.

## R7. Redaction

- **Decision**: the selected states are redacted whole with
  `redactRows(states, { token, exemptKeys: EXEMPT_KEYS, coordinates })`. Those are the rules and
  exempt keys `ha_snapshot` applies to the same state objects, the instance's coordinates
  included (FR-010). The raw size is measured before redaction. Names are not redacted
  (clarification 1, FR-011): no rule targets them today, and none is added.
- **Why**: one set of rules for the same data in two tools; the snapshot's redaction tests and
  oracle already cover state objects.

## R8. Size limit

- **Decision**: `DOMUSOPS_STATE_MAX_BYTES`, default 100,000, read with the shared `readLimit`. It
  applies to `standard` only. A larger result is refused with a new `too_large` error: "The
  result has N entities and would be B bytes, above the limit of L bytes". The remediation is
  "Use detail=summary to see where the entities are, or narrow the query with entities, domain,
  state, exclude, or attributes; to allow larger results, raise DOMUSOPS_STATE_MAX_BYTES"
  (clarification 2, FR-012).
- **Why**: the same contract as the logbook. `summary`, the call the remediation suggests, never
  fails on the limit.
- **Measured**: the whole fixture encodes to 93 KB, under the limit. A 3,000-entity home (six
  times the fixture) encodes to 417 KB and is refused, as intended.

## R9. Summary

- **Decision**: `counts: { entities, domains }` and
  `by_domain: { <domain>: [entities, unavailable, unknown] }`, domains in name order, plus the
  envelope. There are no attributes and no times besides the envelope's.
- **Why**: "where is something broken" in one call (User Story 3). A row is about 25 bytes. A
  home has a few dozen entity domains, so the document stays far under 4,000 bytes (FR-014). A
  test builds 120 domains and asserts the bound.

## R10. Compression ratio and its floor

- **Facts**: on the fixture, the prototype gives 2.35 for every entity, 2.39 for `sensor.*`,
  2.88 for `light.*` and 2.23 for `binary_sensor.*`. A single entity gives 0.84: the envelope is
  larger than one raw state.
- **Decision**: `rawBytes` is the UTF-8 size of the selected state objects as received, before
  redaction and before `attributes` trims them (the answer the tool read for those entities).
  CI asserts a floor of 2 for `standard` on the whole fixture. The sandbox test asserts the ratio
  is reported and above 1 on each release's full instance.
- **Why**: §4 has no exemption. The fixture is the worst case for times, which readable local
  form makes costly, and 2 leaves room for the implementation without hiding a regression. The
  floor is lower than the logbook's 5 and the trace's 3 because a state is already a compact
  record; there is no repeated event stream to fold.

## R11. Decoder

- **Decision**: `expandState(document)` in `@domusops/schema`. It returns the records the
  document represents, in entity-ID order: `entity_id`, `state`, `attributes`, `last_changed`,
  `last_updated`, `last_reported` (when present), and `context: { id, parent_id, user_id }`.
  Times are local ISO 8601 with their offset, and context IDs are full. It reuses the
  snapshot's `decodeGroups` and `unescapeKey`, exported from their module but not from the
  package index.
- **Why**: FR-018 asks for a reference decoder when the document is templated. The round-trip
  test compares it with the redacted input, times compared to the second.

## R12. ha_ping

- **Decision**: `REQUIREMENTS` gains `ha_state: { admin: true, integrations: [] }`, and the tool
  registers after `ha_trace` and before `ha_ping`. The ping document of a healthy instance grows
  by one entry (about 25 bytes). Feature 009's worst-case size test already counts six tools.
- **Why**: feature 009 FR-019; the table test fails otherwise.

## R13. Notes

- **Decision**: three notes after the document, in this order:
  1. The exclusion note, the existing `exclusionNote`.
  2. Not found: "Note: no entity has the ID <ids>." At most 10 IDs, then "and N more".
  3. Nothing selected: "Note: no entity matched the query." Sent when the result is empty,
     after note 2 if there is one.
- **Why**: FR-013; the document stays first and unchanged (feature 008).

## R14. Release

- **Decision**: minor changesets for `@domusops/mcp` and `@domusops/schema`. The open Version
  Packages pull request (#36) updates itself and stays unmerged until features 011 and 012 merge.
