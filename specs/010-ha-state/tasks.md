---
description: "Task list for ha_state (feature 010, second tool of 0.2.0)"
---

# Tasks: ha_state

**Input**: Design documents from `/specs/010-ha-state/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/ (ha_state.tool.json, state-format.md), quickstart.md

**Tests**: Included. Tests are written first and seen to fail. Unit tests run in the default `pnpm test`; container tests run with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: User Stories 1 and 2 share every file (selection, encoding, limit) and User Story 3 is small, so the feature is one branch (`010-ha-state`) and one pull request (plan, Delivery). Spec, plan and tasks are committed first; the implementation follows in atomic commits.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 or US3, from spec.md
- All paths are relative to the repository root. Everything written to the repository is English (constitution §1), and no example, fixture or test contains data from a real home (FR-024).
- The last tasks are always the same: run the gate (`pnpm lint && pnpm typecheck && pnpm test`), Prettier on only the touched files (never `tasks.md`), and then ask the maintainer before any commit, push or pull request. The maintainer merges. `/code-review` runs after the pull request and its findings are triaged before anything is pushed.
- The feature adds a minor changeset for `@domusops/mcp` and one for `@domusops/schema` (FR-023). The Version Packages pull request (#36) stays unmerged until features 011 and 012 merge (research R14).
- Existing helpers are reused as they are, not copied: `parseSelectors`, `matcher`, `exclusion` (`packages/mcp/src/logbook/selectors.ts`), `formatLocalIso` (`packages/mcp/src/logbook/local-time.ts`), `TemplateBook` (`packages/mcp/src/snapshot/templates.ts`), `redactRows` and `EXEMPT_KEYS` (`packages/mcp/src/snapshot/redact.ts`), `finalize` and `byteLength` (`packages/mcp/src/snapshot/ratio.ts`), `readCurrentUser` and `readCore` (`packages/mcp/src/ha/instance.ts`), `exclusionNote` and `MAX_NOTE_ITEMS` (`packages/mcp/src/notes.ts`), and from `@domusops/schema` `escapeKey`, `unescapeKey`, `encodeContextId` and `decodeContextId`.

---

## Phase 1: Setup

- [ ] T001 Run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` on the branch before any code and record that the baseline is green (constitution §2)

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the published format and its decoder, the limit, the errors and the notes that every story uses.

- [ ] T002 [P] Create `packages/mcp/test/state-json-schema.test.ts`: `STATE_FORMAT` is `domusops.state/0.1`; `stateJsonSchema` accepts the standard and summary examples of `specs/010-ha-state/contracts/state-format.md`; it rejects a document without `format`, with a `detail` other than `summary` or `standard`, a `utc_offset` not of the form `±HH:MM`, a summary without `counts` or `by_domain`, a `by_domain` row that is not three non-negative integers, and a standard document without `templates` or `entities`
- [ ] T003 In `packages/schema/src/state/format.ts`, add `STATE_FORMAT`, `STATE_DETAIL_LEVELS` and the types `StateEnvelope`, `StateStandardDocument`, `StateSummaryDocument`, `StateDocument` and `StateRecord`, with the keys and order of data-model §1 to §3 and §6 (envelope: `format`, `detail`, `ha_version`, `compression_ratio`, `time_zone`, `utc_offset`, `anchor`, then optional `selectors`, `domains`, `states`, `attributes`); in `packages/schema/src/state/json-schema.ts`, add `stateJsonSchema`, reusing the snapshot's template and groups definitions where they exist; export both modules from `packages/schema/src/index.ts` (R11)
- [ ] T004 [P] Create `packages/schema/test/state-expand.test.ts` with hand-built documents: positional rows and inline `_` records decode to `entity_id` `<domain>.<object_id>`, `state` and unescaped attribute keys (`~id` back to `id`, `~st.x` back to `st.x`); template constants are restored; an absent `st.last_updated` equals `last_changed`; an absent `st.last_reported` equals `last_updated` when the template's members omit it, and is absent from the record when the document never carries it for that record; absent `st.parent_id` and `st.user_id` give `null`; a time without an offset gains `utc_offset` and one with an offset keeps it; `st.context` and `st.parent_id` decode to full 26-character IDs with `decodeContextId` and the anchor, and a `{ "v": id }` value decodes to `id`; records come in entity-ID order across domains; a summary document is refused with an error that names `detail=standard`
- [ ] T005 In `packages/schema/src/expand.ts`, export `decodeGroups` from the module only (not from `packages/schema/src/index.ts`); create `packages/schema/src/state/expand.ts` with `expandState(document: StateStandardDocument): StateRecord[]` as data-model §6 and research R11, reusing `decodeGroups` and `unescapeKey`; export it from the index. Make T004 pass. The existing `expand`, `expandLogbook` and `expandTrace` tests pass unedited
- [ ] T006 [P] In `packages/schema/README.md`, add the format's row to the Formats table (detail levels `summary` and `standard`; decoder `expandState` for `standard`) and `STATE_FORMAT`, the `State*` types, `stateJsonSchema` and `expandState` to the exports list
- [ ] T007 [P] In `packages/mcp/test/config.test.ts`, add cases for `DOMUSOPS_STATE_MAX_BYTES`: absent gives 100000; a valid value is used; an invalid one is a `config_invalid` error naming the variable, as the logbook and trace limits do; then in `packages/mcp/src/ha/config.ts` add `STATE_LIMIT_VARIABLE`, `DEFAULT_STATE_LIMIT = 100_000` and `readStateLimit` through the shared `readLimit` (R8)
- [ ] T008 [P] In `packages/mcp/src/errors.ts`: add `input_invalid` to `ERROR_KINDS`; widen `notAdmin` to the subject `"states"`, whose cause says the states could be filtered for a user who is not an administrator and whose remediation matches the other two, leaving the `"snapshot"` and `"history"` wordings byte-identical (R1, FR-022); add `inputInvalid(problem)`, whose remediation names the limits of R3 ("domain: 1 to 100 entries of 1 to 64 characters of a-z, 0-9 and _; state: 1 to 100 entries of 1 to 255 characters; attributes: 1 to 100 entries of 1 to 128 characters, and only with detail=standard"); add `tooLargeStates(entities, bytes, limit)` with the cause "The result has N entities and would be B bytes, above the limit of L bytes" and the remediation "Use detail=summary to see where the entities are, or narrow the query with entities, domain, state, exclude, or attributes; to allow larger results, raise DOMUSOPS_STATE_MAX_BYTES" (R3, R8). `packages/mcp/test/logbook-errors.test.ts` and `packages/mcp/test/trace-errors.test.ts` pass unedited
- [ ] T009 [P] In `packages/mcp/test/response-notes.test.ts`, add cases, then in `packages/mcp/src/notes.ts` add `notFoundNote(ids)` — "Note: no entity has the ID <ids>." with the IDs comma-separated, at most `MAX_NOTE_ITEMS` (10), then "and N more" — and `nothingMatchedNote()` — "Note: no entity matched the query." (R13)

**Checkpoint**: the format, its JSON Schema and its decoder are published in the workspace; the limit, the three errors and the two notes exist.

---

## Phase 3: User Story 1 — Reading the current state of chosen entities (Priority: P1) 🎯 MVP

**Goal**: `ha_state` with `entities` (and `exclude`) returns each selected entity's state, attributes, times and context in the `standard` document, redacted, deterministic, from three reads on one connection (spec FR-001 to FR-003, FR-006 to FR-011, FR-013, FR-016 to FR-020).

**Independent Test**: `packages/mcp/test/state.test.ts`, `state-encode.test.ts`, `state-roundtrip.test.ts` and `state-redaction.test.ts` (quickstart §1 and §2).

### Tests for User Story 1 (write first, see them fail)

- [ ] T010 [US1] Create `packages/mcp/test/state.test.ts` against the fake instance (`packages/mcp/test/support/fake-ha.ts`) with a small synthetic fixture: `entities: ["light.*"]` returns every light, in object-ID order, each with its state, attributes, times and context; exact IDs and patterns combine; `exclude` removes after `entities`, and the exclusion note comes first; an exact ID that names no entity is named in the not-found note, and one that is itself excluded is not; an empty selection is a valid document (no `templates` rows) followed by the not-found note, if any, then the nothing-matched note (R13); no `entities` selects every entity; the fake instance saw one connection and, after the handshake, exactly `auth/current_user`, `get_config` and `get_states` (FR-016); a user with `is_admin: false` gets `not_admin` with the `states` wording and no `get_states` is sent (R1); an invalid `entities` or `exclude` gives `selector_invalid` and no connection; `config_missing`, `auth_invalid`, `unreachable` and a stalled `get_states` (`timeout`) give the existing kinds and texts; two calls give byte-identical text (SC-006); every document is valid against `stateJsonSchema`; the outputs of `ha_snapshot`, `ha_logbook_query` and `ha_trace` on the same fixture are untouched (FR-022, SC-008)
- [ ] T011 [P] [US1] Create `packages/mcp/test/state-encode.test.ts` for the standard encoding on hand-built state objects: the envelope's keys and order (data-model §1); `entities` maps domains in name order to groups whose head is `[object_id, state]` (`id` and `state` in an inline `_` record); attribute keys go through `escapeKey` (an attribute named `state`, `id` or `st.x` gains `~`); `st.last_changed` always present; `st.last_updated` left out when equal to `last_changed`; `st.last_reported` left out when equal to `last_updated` or absent; times are `formatLocalIso` to the second, without an offset when it equals `utc_offset` and with one across a daylight-saving change; `anchor` is the latest `last_updated` truncated to the second, or the call time when nothing is selected (R5); `st.context` and `st.parent_id` are compact IDs from `encodeContextId(id, anchorMs)`, a non-ULID ID is kept and one that looks compact is wrapped as `{ "v": id }` (R6, data-model §5); `st.parent_id` and `st.user_id` are left out when `null`; repeated attribute sets become template constants (FR-018); on the whole `REFERENCE_500` fixture, `compression_ratio` is at least 2 (FR-019, SC-002, R10)
- [ ] T012 [P] [US1] Create `packages/mcp/test/state-roundtrip.test.ts`: for `REFERENCE_500` and for selections of it (`light.*`, `sensor.*`, one entity, none), `expandState(encode(redact(states)))` equals the redacted states in entity-ID order, times compared to the second and in local form, context IDs full (data-model §7, FR-018)
- [ ] T013 [P] [US1] Create `packages/mcp/test/state-redaction.test.ts` with a synthetic fixture that seeds every redaction rule into entity attributes (a secret-looking key, a token-like value, the configured token, an e-mail address, the instance's coordinates and other coordinates): none of them appear in the text, and the `friendly_name` of a `person` entity, a `user_id` and the names in attributes remain (FR-010, FR-011, SC-005, R7)
- [ ] T014 [P] [US1] In `packages/mcp/test/tool.test.ts`, add that `ha_state` is listed between `ha_trace` and `ha_ping` with the title, description, input schema and annotations of `specs/010-ha-state/contracts/ha_state.tool.json` (`readOnlyHint` true, `destructiveHint` false, `idempotentHint` true, `openWorldHint` true), and that a call returns the document then the notes as text blocks; the existing check that the requirements table names every registered tool except `ha_ping` now covers `ha_state` (FR-001, FR-017, FR-020)

### Implementation for User Story 1

- [ ] T015 [P] [US1] Create `packages/mcp/src/state/select.ts`: `selectStates(states, { entities, exclude })` applies `matcher` for `entities` then `exclusion` for `exclude` (the order of R2, leaving room for `domain` and `state` between them in T026), sorts by entity ID, and returns the selected states with the exact IDs of `entities` that name no state and are not excluded
- [ ] T016 [P] [US1] Create `packages/mcp/src/state/envelope.ts`: `stateEnvelope({ detail, haVersion, timeZone, states, nowMs, selectors, domains, statesFilter, attributes })` builds the envelope of data-model §1 in that key order, with `anchor` per R5 and `utc_offset` the offset at the anchor; optional keys only when given
- [ ] T017 [US1] Create `packages/mcp/src/state/encode-standard.ts`: `encodeStandardState(envelope, states, timeZone)` builds `templates` and `entities` with one `TemplateBook` shared by every domain, the head `[object_id, state]`, escaped attribute keys and the `st.` fields with the defaults of data-model §2, local times (data-model §4) and compact context IDs (data-model §5). Make T011 and T012 pass
- [ ] T018 [US1] Create `packages/mcp/src/tools/ha-state.ts`: `runState(env, input, options)` validates `entities` and `exclude` with `parseSelectors` before connecting, reads the configuration (`readConfig`) and limit (`readStateLimit`), connects once, calls `readCurrentUser` and refuses a non-administrator with `notAdmin("states")`, then `readCore` and `get_states` together (R1); validates the `get_states` answer's shape as a protocol error; measures `rawBytes` as the selected state objects as received (R10); redacts with `redactRows(states, { token, exemptKeys: EXEMPT_KEYS, coordinates })` (R7); encodes, `finalize`s, and returns the document with the notes of R13 in order. Make T010 and T013 pass
- [ ] T019 [P] [US1] In `packages/mcp/src/ping/requirements.ts`, add `ha_state: { admin: true, integrations: [] }` after `ha_trace` (R12, FR-020)
- [ ] T020 [US1] In `packages/mcp/src/server.ts`, register `ha_state` after `ha_trace` and before `ha_ping`, with the title, description, input schema (zod mirroring the contract's limits) and annotations copied from `specs/010-ha-state/contracts/ha_state.tool.json`, with a "Copied from specs/010-ha-state/contracts/…" comment like the other tools, through `asToolResult("ha_state", …)`. Make T014 pass
- [ ] T021 [US1] In `packages/mcp/test/ping.test.ts`, update the healthy-document expectation so `tools` lists `ha_state` ready (the FR-022 exception: `ha_ping`'s open format lists the new tool), and add that `ha_state` is ready for an administrator with no integration and not ready with `not_admin` otherwise; in `packages/mcp/test/cli.test.ts`, add `ha_state` to the expected tool list
- [ ] T022 [US1] In `packages/mcp/README.md`, add the `ha_state` section (what it reads, the inputs, the document, the limit and `DOMUSOPS_STATE_MAX_BYTES`, the notes, the errors including `input_invalid`) and its row in the decoder table of "Reading responses" (`expandState` for `standard`; `summary` is read as it is); in `packages/mcp/test/readme.test.ts`, run the tested decoding example on a state document
- [ ] T023 [P] [US1] Add `.changeset/mcp-ha-state.md` (`@domusops/mcp` minor: the `ha_state` tool) and `.changeset/schema-state-format.md` (`@domusops/schema` minor: the `domusops.state/0.1` format, its types, JSON Schema and `expandState`)

**Checkpoint**: chosen entities can be read; the tool is registered, listed by `ha_ping` and documented.

---

## Phase 4: User Story 2 — Narrowing a large home to what matters (Priority: P1)

**Goal**: `domain`, `state` and `attributes` narrow the result, and a `standard` result above the limit is refused with the entity count and how to narrow it (spec FR-004, FR-005, FR-006, FR-012).

**Independent Test**: the narrowing and limit cases of `packages/mcp/test/state.test.ts` and `state-encode.test.ts` (quickstart §2).

### Tests for User Story 2 (write first, see them fail)

- [ ] T024 [US2] In `packages/mcp/test/state.test.ts`, add cases: `domain` keeps only those domains; `state` keeps only entities whose state equals one of the values exactly (`unavailable` does not match `Unavailable`); `entities`, `domain`, `state` and `exclude` combine in the order of R2; `attributes` keeps only the named attributes of each selected entity and never changes which entities are selected, and a name no entity has is not an error (FR-006); the envelope echoes `domains`, `states` and `attributes` as parsed, duplicates removed keeping the first (R3); validation before any connection, each an `input_invalid` error: `domain` empty, over 100 entries, an entry over 64 characters or outside `[a-z0-9_]`; `state` empty, over 100 entries, or an entry empty or over 255 characters; `attributes` empty, over 100 entries, or an entry empty or over 128 characters; `attributes` with `detail: "summary"`; with `DOMUSOPS_STATE_MAX_BYTES` set low, a `standard` result above it is a `too_large` error whose text holds the entity count, the byte size and the limit, and no entity ID (SC-004); the same query with `detail: "summary"` succeeds (FR-012)
- [ ] T025 [P] [US2] In `packages/mcp/test/state-encode.test.ts`, add that `attributes` trims attributes before encoding while `compression_ratio` keeps the untrimmed raw size (R10), and that a 3,000-entity synthetic home (six copies of `REFERENCE_500` with renamed IDs) at `standard` exceeds the default limit (R8)

### Implementation for User Story 2

- [ ] T026 [US2] Create `packages/mcp/src/state/inputs.ts`: `parseStateInputs(input)` validates `domain` (1 to 100 entries, each 1 to 64 characters of `[a-z0-9_]`), `state` (1 to 100 entries, each 1 to 255 characters), `attributes` (1 to 100 entries, each 1 to 128 characters), `detail` (`summary` or `standard`, default `standard`) and refuses `attributes` with `summary`, all with `inputInvalid`, removing duplicates keeping the first (R3); in `packages/mcp/src/state/select.ts`, add the `domain` and `state` filters between `entities` and `exclude` (R2) and the `attributes` trim after selection; in `packages/mcp/src/server.ts`, make the zod schema of `domain`, `state` and `attributes` advertise the same limits as the contract
- [ ] T027 [US2] In `packages/mcp/src/tools/ha-state.ts`, call `parseStateInputs` before connecting, pass the parsed filters to `selectStates` and the envelope, and refuse a `standard` document above `readStateLimit` with `tooLargeStates(entities, bytes, limit)` (R8). Make T024 and T025 pass

**Checkpoint**: both P1 stories pass on the fake instance.

---

## Phase 5: User Story 3 — Taking the temperature of the whole home (Priority: P2)

**Goal**: `detail: "summary"` gives the counts per domain of entities, `unavailable` and `unknown`, under 4,000 bytes, with the same filters (spec FR-014, FR-015).

**Independent Test**: the summary cases of `packages/mcp/test/state.test.ts` and `state-encode.test.ts` (quickstart §2).

### Tests for User Story 3 (write first, see them fail)

- [ ] T028 [US3] In `packages/mcp/test/state-encode.test.ts` and `packages/mcp/test/state.test.ts`, add cases: the summary of `REFERENCE_500` has `counts.entities` equal to the number of entities its `standard` result holds and `counts.domains` equal to its domains; `by_domain` rows are `[entities, unavailable, unknown]` in domain-name order, states compared exactly; `entities`, `domain`, `state` and `exclude` narrow the counts as they narrow `standard` (FR-015); a synthetic instance with 120 domains gives a summary under 4,000 bytes (SC-003); a summary is never refused for size, even with `DOMUSOPS_STATE_MAX_BYTES` at its minimum; an empty selection gives zero counts, an empty `by_domain` and the nothing-matched note; the summary is valid against `stateJsonSchema`, and `expandState` refuses it

### Implementation for User Story 3

- [ ] T029 [US3] Create `packages/mcp/src/state/encode-summary.ts`: `encodeSummaryState(envelope, states)` builds `counts: { entities, domains }` and `by_domain` as data-model §3 (R9)
- [ ] T030 [US3] In `packages/mcp/src/tools/ha-state.ts`, encode with `encodeSummaryState` when `detail` is `summary`, skipping the size check (R8). Make T028 pass

**Checkpoint**: all three stories pass on the fake instance.

---

## Phase 6: Polish and closing

- [ ] T031 In `packages/sandbox/test/mcp.container.test.ts`, add a test per channel: on a sandbox with `default_config` and the built server, `ha_state` with `entities: ["zone.home"]` returns a `domusops.state/0.1` document holding `zone.home` with its `latitude` and `longitude` redacted; a `summary` without filters whose `counts.entities` equals the number of entities in the full `standard` result; a `compression_ratio` above 1 for the full instance; the same call twice is byte-identical (SC-007, §8)
- [ ] T032 [P] In the root `README.md`, add the `ha_state` row to the tool table
- [ ] T033 Run the gate (`pnpm lint && pnpm typecheck && pnpm test`), then `pnpm build` and the container test on `DOMUSOPS_SANDBOX_RELEASE=2026.10.0` and `2026.9.4` (never the unpinned stable channel); confirm that no existing output test of `ha_snapshot`, `ha_logbook_query` or `ha_trace` was edited (SC-008); run Prettier only on the touched files, never on `tasks.md`
- [ ] T034 Mark these tasks `[X]` as they complete, and ask the maintainer before any commit, push or pull request; after the pull request, run `/code-review` and triage the findings before pushing fixes
- [ ] T035 After the maintainer merges, update `CLAUDE.md`'s current focus to point at feature 011 (`ha_history`); the 0.2.0 release itself waits for features 011 and 012

---

## Dependencies and order

- T001 first. Phase 2 before every story: T002 → T003 (the schema test before its code); T004 → T005, after T003; T006 after T005; T007, T008 and T009 are independent of the schema work and of each other.
- Phase 3: T010 to T014 before T015 to T022; T015 and T016 before T017; T017 before T018; T018 and T019 before T020; T020 before T021 and T022.
- Phase 4 extends the files of Phase 3 and so follows it: T024, T025 → T026 → T027.
- Phase 5 follows Phase 4 (it shares `ha-state.ts` and the input parsing that refuses `attributes` with `summary`): T028 → T029 → T030.
- T031 needs the built server (T033's build); T033, T034 and T035 close.

### Parallel opportunities

- Phase 2: T002–T006 (schema) alongside T007, T008 and T009 (mcp).
- Phase 3: T011, T012, T013 and T014 once T010 is written; T015, T016, T019 and T023 alongside each other.
- Phase 6: T032 alongside T031.

## Implementation strategy

Phase 2, then Phase 3 as the minimum useful tool (read chosen entities), then Phase 4, which makes it safe on a large home, then Phase 5. All ship in the same pull request: the limit of Phase 4 is what makes `standard` bounded (§4), and its remediation points at the summary of Phase 5.

## Requirement coverage

| Requirement            | Tasks                                |
| ---------------------- | ------------------------------------ |
| FR-001                 | T010, T014, T020                     |
| FR-002, FR-003         | T010, T015, T018                     |
| FR-004, FR-005         | T024, T026, T027                     |
| FR-006                 | T010, T011, T017, T024, T026         |
| FR-007                 | T010, T015                           |
| FR-008                 | T011, T016, T017                     |
| FR-009                 | T011, T012, T017                     |
| FR-010, FR-011         | T013, T018                           |
| FR-012                 | T007, T008, T024, T027               |
| FR-013                 | T009, T010, T018                     |
| FR-014, FR-015         | T028, T029, T030                     |
| FR-016                 | T010, T018                           |
| FR-017                 | T014, T020                           |
| FR-018                 | T002–T006, T011, T012, T017          |
| FR-019                 | T011, T018, T031                     |
| FR-020                 | T014, T019, T021                     |
| FR-021                 | T031, T033                           |
| FR-022                 | T008, T010, T021, T033               |
| FR-023                 | T023                                 |
| FR-024                 | every test task (invented data only) |
| SC-001                 | T010                                 |
| SC-002                 | T011                                 |
| SC-003                 | T028                                 |
| SC-004                 | T024                                 |
| SC-005                 | T013                                 |
| SC-006                 | T010, T031                           |
| SC-007                 | T031, T033                           |
| SC-008                 | T010, T033                           |
