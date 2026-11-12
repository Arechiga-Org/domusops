---
description: "Task list for ha_history (feature 011, third tool of 0.2.0)"
---

# Tasks: ha_history

**Input**: Design documents from `/specs/011-ha-history/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R17), data-model.md, contracts/ (ha_history.tool.json, history-format.md), quickstart.md

**Tests**: Included. Tests are written first and seen to fail. Unit tests run in the default `pnpm test`; container tests run with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: User Stories 1 and 2 share every file (selection, encoding, limit) and User Story 3 is small, so the feature is one branch (`011-ha-history`) and one pull request (plan, Delivery). Spec, plan and tasks are committed first; the implementation follows in atomic commits.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 or US3, from spec.md
- All paths are relative to the repository root. Everything written to the repository is English (constitution §1), and no example, fixture or test contains data from a real home (FR-023).
- The last tasks are always the same: run the gate (`pnpm lint && pnpm typecheck && pnpm test`), Prettier on only the touched files (never `tasks.md`), and then ask the maintainer before any commit, push or pull request. The maintainer merges. `/code-review` runs after the pull request and its findings are triaged before anything is pushed.
- The feature adds a minor changeset for `@domusops/mcp` and one for `@domusops/schema` (FR-022). The Version Packages pull request (#36) stays unmerged until feature 012 merges (research R17).
- Existing helpers are reused as they are, not copied: `parseSelectors`, `matcher`, `exclusion` (`packages/mcp/src/logbook/selectors.ts`), `parseWindowInput` and `resolveWindow` (`packages/mcp/src/logbook/window.ts`), `localParts`, `formatOffset` and `formatLocalIso` (`packages/mcp/src/logbook/local-time.ts`), `redactRows` and `EXEMPT_KEYS` (`packages/mcp/src/snapshot/redact.ts`), `finalize`, `byteLength` and `measureRowsBytes` (`packages/mcp/src/snapshot/ratio.ts`), `readCurrentUser` and `readCore` (`packages/mcp/src/ha/instance.ts`), `readStates` (`packages/mcp/src/ha/states.ts`), `MAX_ENTRIES`, `MAX_ATTRIBUTE_LENGTH` and `characterCount` (`packages/mcp/src/state/inputs.ts`), `exclusionNote`, `nothingMatchedNote` and `MAX_NOTE_ITEMS` (`packages/mcp/src/notes.ts`), and `Rng` (`packages/mcp/test/fixtures/generate.ts`).
- Every error wording the existing tools use stays byte-identical; new wordings come from new subjects or new functions (FR-021, research R2, R4, R5, R10).

---

## Phase 1: Setup

- [ ] T001 Run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` on the branch before any code and record that the baseline is green (constitution §2)

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the published format and its decoder, the new read, the limit, the errors, the notes and the simulated history that every story uses.

- [ ] T002 [P] Create `packages/mcp/test/history-json-schema.test.ts`: `HISTORY_FORMAT` is `domusops.history/0.1`; `historyJsonSchema` accepts the standard, filtered and summary examples of `specs/011-ha-history/contracts/history-format.md`; it rejects a document without `format`, a `detail` other than `summary` or `standard`, a `utc_offset` not of the form `±HH:MM`, a `window` without `start` or `end`, a `standard` document without `entities`, an entity entry with an unknown key, a `start` that is not `[string, object]` or `[string, object, string]`, a bucket date not `YYYY-MM-DD`, an hour key not `HH:00` or `HH:00±HH:MM`, a row whose first item is not `MM:SS` or that has more than four items, a `skipped` below 1, a summary without `counts` or `by_domain`, a `by_domain` row that is not four non-negative integers, a `by_entity` row that is not three, and a summary with `attributes`
- [ ] T003 In `packages/schema/src/history/format.ts`, add `HISTORY_FORMAT`, `HISTORY_DETAIL_LEVELS` and the types `HistoryEnvelope`, `HistoryStandardDocument`, `HistoryEntityEntry`, `HistoryRow`, `HistorySummaryDocument`, `HistoryDocument` and `HistoryRecord`, with the keys and order of data-model §2 to §4 and §6 (envelope: `format`, `detail`, `ha_version`, `compression_ratio`, `time_zone`, `utc_offset`, `window`, then optional `selectors`, `attributes`, `significant_only`; the summary envelope omits `attributes`); in `packages/schema/src/history/json-schema.ts`, add `historyJsonSchema`; export both modules from `packages/schema/src/index.ts` (R13). Make T002 pass
- [ ] T004 [P] Create `packages/schema/test/history-expand.test.ts` with hand-built documents: entities come in entity-ID order; a `start` decodes to `start: true`, the window start as `last_updated`, and `since` (offset added when absent) or `null` as `last_changed`; a row with a `null` or absent state carries the previous state forward and keeps the previous `last_changed`; a row with a state takes its own time as `last_changed`; `set` adds and replaces attributes, `unset` removes them, and the previous entry's attributes are never mutated; an entity without `start` decodes its first row as a full entry; times rebuild from date, hour and `MM:SS`, with `utc_offset` or the hour key's own offset across a daylight-saving change; two rows in the same second keep their order; a summary document is refused with an error that names `detail=standard`; the decoded entries of `contracts/history-format.md`'s standard example match the values its text states
- [ ] T005 Create `packages/schema/src/history/expand.ts` with `expandHistory(document: HistoryStandardDocument): { entity_id: string; entries: HistoryRecord[] }[]` as data-model §6 and research R13, building attribute objects without a prototype so no key is lost; export it from the index. Make T004 pass. The existing `expand`, `expandLogbook`, `expandTrace` and `expandState` tests pass unedited
- [ ] T006 [P] In `packages/schema/README.md`, add the format's row to the Formats table (detail levels `summary` and `standard`; decoder `expandHistory` for `standard`) and `HISTORY_FORMAT`, the `History*` types, `historyJsonSchema` and `expandHistory` to the exports list
- [ ] T007 [P] In `packages/mcp/test/config.test.ts`, add cases for `DOMUSOPS_HISTORY_MAX_BYTES`: absent gives 100000; a valid value is used; an invalid one is a `config_invalid` error naming the variable; then in `packages/mcp/src/ha/config.ts` add `HISTORY_LIMIT_VARIABLE`, `DEFAULT_HISTORY_LIMIT = 100_000` and `readHistoryLimit` through the shared `readLimit` (R10)
- [ ] T008 [P] In `packages/mcp/src/errors.ts`, with cases in a new `packages/mcp/test/history-errors.test.ts`: widen `notAdmin` to the subject `"entity_history"` with the remediation "Use a token of an administrator user. Every DomusOps tool requires one, so a result never depends on what a restricted user may read"; give `historyUnavailable` a subject, default `"logbook"` (today's wording, byte-identical), and `"states"` with the cause "The instance does not provide recorded state history" and the remediation "Enable the history and recorder integrations in Home Assistant (both are part of default_config), then try again"; give `inputInvalid` a subject, default `"state"` (today's wording), and `"history"` whose remediation is "Give attributes as 1 to 100 entries of 1 to 128 characters, and only with detail=standard"; add `windowTooLong()` (kind `window_invalid`, "The time window is not valid: it is longer than 10 days", "Use a window of at most 10 days; read a longer period in several calls"); add `tooLargeHistory(entities, changes, bytes, limit, detail)` with the cause and the two remediations of R10 (R2, R4, R5, R10). `packages/mcp/test/logbook-errors.test.ts`, `packages/mcp/test/trace-errors.test.ts` and the `ha_state` error cases pass unedited
- [ ] T009 [P] In `packages/mcp/test/response-notes.test.ts`, add cases, then in `packages/mcp/src/notes.ts` add `noHistoryNote(ids)` — "Note: no recorded history for the ID <ids>." with the IDs comma-separated, at most `MAX_NOTE_ITEMS` (10), then "and N more" — and `nothingChangedNote()` — "Note: no selected entity changed in the window." (R14)
- [ ] T010 [P] In `packages/mcp/test/client.test.ts`, add cases, then in `packages/mcp/src/ha/client.ts` add `history/history_during_period` to `COMMANDS` with required `start_time`, `end_time`, `entity_ids`, `include_start_time_state`, `significant_changes_only` and `no_attributes`, no optional key, budget `overall` and the timeout hint "Use a shorter window, fewer entities, or detail=summary, then try again"; add `HistoryParams` (`start_time` and `end_time` strings, `entity_ids` a string list, the three flags booleans) to `CommandParams`. The client refuses the command with a missing or an extra key before it reaches the socket, and a timeout uses the overall limit with the hint (R1)
- [ ] T011 [P] Create `packages/mcp/test/fixtures/generate-history.ts`: a deterministic generator of a raw `history/history_during_period` answer over a 24-hour window ending at a fixed past instant with no daylight-saving change in `Europe/Madrid`, calibrated to research R12 and R16 (a sensor every minute, a power sensor every 10 seconds, a phone tracker with battery, accuracy and coordinates, lights whose brightness and color temperature change with and without a state change, binary sensors, an entity created inside the window, an entity with no change), every name generated from the seed, with a header comment that states the calibration; export `REFERENCE_HISTORY` and the window. In `packages/mcp/test/support/fake-ha.ts`, add a `history` option and answer `history/history_during_period` as research R1 records: entries in the window for the listed `entity_ids`, the start state with `lu` set to `start_time` and no `lc`, `lc` only when the state did not change, attribute-only entries dropped when `significant_changes_only` is true, `"a": {}` with `no_attributes`, absent entities left out, `invalid_format` for a missing `entity_ids` or an unknown key, `unknown_command` when the option is `false`; record the parameters of every history call received
- [ ] T012 Create `packages/mcp/src/ha/history.ts`: `readHistory(client, params)` sends the command, maps `unknown_command` to `historyUnavailable("states")`, and validates the answer as an object of entity ID to an array of entries with a string `s`, an object `a`, a numeric `lu` and an optional numeric `lc`, any other shape a protocol error and no rows (R1, R2)

**Checkpoint**: the format, its JSON Schema and its decoder are published in the workspace; the read, the limit, the errors, the notes and the simulated history exist.

---

## Phase 3: User Story 1 — Following an entity's changes through a window (Priority: P1) 🎯 MVP

**Goal**: `ha_history` with `entities`, `start`, `end` and `significant_only` returns each listed entity's start state and every recorded change, with states, attributes and times, redacted, deterministic, from one history read on one connection (spec FR-001, FR-002, FR-004, FR-005, FR-007 to FR-010, FR-012, FR-014 to FR-017, FR-019).

**Independent Test**: `packages/mcp/test/history.test.ts`, `history-encode.test.ts`, `history-roundtrip.test.ts` and `history-redaction.test.ts` (quickstart §1 and §2).

### Tests for User Story 1 (write first, see them fail)

- [ ] T013 [US1] Create `packages/mcp/test/history.test.ts` against the fake instance with a small synthetic history: named entities over a window return each one's start state and every change, attribute-only ones included, in time order (SC-001); `unavailable` and `unknown` states are listed as changes like any other; a pattern is expanded against `get_states` and an exact ID is sent as given, even one with no current state; without `entities` every current entity is a candidate; an entity named by exact ID that did not change is listed with its start state only, and one matched by a pattern is left out (data-model §5); an exact ID with no recorded history is named in the no-history note; no candidate gives an empty document and the nothing-matched note, with no history read; candidates with no change give an empty `entities` and the nothing-changed note; `significant_only: true` sends `significant_changes_only: true`; the default window is the 24 hours before now, an offset-less time is read in the instance's time zone, a future `end` is clamped, and `start` after `end` is `window_invalid` (FR-004); the fake instance saw one connection and, after the handshake, exactly `auth/current_user`, `get_config`, `get_states` only when a pattern or no `entities` was given, and one `history/history_during_period` with every flag explicit and `include_start_time_state: true` (FR-015, R1); a user with `is_admin: false` gets `not_admin` with the `entity_history` wording and no history is read; without `history` in the components, or with the command unknown, `history_unavailable` with the `states` wording (FR-014); an invalid `entities` gives `selector_invalid` and no connection; `config_missing`, `auth_invalid`, `unreachable`, a stalled history read (`timeout` with its hint) and an instance below `MIN_VERSION` give the existing kinds; a malformed history answer gives `protocol_error` and no document; the document carries no context key (FR-010); two calls over a past window give byte-identical text (SC-005); every document is valid against `historyJsonSchema`; the outputs of the other tools on the same instance are untouched (FR-021)
- [ ] T014 [P] [US1] Create `packages/mcp/test/history-encode.test.ts` for the standard encoding on hand-built entries: the envelope's keys and order (data-model §2), `window` to the second, `utc_offset` the offset at the window start; entities in ID order; `start` as `[state, attributes]`, and with `since` when a change before the first state change gives `lc`; changes bucketed by local date and hour, `MM:SS` truncated, the hour key with an offset across a daylight-saving change; a row's state `null` when unchanged, `set` with added and changed attributes, `unset` with removed names in order, trailing `null` dropped, `["MM:SS"]` when nothing visible changed; the first change of an entity without `start` carries the state and every attribute; changes in the same second keep their order (FR-008); an attribute named `__proto__` or `constructor` in `set` is encoded like any other; on `REFERENCE_HISTORY`, `compression_ratio` is at least 5 for the whole fixture and for its ten-second power sensor (FR-018, SC-002, R12)
- [ ] T015 [P] [US1] Create `packages/mcp/test/history-roundtrip.test.ts`: for `REFERENCE_HISTORY` and selections of it (one sensor, the phone, the lights, an entity created in the window, an unchanged entity named by exact ID), `expandHistory(encode(redact(entries)))` gives every entry with its state, its full redacted attributes, `last_updated` to the second and `last_changed` as data-model §6, in local form (FR-017, SC-002)
- [ ] T016 [P] [US1] Create `packages/mcp/test/history-redaction.test.ts` with a synthetic history that seeds every redaction rule into attributes across many changes (a secret-looking key, a token-like value, the configured token, an e-mail address, the instance's coordinates and other coordinates, a URL with credentials, nested at several depths): none of them appear in the text, a moving tracker's coordinates are redacted and not repeated, and person names and `friendly_name` values remain (FR-009, SC-004, R8)
- [ ] T017 [P] [US1] In `packages/mcp/test/tool.test.ts`, add that `ha_history` is listed between `ha_state` and `ha_ping` with the title, description, input schema and annotations of `specs/011-ha-history/contracts/ha_history.tool.json` (`readOnlyHint` true, `destructiveHint` false, `idempotentHint` true, `openWorldHint` true), and that a call returns the document then the notes as text blocks; the existing check that the requirements table names every registered tool except `ha_ping` now covers `ha_history` (FR-001, FR-016, FR-019)

### Implementation for User Story 1

- [ ] T018 [P] [US1] Create `packages/mcp/src/history/select.ts`: `candidates(stateIds, selectors)` gives, in entity-ID order, the current IDs that match a pattern plus the exact IDs as given (every current ID without selectors), and records which IDs were named exactly; `listed(answer, exact, windowStartMs)` applies the listing rule of research R3 and data-model §5 and returns the exact IDs with no recorded history
- [ ] T019 [P] [US1] Create `packages/mcp/src/history/entries.ts`: per entity, detect the start state (first entry whose `lu` equals the window start at the millisecond), take `since` from the `lc` of a change before the first state change, and redact every entry as `{ entity_id, state, attributes }` with `redactRows(rows, { token, exemptKeys: EXEMPT_KEYS, coordinates })` before any comparison (R8)
- [ ] T020 [P] [US1] Create `packages/mcp/src/history/envelope.ts`: `historyEnvelope({ detail, haVersion, timeZone, window, selectors, attributes, significantOnly })` builds the envelope of data-model §2 in that key order, `utc_offset` the offset at the window start, optional keys only when given
- [ ] T020a [P] [US1] Create `packages/mcp/src/history/inputs.ts`: `parseHistoryInputs(input)` validates `significant_only` (a boolean, default false) and `detail` (`summary` or `standard`, default `standard`) (R4)
- [ ] T021 [US1] Create `packages/mcp/src/history/encode-standard.ts`: `encodeStandardHistory(envelope, entities, timeZone)` builds `entities` with `start`, the date and hour buckets and the delta rows of data-model §3, comparing each entry with the entity's previous listed entry, values compared by their canonical JSON. Make T014 and T015 pass
- [ ] T022 [US1] Create `packages/mcp/src/tools/ha-history.ts`: `runHistory(env, options)` and `queryHistory(env, options)`: validate `entities`, `start` and `end`, and parse the rest with `parseHistoryInputs`, before connecting; read the configuration and `readHistoryLimit`; connect once; read the user and the core config together, refuse a non-administrator with `notAdmin("entity_history")` and a missing `history` component with `historyUnavailable("states")`; resolve the window; read `get_states` only when a pattern or no `entities` was given; read the history of the candidates with `include_start_time_state: true`, `significant_changes_only` from the input and `no_attributes: false`; measure `rawBytes` as the answer for the candidates as received (R12); list, redact, encode, `finalize`; return the document with the notes of R14 in order. Make T013 and T016 pass
- [ ] T023 [P] [US1] In `packages/mcp/src/ping/requirements.ts`, add `ha_history: { admin: true, integrations: ["history"] }` after `ha_state` (R15, FR-019)
- [ ] T024 [US1] In `packages/mcp/src/server.ts`, register `ha_history` after `ha_state` and before `ha_ping`, with the title, description, input schema (zod with every limit of the contract: `entities` and `exclude` 1 to 100 items, `start` and `end` strings, `attributes` items 1 to 128 characters counted with `characterCount`, 1 to 100 items, `significant_only` a boolean, `detail` `summary` or `standard`) and annotations copied from `specs/011-ha-history/contracts/ha_history.tool.json`, with a "Copied from specs/011-ha-history/contracts/…" comment like the other tools, through `asToolResult("ha_history", …)`. Make T017 pass
- [ ] T025 [US1] In `packages/mcp/test/ping.test.ts`, update the healthy-document expectation so `tools` lists `ha_history` ready (the FR-021 exception), and add that it is not ready when `history` is not loaded; in `packages/mcp/test/cli.test.ts`, add `ha_history` to the expected tool list
- [ ] T026 [US1] In `packages/mcp/README.md`, add the `ha_history` section (what it reads, the inputs, the window and its maximum, the listing rule, the document, the limit and `DOMUSOPS_HISTORY_MAX_BYTES`, the notes, the errors, that the instance's retention bounds history, and that a change's cause is found with `ha_logbook_query` over the same window, FR-010) and its row in the decoder table of "Reading responses" (`expandHistory` for `standard`; `summary` is read as it is); in `packages/mcp/test/readme.test.ts`, run the tested decoding example on a history document
- [ ] T027 [P] [US1] Add `.changeset/mcp-ha-history.md` (`@domusops/mcp` minor: the `ha_history` tool) and `.changeset/schema-history-format.md` (`@domusops/schema` minor: the `domusops.history/0.1` format, its types, JSON Schema and `expandHistory`)

**Checkpoint**: chosen entities' history can be read; the tool is registered, listed by `ha_ping` and documented.

---

## Phase 4: User Story 2 — Keeping a long or broad history within bounds (Priority: P1)

**Goal**: `exclude`, `attributes`, the 10-day maximum window and the size limit keep a result bounded, and an oversize query is refused with the entity and change counts and how to narrow it (spec FR-003, FR-004, FR-006, FR-011).

**Independent Test**: the narrowing and limit cases of `packages/mcp/test/history.test.ts` and `history-encode.test.ts` (quickstart §2).

### Tests for User Story 2 (write first, see them fail)

- [ ] T028 [US2] In `packages/mcp/test/history.test.ts`, add cases: `exclude` removes candidates after `entities`, exact IDs included, the exclusion note comes first, and excluded IDs are not sent in `entity_ids`; an exact ID that is itself excluded is not named in the no-history note; `attributes` keeps only the named attributes, a change in which neither the state nor a named attribute changed is left out and counted in `skipped`, a name no entity has is not an error, and the envelope echoes `attributes` as parsed with duplicates removed keeping the first (FR-006, R9); validation before any connection, each an `input_invalid` error with the `history` wording: `attributes` empty, over 100 entries, an entry empty or over 128 characters, and `attributes` with `detail: "summary"`; a window of exactly 10 days is read, and one a second longer is `window_invalid` with the `windowTooLong` wording and no history is read (FR-004); with `DOMUSOPS_HISTORY_MAX_BYTES` set low, a `standard` result above it is a `too_large` error whose text holds the entity count, the change count, the byte size and the limit, and no entity ID (SC-003); the same query with `detail: "summary"` succeeds
- [ ] T029 [P] [US2] In `packages/mcp/test/history-encode.test.ts`, add that with `attributes` a change is compared with the previous listed entry (two left-out changes in a row, then one that differs from the listed one, give one row with the right delta), the start is always listed, `skipped` is present only when above 0, and `compression_ratio` keeps the raw size of the answer as received (R12); and that one day of the ten-second power sensor alone exceeds the default limit (R10)

### Implementation for User Story 2

- [ ] T030 [US2] In `packages/mcp/src/history/inputs.ts`, add `attributes` to `parseHistoryInputs` (1 to 100 entries of 1 to 128 characters, duplicates removed keeping the first) and refuse it with `summary`, with `inputInvalid(problem, "history")` (R4); in `packages/mcp/src/history/select.ts`, apply `exclusion` after `entities` (R3); in `packages/mcp/src/history/entries.ts`, trim to the listed attributes after redaction and leave out the changes that do not differ from the previous listed entry, counting them (R9)
- [ ] T031 [US2] In `packages/mcp/src/tools/ha-history.ts`, parse `exclude` and the inputs before connecting, refuse a resolved window longer than 864,000,000 ms with `windowTooLong()` before the history read (R5), pass `attributes` to the envelope and the filter, and refuse a `standard` document above `readHistoryLimit` with `tooLargeHistory(entities, changes, bytes, limit, "standard")` (R10). Make T028 and T029 pass

**Checkpoint**: both P1 stories pass on the fake instance.

---

## Phase 5: User Story 3 — Seeing which entities were busy before reading their history (Priority: P2)

**Goal**: `detail: "summary"` gives the counts per domain, and per entity when `entities` is given, read without attributes, never refused and under 4,000 bytes without `entities` (spec FR-013).

**Independent Test**: the summary cases of `packages/mcp/test/history.test.ts` and `history-encode.test.ts` (quickstart §2).

### Tests for User Story 3 (write first, see them fail)

- [ ] T032 [US3] In `packages/mcp/test/history-encode.test.ts` and `packages/mcp/test/history.test.ts`, add cases: the summary of `REFERENCE_HISTORY` with `entities` has `by_entity` rows `[changes, state_changes, attribute_only]` equal to what its `standard` result lists per entity, and `counts` and `by_domain` equal to their sums; `changes = state_changes + attribute_only` in every row; a change is a state change when it has no `lc` (the first change of an entity created in the window included) and the start state is never counted (R11); without `entities` there is no `by_entity`, and a synthetic instance with 100 domains gives a summary under 4,000 bytes that is never refused, even with `DOMUSOPS_HISTORY_MAX_BYTES` at its minimum (FR-013); with `entities` and the limit set low, a summary above it is `too_large` with the summary remediation; the history read for a summary sends `no_attributes: true`; `exclude` and `significant_only` narrow the counts as they narrow `standard`; an empty selection gives zero counts and the nothing-matched note; the summary is valid against `historyJsonSchema`, and `expandHistory` refuses it

### Implementation for User Story 3

- [ ] T033 [US3] Create `packages/mcp/src/history/encode-summary.ts`: `encodeSummaryHistory(envelope, answer, withEntities)` builds `counts`, `by_domain` and, when `withEntities`, `by_entity`, as data-model §4 and research R11
- [ ] T034 [US3] In `packages/mcp/src/tools/ha-history.ts`, for `detail: "summary"` read the history with `no_attributes: true`, skip redaction, encode with `encodeSummaryHistory`, and apply the limit only when `entities` was given, with `tooLargeHistory(…, "summary")` (R10, R11). Make T032 pass

**Checkpoint**: all three stories pass on the fake instance.

---

## Phase 6: Polish and closing

- [ ] T035 Build the server and, on a `default_config` sandbox of 2026.10.0 with a virtual light switched a few times, compare the raw `history/history_during_period` answers with what `packages/mcp/test/support/fake-ha.ts` gives for the same calls (start state, `lc`, `significant_changes_only`, `no_attributes`, absent entities), fixing the fake if they differ; measure `compression_ratio` of a `standard` call for the light and of an unfiltered `summary`; record the values in research R12. T036 asserts the ratio is above 1 if the measurement supports it; otherwise R12 records why and T036 asserts it is reported and positive, while the CI floor of 5 on the reference fixture stays the §4 contract
- [ ] T036 In `packages/sandbox/test/mcp.container.test.ts`, add a test per channel: on a sandbox with `default_config`, a virtual light and a virtual switch, and the built server, switch the light a few times, then `ha_history` with `entities: ["light.<name>", "switch.<name>"]` returns a `domusops.history/0.1` document with the light's start state and its changes in order and the unchanged switch with its start state only; with `entities: ["switch.*"]` the unchanged switch is left out and the nothing-changed note follows; a `summary` with the light's ID whose counts match the `standard` result; a `summary` without `entities` that holds the `light` domain; the `compression_ratio` bound T035 set; the same call over a past window twice is byte-identical (SC-005, SC-006, §8)
- [ ] T037 [P] In the root `README.md`, add the `ha_history` row to the tool table
- [ ] T038 Run the gate (`pnpm lint && pnpm typecheck && pnpm test`), then `pnpm build` and the container test on `DOMUSOPS_SANDBOX_RELEASE=2026.10.0` and `2026.9.4` (never the unpinned stable channel); confirm that no existing output test of `ha_snapshot`, `ha_logbook_query`, `ha_trace` or `ha_state` was edited and that `ha_ping`'s tests changed only by the new tool entry (SC-007); run Prettier only on the touched files, never on `tasks.md`
- [ ] T039 Mark these tasks `[X]` as they complete, and ask the maintainer before any commit, push or pull request; after the pull request, run `/code-review` and triage the findings before pushing fixes
- [ ] T040 After the maintainer merges, update `CLAUDE.md`'s current focus to point at feature 012 (`ha_system_log`); the 0.2.0 release itself waits for feature 012

---

## Dependencies and order

- T001 first. Phase 2 before every story: T002 → T003 (the schema test before its code); T004 → T005, after T003; T006 after T005; T007, T008, T009, T010 and T011 are independent of the schema work and of each other; T012 after T008 and T010.
- Phase 3: T013 to T017 before T018 to T026; T018, T019 and T020 before T021; T020a before T022; T021 and T012 before T022; T022 and T023 before T024; T024 before T025 and T026.
- Phase 4 extends the files of Phase 3 and so follows it: T028, T029 → T030 → T031.
- Phase 5 follows Phase 4 (it shares `ha-history.ts` and the input parsing that refuses `attributes` with `summary`): T032 → T033 → T034.
- T035 before T036: the comparison fixes the fake and the measurement sets the sandbox bound. T035 and T036 need the built server; T038, T039 and T040 close.

### Parallel opportunities

- Phase 2: T002–T006 (schema) alongside T007, T008, T009, T010 and T011 (mcp).
- Phase 3: T014, T015, T016 and T017 once T013 is written; T018, T019, T020, T020a, T023 and T027 alongside each other.
- Phase 6: T037 alongside T036.

## Implementation strategy

Phase 2, then Phase 3 as the minimum useful tool (the history of chosen entities), then Phase 4, which makes it safe on a large home and a long window, then Phase 5. All ship in the same pull request: the limit of Phase 4 is what makes `standard` bounded (§4), and its remediation points at the summary of Phase 5.

## Requirement coverage

| Requirement | Tasks                                            |
| ----------- | ------------------------------------------------ |
| FR-001      | T013, T017, T024                                 |
| FR-002      | T013, T018, T022                                 |
| FR-003      | T028, T030, T031                                 |
| FR-004      | T013, T022, T028, T031                           |
| FR-005      | T011, T013, T019, T021, T022                     |
| FR-006      | T028, T029, T030, T031                           |
| FR-007      | T013, T014, T018                                 |
| FR-008      | T014, T020, T021                                 |
| FR-009      | T016, T019                                       |
| FR-010      | T013, T026                                       |
| FR-011      | T007, T008, T028, T029, T031                     |
| FR-012      | T009, T013, T018, T022                           |
| FR-013      | T032, T033, T034                                 |
| FR-014      | T008, T012, T013, T022                           |
| FR-015      | T010, T012, T013, T022                           |
| FR-016      | T017, T024                                       |
| FR-017      | T002–T006, T014, T015, T021                      |
| FR-018      | T014, T022, T035, T036                           |
| FR-019      | T017, T023, T025                                 |
| FR-020      | T035, T036, T038                                 |
| FR-021      | T008, T013, T025, T038                           |
| FR-022      | T027                                             |
| FR-023      | T011, T016, every test task (invented data only) |
| SC-001      | T013                                             |
| SC-002      | T014, T015                                       |
| SC-003      | T028                                             |
| SC-004      | T016                                             |
| SC-005      | T013, T036                                       |
| SC-006      | T036                                             |
| SC-007      | T038                                             |
