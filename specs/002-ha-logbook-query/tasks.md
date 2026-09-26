---
description: "Task list for the ha_logbook_query feature"
---

# Tasks: ha_logbook_query — Compressed Activity History

**Input**: Design documents from `specs/002-ha-logbook-query/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Requested. The spec's acceptance criteria require a round-trip test, a redaction oracle,
and a CI-asserted compression floor (FR-018). Within each story, write the tests first and confirm
they fail before implementing.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested as
an increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US4, from spec.md)

## Path Conventions

pnpm workspace: `packages/schema/` (public contract) and `packages/mcp/` (MCP server). Sources
live in `packages/<pkg>/src/`, tests in `packages/<pkg>/test/`. All paths are relative to the
repository root. Section references (`data-model §3.2`, `research R6`) point into this feature's
[data-model.md](./data-model.md) and [research.md](./research.md).

---

## Phase 1: Setup

**Purpose**: Commit the specification

- [x] T001 Commit `specs/002-ha-logbook-query/` alone on the existing branch `002-ha-logbook-query` as `docs: add ha-logbook-query spec, plan, and tasks`. `main` is protected (constitution §9), so all work happens on this branch. No dependency or tooling changes are needed: the feature adds no package, no runtime dependency, and no test tool.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The format contract, the changes to shared code, and the test infrastructure that every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Format contract (`@domusops/schema`)

- [x] T002 [P] Create `packages/schema/src/logbook/format.ts`:
  - `LOGBOOK_FORMAT = "domusops.logbook/0.1"` and `LOGBOOK_DETAIL_LEVELS = ["summary", "standard"]` with `LogbookDetailLevel`.
  - `LogbookRow` (data-model §1): `when: number` required; every other key optional; an index signature for unknown keys.
  - The envelope (data-model §2), all snake_case: `format`, `detail`, `ha_version`, `compression_ratio`, `time_zone`, `utc_offset` (`±HH:MM`), `window: { start, end }`, `first` and `last` (`string | null`), and optional `selectors` and `no_events` (`string[]`).
  - `LogbookStandardDocument`: the envelope plus `strings?`, `entities` (each entry a bare string or `[id | null, constants, columns]`), `causes?`, and `events` (local date → hour key → rows), with the row layout of data-model §3.1 documented on the type.
  - `LogbookSummaryDocument`: the envelope plus `counts` (`events`, `entities`, `causes`, `no_entity_events`), `by_domain`, `by_entity` (`[count, first, last]`), and `by_cause` (data-model §4).
- [x] T003 [P] Create `packages/schema/src/logbook/ulid.ts` with `encodeContextId(id, secondStartMs)` and `decodeContextId(encoded, secondStartMs)` (data-model §3.2). A 26-character uppercase Crockford base32 ULID becomes `"<offset>:<last 16 characters>"`, where `offset` is the ULID's millisecond timestamp minus `secondStartMs`, as a signed decimal integer. Any value that is not such a ULID, or whose re-encoding would not reproduce it exactly, is returned verbatim. `decodeContextId` treats a string containing `:` as encoded and any other string as verbatim.
- [x] T004 [P] Create `packages/schema/src/logbook/project.ts` exporting `projectLogbook(rows)` (data-model §5): P1 truncates `when` to the whole second (`Math.floor`), P2 removes keys whose value is `null`. Row order is kept.
- [x] T005 Update `packages/schema/src/index.ts` to re-export `logbook/format.js`, `logbook/ulid.js`, and `logbook/project.js`. The `logbook/expand.js` and `logbook/json-schema.js` exports follow in T022 and T039 (depends on T002 to T004).

### Shared code (`@domusops/mcp`)

- [x] T006 Generalise `packages/mcp/src/errors.ts`:
  - Rename the class `SnapshotError` to `ToolError`. `toToolText(tool: string)` returns `` `${tool} failed [${kind}]: ${message}` ``, so the `ha_snapshot` text is byte-identical to today's.
  - Add the kinds `window_invalid`, `selector_invalid`, `history_unavailable`, and `too_large` to `ERROR_KINDS`, with builders whose text follows data-model §8. `too_large(events, bytes, limit)` states the event count, the emitted size, the limit, and the ways to narrow the query (`summary`, a shorter window, fewer entities, or raising `DOMUSOPS_LOGBOOK_MAX_BYTES`). `window_invalid(problem)` states the accepted form (`2026-09-26T03:00`, with optional `Z` or `±HH:MM`). `selector_invalid(selector)` names the selector and the accepted characters `a-z 0-9 _ . *`. `history_unavailable()` says to enable the `logbook` and `recorder` integrations.
  - Add `configInvalidValue(variable, value, expected)` for `DOMUSOPS_LOGBOOK_MAX_BYTES`, kind `config_invalid`.
  - Give `errors.timeout(address, phase)` an optional third argument, a next-step override; the logbook retrieval passes "Use a shorter window or fewer entities, then try again".
  - Update every use: `packages/mcp/src/server.ts`, `packages/mcp/src/tools/ha-snapshot.ts`, `packages/mcp/src/ha/client.ts`, `packages/mcp/test/version.test.ts`, `packages/mcp/test/client.test.ts` (`server.ts` passes `"ha_snapshot"`). Confirm `pnpm test` still passes unchanged in behaviour.
- [x] T007 [P] Extend `packages/mcp/src/ha/config.ts` with `readLogbookLimit(env): number`: reads `DOMUSOPS_LOGBOOK_MAX_BYTES`, returns `100000` when unset or empty, and throws `errors.configInvalidValue` unless the value is a string of digits that is a positive safe integer.
- [x] T008 Extend `packages/mcp/src/ha/client.ts`:
  - Add `"logbook/get_events"` to `ALLOWED_COMMANDS`.
  - `command(type, params?)`: `params` is accepted only for `logbook/get_events`, with exactly the keys `start_time` (string), `end_time` (string), and optional `entity_ids` (`string[]`); any other command or key is rejected with `errors.protocolError` before it reaches the socket.
  - `logbook/get_events` is bounded by the remaining overall deadline (`totalMs`) instead of `commandMs`; every other command keeps `commandMs`. Its timeout error passes the next step of T006.
  - Add cases to `packages/mcp/test/client.test.ts`: params rejected on a metadata command, unknown params key rejected, the logbook command allowed beyond 10 s when the overall deadline permits (use small injected timeouts).
- [x] T009 Create `packages/mcp/src/ha/logbook.ts` (the only new code that talks to Home Assistant):
  - `readContext(client): Promise<LogbookContext>`: sends `auth/current_user` and requires `is_admin === true` (else `errors.notAdmin()`), then `get_config`, and returns `{ haVersion, timeZone, latitude, longitude, hasLogbook }`. A missing or non-string `time_zone`, or a non-array `components`, is `errors.protocolError`. `hasLogbook` is whether `components` includes `"logbook"`; when false, throw `errors.historyUnavailable()`.
  - `fetchEvents(client, startIso, endIso, entityIds?): Promise<LogbookRow[]>`: sends `logbook/get_events`. An `unknown_command` failure becomes `errors.historyUnavailable()`; any other failure stays `retrieval_failed` (the client already builds it). The result must be an array of objects, each with a numeric `when`, else `errors.protocolError`.
- [x] T010 [P] Generalise `packages/mcp/src/snapshot/redact.ts`: extract the string and object walk into `redactRows(rows, options)` with `options = { token, exemptKeys, coordinates? }`, keep `redact(records, token)` behaving exactly as today by calling it, and export `LOGBOOK_EXEMPT_KEYS = ["entity_id", "context_entity_id", "context_user_id", "context_id"]` (data-model §7). `coordinates` is accepted and ignored until T029.
- [x] T011 [P] Generalise `packages/mcp/src/snapshot/ratio.ts`: `finalize` accepts any document with a numeric `compression_ratio` (generic constraint), and add `measureRowsBytes(rows)`, the UTF-8 length of `JSON.stringify(rows)` (data-model §6). Existing snapshot tests must not change.

### Test infrastructure

- [x] T012 [P] Create `packages/mcp/test/fixtures/generate-logbook.ts`, a seeded generator like `generate.ts`, exporting `REFERENCE_LOGBOOK_24H` and `PERFORMANCE_LOGBOOK`, and `LOGBOOK_EMPTY`. Calibrate to research R7: the reference has about 2,100 events over about 150 entities in 24 hours (window end fixed, time zone `Europe/Madrid`), the measured domain mix (sensor 34%, automation 25%, media_player 10%, light 8%, script 6%, binary_sensor 5%, about 16 other domains), 21% of events with one of about 50 causes, automation and script rows with `name`, `message`, `source`, `domain`, and a 26-character ULID `context_id` (27% of events, 0 to 27 s before the event), 1% of events without an entity, about 200 raw bytes per event. Row keys follow research R1. The performance fixture has 1,000 entities and 10,000 events in 24 hours. Add a test in `packages/mcp/test/logbook-encode.test.ts` (T016) that the reference fixture's ratio is within 5.2 to 5.6 (calibration guard); adjust the generator, not the range.
- [x] T013 Extend `packages/mcp/test/support/fake-ha.ts` and the `Fixture` type in `packages/mcp/test/fixtures/generate.ts`:
  - `Fixture` gains an optional `logbook?: LogbookRow[]`; the logbook fixtures of T012 also provide `records.config` with `time_zone`, `components` (including `"logbook"`), `latitude`, and `longitude`.
  - The fake serves `logbook/get_events`: it filters `logbook` by `start_time` and `end_time` (rows with `when` in `[start, end]`), and by `entity_ids` when present. It replies `[]` for a future `start_time`, and `invalid_start_time` for an unparseable one (as Home Assistant does, research R1).
  - `FakeHaOptions.logbook: false` makes the fake answer `unknown_command` for it; the fake records the params of every `logbook/get_events` in `receivedParams`.
  - `received` and `authReceived` keep their meaning.

**Checkpoint**: Foundation ready. `pnpm lint && pnpm typecheck && pnpm test` pass, with the same tests as before plus T008's cases.

---

## Phase 3: User Story 1 - What happened, and why (Priority: P1) 🎯 MVP

**Goal**: One call returns the events of a window, in order, each with its cause, compressed to at least 5x.

**Independent Test**: Run the tool against the 24-hour reference fixture through the fake instance. Every row the instance returned appears in order with its cause, and `compression_ratio` is at least 5.

### Tests for User Story 1 (write first; they must fail)

- [x] T014 [P] [US1] Create `packages/mcp/test/logbook-window.test.ts` for `parseWindowInput` and `resolveWindow` (T020); syntax failures come from `parseWindowInput`, order failures from `resolveWindow`: default window is 24 hours ending at `now`; only `end` given; only `start` given; an offset-less timestamp resolves in the instance time zone (`Europe/Madrid`, both a winter and a summer date) and an explicit `Z` or `±HH:MM` is honoured; a DST gap time shifts forward by the gap and an overlap time resolves to the earlier instant (data-model, contract "Input"); `end` after `now` is clamped to `now`; and each invalid case throws `window_invalid`: an unparseable timestamp, `2026-13-01`, `end` not after `start`, and `start` after `now`. Fractional seconds are accepted.
- [x] T015 [P] [US1] Create `packages/mcp/test/logbook-selectors.test.ts` for `parseSelectors`, `matches`, and `noEvents` (T021): exact IDs and `*` patterns (`light.*`, `*_motion`, `*`, `sensor.*_temp*`); anchored, case-sensitive matching; duplicates and overlapping patterns select a row once; each invalid case (empty string, uppercase, a space, `?`, `[`) throws `selector_invalid`; more than 100 selectors is rejected; a selector matching nothing appears in `no_events` in request order; `strategy(selectors)` returns `all`, `exact` (only exact IDs, sent as `entity_ids`), or `filtered` (any pattern, queried without `entity_ids`) per research R4.
- [x] T016 [P] [US1] Create `packages/mcp/test/logbook-encode.test.ts`: on the 24-hour reference fixture, `compression_ratio >= 5` (FR-018, SC-001) and the calibration guard of T012; determinism (encoding twice gives identical strings); every index in every row resolves in `entities`, `causes`, and `strings`; hour keys are `"HH:00"` and in ascending order within a date; no object key is integer-like; at most one entity entry has a `null` ID; a window across a DST change uses `"HH:00±HH:MM"` keys for hours whose offset differs from `utc_offset` and never merges a repeated local hour; the empty fixture yields a valid document with `first: null`, `last: null`, and `events: {}`.
- [x] T017 [P] [US1] Create `packages/mcp/test/logbook-roundtrip.test.ts` and `packages/schema/test/logbook-expand.test.ts`: `expandLogbook(encodeStandard(rows))` deep-equals `projectLogbook(rows)`, element by element and in order, for the reference, performance, and empty fixtures and for hand-built rows covering every case of data-model §3: a string-table reference, a literal integer (`{ "v": n }`), a boolean and an object value (`attributes`), a key present in some rows of an entity and absent in others, an entity with one row (no constants), constants across two or more rows, a non-ULID `context_id`, and two rows of an entity in the same second (order kept). The schema-package test uses hand-written documents, so it does not depend on the encoder.
- [x] T018 [P] [US1] Create `packages/mcp/test/logbook-tool.test.ts` for the happy path through `runLogbookQuery` (T024) and the fake instance: default window; explicit window; selectors of each strategy (exact IDs send `entity_ids`, patterns do not, verified through `receivedParams`); with selectors, no row without an entity appears, and without selectors all do (invariant 3); `no_events` and `selectors` in the envelope; `first`, `last`, `window`, `time_zone`, and `utc_offset` (FR-010); an empty result is a valid document (edge case); events shared by one cause reference one `causes` entry (acceptance scenario 3); a 1,000-entity, 10,000-event window completes in under 5 s (SC-004), run with `DOMUSOPS_LOGBOOK_MAX_BYTES=10000000` because its `standard` document (about 370 KB) is far above the default limit, which this case does not test; `received` contains only allowlisted commands for every parameter combination and `receivedParams` only the three permitted keys (SC-006).

### Implementation for User Story 1

- [x] T019 [P] [US1] Create `packages/mcp/src/logbook/local-time.ts`: `localParts(epochMs, timeZone)` returns `{ date, hour, minute, second, offsetMinutes }` using `Intl.DateTimeFormat` with `hourCycle: "h23"` (no dependency), and `formatOffset(minutes)` returns `±HH:MM`. `zonedToInstant(localIso, timeZone)` resolves an offset-less local time to an instant (gap and overlap rules of T014).
- [x] T020 [P] [US1] Create `packages/mcp/src/logbook/window.ts`: two functions, per research R3 and the contract "Input". `parseWindowInput({ start?, end? })` needs no connection: it validates the syntax `YYYY-MM-DDTHH:MM[:SS[.fff]][Z|±HH:MM]` with a regular expression and returns the parsed parts, with or without an offset. `resolveWindow(parsed, now, timeZone)` resolves offset-less times in the instance time zone, applies the defaults and the clamp, checks that `end` is after `start` and that `start` is not after `now`, and returns `{ startMs, endMs, startIso, endIso }` where the ISO strings are UTC for the instance call. Every failure of either is `errors.windowInvalid` (depends on T019).
- [x] T021 [P] [US1] Create `packages/mcp/src/logbook/selectors.ts`: `parseSelectors(list?)` validates each selector against `^[a-z0-9_.*]+$` (1 to 100 items, at least one character), removes duplicates keeping request order, and throws `errors.selectorInvalid`; `matches(selector, entityId)` is an anchored, case-sensitive match where `*` matches any sequence including an empty one (escape every other character); `strategy(selectors)` per research R4; `noEvents(selectors, rows)` lists the selectors that matched no row.
- [x] T022 [US1] Create `packages/schema/src/logbook/expand.ts` with the reference decoder `expandLogbook(document)`: rebuilds each row from the `events` buckets (date, hour key, `MM:SS`), the entity table, the cause table (re-adding the `context_` prefix), the string table, `{ "v": n }` literals, and `decodeContextId`; returns rows with `when` as whole seconds since the epoch, in document order. Export it from `packages/schema/src/index.ts` (depends on T005).
- [x] T023 [US1] Create `packages/mcp/src/logbook/encode-standard.ts`: `encodeStandard(rows, context)` produces the `LogbookStandardDocument` (data-model §3), where `context` carries `haVersion`, `timeZone`, the resolved window, `selectors`, and `no_events`. Apply, in this order: projection P1 and P2 (`projectLogbook`); entity table in order of first appearance (a bare string when the entity has no constants and no columns); constants for entities with two or more rows and columns sorted by key (data-model §3.3); the cause table (fields `context_*` with the prefix removed, in the key order of first occurrence, `null` cause when a row has none); the string table (strings of at least four characters occurring at least twice across `state`, constants, column values, and cause values, never `context_id` values, sorted by descending count then code point; integers are references and literal numbers are `{ "v": n }`); compact context IDs (`encodeContextId` with the start of the event's second); buckets by local date and hour using `localParts`, with `"HH:00"` keys or `"HH:00±HH:MM"` when the hour's offset differs from `utc_offset`; trailing `null` values dropped from rows. Envelope order per data-model §3.4; `first` and `last` from the earliest and latest row in local ISO seconds. Omit `strings`, `causes`, `selectors`, and `no_events` when empty (depends on T003, T004, T019).
- [x] T024 [US1] Create `packages/mcp/src/tools/ha-logbook-query.ts` with `runLogbookQuery(env, options)`: `readConfig` → `parseWindowInput` and `parseSelectors` → `HaClient.connect` → `readContext` (T009) → `resolveWindow` with `now` taken once at the start of the call → `strategy` → `fetchEvents` (exact IDs sent as `entity_ids`, otherwise not) → select rows (`matches`, drop rows without an entity when selectors are present) → `measureRowsBytes` on the selected rows → `redactRows` with `token` and `LOGBOOK_EXEMPT_KEYS` → `encodeStandard` → `finalize` (T011). Selector validation and window syntax run before connecting, so a syntax error never opens a socket; the window order checks run before `logbook/get_events` is sent. Resolves with the minified document or throws `ToolError`. `options` carries `detail` (only `standard` until T036), `start`, `end`, `entities`, and `timeouts`. Always closes the client (depends on T006 to T011, T020 to T023).
- [x] T025 [US1] Register the tool in `packages/mcp/src/server.ts`: `registerTool("ha_logbook_query", …)` with the title, description, and annotations of `specs/002-ha-logbook-query/contracts/ha_logbook_query.tool.json` (copied, with the same "Copied from" comment as `ha_snapshot`), and an input schema with `start`, `end`, and `entities` (zod: `string`, `string`, `array(string).min(1).max(100)`, all optional, descriptions from the contract). The `detail` property is added in T036. Domain failures return `isError: true` with `failure.toToolText("ha_logbook_query")`. Keep the `ha_snapshot` registration untouched (depends on T024).

**Checkpoint**: US1 works end to end for `standard`: `pnpm lint && pnpm typecheck && pnpm test` pass, and the 5x floor holds in CI. Not yet releasable: redaction of free text is US2.

---

## Phase 4: User Story 2 - Secrets never reach the agent (Priority: P1)

**Goal**: No credential, coordinate, or e-mail address reaches the output, including inside logbook messages and state values.

**Independent Test**: Run the redaction fixture through the tool and search the output for any six-character fragment of every planted value.

### Tests for User Story 2 (write first; they must fail)

- [x] T026 [P] [US2] Create `packages/mcp/test/fixtures/logbook-redaction.json`, hand-written like `redaction.json`, with a `config` (time zone, `latitude: 41.385064`, `longitude: 2.173404`, components including `logbook`), the rows, `expected_absent` (high-entropy planted values), and `expected_present` (identifiers that must survive). Plant: a token in a `message`; a token in a URL query (`?token=…`) inside a `message`; a JWT and a `Bearer` value in `context_message`; a password in URL user info inside a `source`; a credential-named key (`access_token`) in an extra key; an e-mail address in `name` and in `message`; a coordinate pair written as text (`41.3851, 2.1734`) in a `message`; the configured latitude and longitude as `41.385064` and `2.173404` inside a `message`; and `latitude` and `longitude` keys. Keep: an `entity_id` and a `context_entity_id` that look like secrets (`sensor.a1b2c3d4e5f6g7h8`), a `context_user_id`, and a `context_id`. Use fixture strings that cannot be mistaken for real credentials.
- [x] T027 [P] [US2] Create `packages/mcp/test/logbook-redaction.test.ts`: the oracle of `redaction-oracle.test.ts` (no contiguous fragment of six or more characters of any `expected_absent` value in the output) at `detail=standard` through the tool and the fake instance; every `expected_present` identifier is still in the output; `"[redacted]"` appears and the redacted fields are still present (FR-012); unit cases for `redactRows` with the logbook exempt keys. The `summary` case is added in T037.
- [x] T028 [P] [US2] Extend `packages/mcp/test/redact.test.ts` with cases for rules C2 and C3 (data-model §7): a pair `41.3851, 2.1734` and `41.3851 2.1734` in a string is redacted; two numbers whose first is outside ±90 or whose second is outside ±180 are not; numbers with fewer than three decimals (`21.5, 22.0`) are not; the configured latitude and longitude are redacted anywhere in a string when written with at least three decimals, and a configured value with fewer decimals is skipped (it would match unrelated numbers). Add one assertion to the existing snapshot redaction oracle that `ha_snapshot` output has no fragment of the configured coordinates in its string values.

### Implementation for User Story 2

- [x] T029 [US2] Add rules C2 and C3 to `packages/mcp/src/snapshot/redact.ts` (data-model §7) as string rules applied with V1 to V6, and wire `options.coordinates = { latitude, longitude }` (T010) so that C3 matches the instance's own values, given as decimal strings. Pass `latitude` and `longitude` from `get_config` in `packages/mcp/src/tools/ha-snapshot.ts` too, since the rules apply to both tools (`records.config` already holds them). Run the whole suite: any `ha_snapshot` fixture output that changes for data other than planted coordinates must be inspected and either justified in the changeset (T041) or fixed by tightening the rule.
- [x] T030 [US2] In `packages/mcp/src/tools/ha-logbook-query.ts`, pass `coordinates` from `readContext` (`latitude`, `longitude`) to `redactRows`, so C3 applies. Confirm T027 passes, and that the raw size is measured before redaction and the unredacted rows are never part of the output (FR-015).

**Checkpoint**: US1 and US2 together are the MVP and the first releasable state.

---

## Phase 5: User Story 3 - Loud, actionable failure (Priority: P2)

**Goal**: Every failure names its cause and a next step, and no failure returns events.

**Independent Test**: Trigger each failure against the fake instance and check the error kind, the text, and the absence of events and token.

### Tests for User Story 3 (write first; they must fail)

- [x] T031 [P] [US3] Create `packages/mcp/test/logbook-errors.test.ts`, through the tool and the MCP server: each shared kind returns its kind and guidance with the `ha_logbook_query failed [<kind>]:` prefix, with the same cause and next-step text as `ha_snapshot` (`config_missing` for each variable, `config_invalid`, `unreachable`, `timeout` at connect and during `logbook/get_events` with the shorter-window next step, `version_unsupported`, `auth_invalid`, `not_admin`, `retrieval_failed` when `logbook/get_events` fails, `protocol_error` for a malformed reply); `window_invalid` for an unparseable timestamp without opening a socket (`fake.received` empty), and for end before start and start in the future without sending `logbook/get_events` (`fake.received` has no such entry); `selector_invalid`; `history_unavailable` both when `components` lacks `logbook` and when `get_events` is `unknown_command`; `too_large` with the event count, the emitted size, and the limit in the text, with the default limit and with `DOMUSOPS_LOGBOOK_MAX_BYTES=1000`; `config_invalid` naming `DOMUSOPS_LOGBOOK_MAX_BYTES` for `zero`, `-5`, `1.5`, and `0`; a limit set by the user is the one reported; the limit cannot be passed as a tool argument (the input schema has no such property). For every error: `isError: true`, no event data, and the token never appears in the text (SC-005).

### Implementation for User Story 3

- [x] T032 [US3] In `packages/mcp/src/tools/ha-logbook-query.ts`, read the limit with `readLogbookLimit` at the start of the call (so a bad value fails before connecting), and after `finalize` compare the UTF-8 length of the standard document with it: above it, throw `errors.tooLarge(events, bytes, limit)` and return no rows. `events` is the count of selected rows. The check applies to `standard` only (depends on T007).
- [x] T033 [US3] Confirm in `packages/mcp/src/ha/logbook.ts` and `packages/mcp/src/ha/client.ts` that every failure path of T031 produces its kind and does not leak rows: a drop or a failure after `get_config` succeeded gives only the error (FR-017). Fix whatever T031 shows.

**Checkpoint**: All failure conditions of FR-014, FR-015, and FR-019 are covered.

---

## Phase 6: User Story 4 - Size up the window first (Priority: P2)

**Goal**: `detail=summary` gives counts and topology cheaply, and tells the agent how to narrow a `standard` query.

**Independent Test**: Invoke the tool with each `detail` value and with an invalid one, and check the shapes.

### Tests for User Story 4 (write first; they must fail)

- [x] T034 [P] [US4] Create `packages/mcp/test/logbook-encode-summary.test.ts`: on the reference fixture, `counts.events` equals the row count and `counts.no_entity_events` the rows without an entity; `by_domain` sums to the events with an entity; `by_entity` gives the right count, first, and last local time per entity, sorted by descending count then ID; `by_cause` counts match the cause table of the `standard` encoding; no per-event listing (no `events` key, no row arrays); determinism; the empty fixture gives zero counts and empty objects; a summary of a busy window is smaller than its `standard` document.
- [x] T035 [P] [US4] Add to `packages/mcp/test/logbook-tool.test.ts`: `detail` omitted equals `standard`; an invalid `detail` value is rejected with a message listing `summary` and `standard` and no events (pin how SDK 1.30.1 reports it, as T043 of feature 001 does for `ha_snapshot`); `summary` of a window whose `standard` exceeds the limit succeeds (the limit does not apply to it); selectors and the window apply to `summary` too.

### Implementation for User Story 4

- [x] T036 [US4] Create `packages/mcp/src/logbook/encode-summary.ts` (`LogbookSummaryDocument`, data-model §4), add the `summary` branch to `packages/mcp/src/tools/ha-logbook-query.ts` (same retrieval, selection, and redaction; no limit check), and add the `detail` property to the input schema in `packages/mcp/src/server.ts`: `z.enum(LOGBOOK_DETAIL_LEVELS).default("standard").describe(…)` with the description of the contract. Update `runLogbookQuery`'s `options.detail` type.
- [x] T037 [US4] Add the `summary` case to the oracle in `packages/mcp/test/logbook-redaction.test.ts`, and add a test in `packages/mcp/test/logbook-tool.test.ts` that the advertised `ha_logbook_query` definition (`tools/list` through the MCP server) matches `specs/002-ha-logbook-query/contracts/ha_logbook_query.tool.json`: name, title, description, the input schema's property names, types, and defaults, and the annotations. This guards the copy in `server.ts` against drift.

**Checkpoint**: Every acceptance scenario of the four stories passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Format publication, documentation, the two-tool server, and live verification

- [ ] T038 [P] Update `packages/mcp/test/cli.test.ts`: the server now advertises exactly `["ha_snapshot", "ha_logbook_query"]`, and both keep their annotations. Update the expectation in `specs/001-ha-snapshot/quickstart.md` scenario 2 ("lists exactly one tool") and `specs/001-ha-snapshot/contracts/ha_snapshot.md` ("Tools advertised") to name both tools, with a one-line pointer to feature 002. In `specs/001-ha-snapshot/data-model.md` §8, add rows C2 and C3 to the rule table with a pointer to `specs/002-ha-logbook-query/data-model.md` §7, and extend the sentence "V1 to V6 apply to every string value" to "V1 to V6, C2, and C3".
- [ ] T039 [P] Create `packages/schema/src/logbook/json-schema.ts`: `logbookJsonSchema` (draft-07) for the two documents (FR-020), tight enough to distinguish the row arrays from bare entity strings, the `{ "v": n }` literal, and the hour-keyed buckets (learn from the `groups` fix of feature 001). Export it from `packages/schema/src/index.ts`. Create `packages/mcp/test/logbook-json-schema.test.ts`, following `packages/mcp/test/json-schema.test.ts`: it accepts the `standard` and `summary` documents of the reference, performance, and empty fixtures, and rejects a document with a wrong `format`, a missing `time_zone`, and a `standard` event row that is not an array.
- [ ] T040 [P] Update `packages/mcp/README.md` with a `ha_logbook_query` section in the style of `ha_snapshot`: what it returns, the input (`start`, `end`, `entities` with patterns, `detail`), `DOMUSOPS_LOGBOOK_MAX_BYTES` and the `too_large` behaviour, the limits of the logbook (continuous sensors, retention, YAML exclusions for patterns; contract "Limits of the logbook"), the format id `domusops.logbook/0.1` and a link to its schema, and that redaction covers credentials, coordinates, and e-mail addresses but not hardware identifiers such as MAC addresses. No supported-version list (constitution §8).
- [ ] T041 [P] Add changesets in `.changeset/`: `ha-logbook-query-schema.md` (`"@domusops/schema": minor`, the `domusops.logbook/0.1` format, its decoder, and its JSON Schema) and `ha-logbook-query-mcp.md` (`"@domusops/mcp": minor`, the new tool and `DOMUSOPS_LOGBOOK_MAX_BYTES`). The `@domusops/mcp` entry also states that `ha_snapshot` now redacts coordinates written as text and the instance's own coordinates wherever they appear (rules C2 and C3), so its output can contain more `[redacted]` markers, and that the error class was renamed internally with no change to `ha_snapshot` texts.
- [ ] T042 [P] Update the "Current focus" section of `CLAUDE.md`: `ha_snapshot` is done; the current feature is `ha_logbook_query` (`specs/002-ha-logbook-query/`), backlog item 1 of `docs/SEED.md` §6; nothing else lands until it works end to end.
- [ ] T043 Run the full `pnpm lint && pnpm typecheck && pnpm test` and fix anything left. Confirm the 5x floor test, the redaction oracles at both detail levels, and all 95 tests of feature 001 (unchanged in behaviour).
- [ ] T044 Live verification (SC-007): run `quickstart.md` scenarios 2 to 4 with the maintainer's instance and an administrator token, and for scenario 4 a token of a non-administrator user. Record in the pull request description only: `ha_version`, the event count of the 24-hour window, the `standard` ratio of the 24-hour and the single-automation queries, and their wall-clock times. Never paste response content. A 24-hour ratio below 5 blocks release (research R7).
- [ ] T045 Open the pull request from `002-ha-logbook-query`, title `feat: add the ha_logbook_query tool`, with a summary of the design decisions of plan.md "Decisions to confirm at review" and the results of T044. Wait for CI (`verify` and the sandbox matrix) to pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)** and **US2 (Phase 4)**: after Foundational. US2's tests (T026, T027, T028) can be written in parallel with US1 tests; T030 needs T024.
- **US3 (Phase 5)**: after US1 (needs the tool pipeline).
- **US4 (Phase 6)**: after US1.
- **Polish (Phase 7)**: after the stories it documents.

### Within Foundational

- T003 and T004 have no dependencies; T005 needs T002 to T004.
- T006 first among the `mcp` changes (T007 to T011 use `ToolError`); then T007, T008, T010, and T011 in parallel; T009 needs T006 and T008.
- T012 and T013 are independent of the source changes; T013 needs T012's types.

### Within a Story

- Tests are written first and must fail. Then pure modules (`local-time`, `window`, `selectors`, the decoder), then the encoder, then the tool pipeline, then the server registration.

### Parallel Opportunities

- Foundational: T002, T003, T004, T007, T010, T011, T012 together after T006.
- US1 tests: T014, T015, T016, T017, T018 together. US1 modules: T019, T020 (after T019), T021, and T022 together.
- US2: T026, T027, T028 together.
- Polish: T038 to T042 together.

```bash
# US1 tests, together:
Task: "window resolution in packages/mcp/test/logbook-window.test.ts"
Task: "selectors in packages/mcp/test/logbook-selectors.test.ts"
Task: "encoding invariants and floor in packages/mcp/test/logbook-encode.test.ts"
Task: "round trip in packages/mcp/test/logbook-roundtrip.test.ts"
Task: "tool happy path in packages/mcp/test/logbook-tool.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Phase 1 and Phase 2 (format, shared code, fixtures).
2. Phase 3: US1. `standard` works and meets the 5x floor on the reference fixture.
3. Phase 4: US2. Free-text redaction is in place. **Only now** is the branch releasable.
4. **Stop and validate**: `pnpm lint && pnpm typecheck && pnpm test`.

US2 is P1 and release-blocking: without it US1 can emit credentials, coordinates, or e-mail addresses from logbook messages, so the MVP is US1 + US2.

### Incremental Delivery

1. Setup + Foundational.
2. US1 + US2, the MVP; merge once green.
3. US3, actionable failures (the size limit is here, so before it lands a very large query is unbounded: do not publish the MVP alone).
4. US4, `summary` and the complete tool contract.
5. Polish: JSON Schema, README, changesets, live verification.

Constitution §9 limits feature branches to three days. If the scope does not fit, merge US1 to US3 first and deliver US4 on a short follow-up branch. Never merge the MVP without T032 (the size limit): it is what keeps a busy window from filling the agent's context.

---

## Notes

- Constitution §2: run `/speckit-analyze` on spec, plan, and tasks **before** `/speckit-implement`.
- Commit after each task or logical group. Every commit and artifact is in English (§1; the `guard-language` hook enforces it).
- Never hand-edit `pnpm-lock.yaml` (the `guard-scope` hook blocks it); this feature changes no dependency.
- Decisions carried from the plan (see plan.md, "Decisions to confirm at review"). Changing one changes the named tasks:
  - readable times at second precision (T023, T017);
  - the default size limit of 100,000 bytes (T007);
  - rules C2 and C3 also apply to `ha_snapshot` (T029, T041);
  - patterns follow the instance's YAML exclusions and exact IDs do not (T021, T040).
- The reference fixture is synthetic and more regular than a real instance. The live ratio (T044) is the counterweight (research R7).
