---
description: "Task list for the ha_trace feature"
---

# Tasks: ha_trace — Compressed Automation and Script Traces

**Input**: Design documents from `specs/003-ha-trace/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Requested. The spec's acceptance criteria require a round-trip test, a redaction oracle,
and a CI-asserted compression floor (FR-019). Within each story, write the tests first and confirm
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
[data-model.md](./data-model.md) and [research.md](./research.md). Code of features 001 and 002
is on this branch, which was cut from `002-ha-logbook-query`.

---

## Phase 1: Setup

**Purpose**: Commit the specification

- [x] T001 Commit `specs/003-ha-trace/` alone on the existing branch `003-ha-trace` as `docs: add ha-trace spec, plan, and tasks`, after the maintainer confirms. `main` is protected (constitution §9), so all work happens on this branch. No dependency or tooling changes are needed: the feature adds no package, no runtime dependency, and no test tool. The branch is cut from `002-ha-logbook-query` (PR #3, unmerged); its pull request targets that branch until #3 merges, and is then rebased onto `main` (plan, decision 6).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The format contract, the changes to shared code, and the test infrastructure that every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Format contract (`@domusops/schema`)

- [x] T002 [P] Create `packages/schema/src/trace/format.ts`:
  - `TRACE_FORMAT = "domusops.trace/0.1"` and `TRACE_DETAIL_LEVELS = ["summary", "standard"]` with `TraceDetailLevel`.
  - `TraceStepRecord`, `TraceShortRecord`, and `TraceExtendedRecord` (data-model §1): `run_id`, `domain` (`"automation" | "script"`), `item_id`, `state`, `script_execution` (`string | null`), `timestamp: { start: string; finish: string | null }`, `last_step`, optional `trigger`, `error`, and `not_triggered`; the extended record adds `trace` (path → `TraceStepRecord[]`), `config`, `blueprint_inputs`, and `context` (`id`, `parent_id`, `user_id`). A step record has `path`, `timestamp`, and optional `changed_variables`, `result`, `child_id` (`{ domain, item_id, run_id }`), `error`, and `template_errors`. Every record type has an index signature for unknown keys.
  - The envelope (data-model §2), all snake_case: `format`, `detail`, `ha_version`, `compression_ratio`, `time_zone`, `utc_offset` (`±HH:MM`), `selection` (`entities?`, `start?`, `end?`, `run?`, `context?`), `counts` (`items`, `runs`, `not_triggered`), and optional `no_runs` (`no_match`, `no_stored_runs`, `none_in_window`, `untraceable`, each present only when non-empty).
  - `TraceStandardDocument`: the envelope plus `strings?`, `values?`, `configs`, `ids?`, and `items` (item key → `{ this?, runs }`), with the run object of data-model §3.1 (`run`, `start`, optional `duration_ms`, `trigger`, `outcome` or the pair `state` and `script_execution`, `error`, `not_triggered`, `context`, `parent_context`, `user`, `config`, `blueprint_inputs`, `last_step`, `steps_order`, `extra`, and `steps`) and the step array of §3.3 documented on the types.
  - `TraceSummaryDocument`: the envelope plus `columns` (the fixed tuple of data-model §4) and `items` (item key → rows).
- [x] T003 [P] Create `packages/schema/src/trace/values.ts`, the value decoding of data-model §3.2, with `decodeValue(value, anchor, tables)` where `anchor` is `{ startMicros }` for a run's values and `null` for configurations and blueprint inputs (unanchored), and `tables` holds `strings` and `values`:
  - `"#<n>"` → `strings[n]`; `{ "$": n }` → `values[n]` decoded in the anchoring of the referencing position; `{ "v": x }` → `x` verbatim.
  - `"@<ms>"` (anchored only) → the canonical UTC `isoformat()` string of the run's start plus `<ms>` milliseconds, with `+00:00`, six fraction digits, and no fraction when the microsecond is zero. `"<offset>:<16 characters>"` (anchored only) → `decodeContextId` from `packages/schema/src/logbook/ulid.ts` with the start of the run's second.
  - `{ "S": [e, s, a, lc, lu, lr, c] }`, `{ "D": [base, s, set, unset, lc, lu, lr, c] }`, and `{ "C": [id, parent_id, user_id] }` → the state object (`entity_id`, `state`, `attributes`, `last_changed`, `last_updated`, `last_reported`, `context`) and the context object; `lu` and `lr` equal to `0` mean "same as `last_changed`" and "same as `last_updated`". A delta needs its base (`"from"` or `"this"`), passed in by the caller.
  - Any other value is decoded element by element; object keys are never decoded.
- [x] T004 Update `packages/schema/src/index.ts` to re-export `trace/format.js` and `trace/values.js`. The `trace/expand.js` and `trace/json-schema.js` exports follow in T021 and T040 (depends on T002, T003).

### Shared code (`@domusops/mcp`)

- [x] T005 Extend `packages/mcp/src/errors.ts` (research R15):
  - Add the kinds `traces_unavailable`, `run_not_found`, and `selection_invalid` to `ERROR_KINDS`, with builders whose text follows data-model §8. `tracesUnavailable()` says traces come with the `automation` and `script` integrations (part of `default_config`) and to enable them. `runNotFound(what: "run" | "context")` says no stored trace matched, that the instance keeps only the most recent traces per item (`stored_traces`), that for a context the cause may not be an automation or script, and that `summary` lists what is stored. `selectionInvalid(problem)` states the problem and the accepted forms: `run` and `context` each exclude every other selection parameter; a run ID is 32 lowercase hexadecimal characters; a context ID is a 26-character ULID, a compact ID, or at most 64 printable ASCII characters.
  - Add `tooLargeRuns(runs, bytes, limit, detail)`: states the run count, the emitted size, the limit, and, for `standard`, "use `summary`, a run or context ID, fewer items, or a shorter window", for `summary`, "use fewer items or a shorter window", and in both cases that `DOMUSOPS_TRACE_MAX_BYTES` raises it. The existing `tooLarge` for logbook events is unchanged.
  - `window_invalid`, `selector_invalid`, and the shared kinds are reused as they are; `history_unavailable` is not used by this tool.
- [x] T006 [P] Extend `packages/mcp/src/ha/config.ts` with `TRACE_LIMIT_VARIABLE = "DOMUSOPS_TRACE_MAX_BYTES"`, `DEFAULT_TRACE_LIMIT = 100_000`, and `readTraceLimit(env): number`, built exactly like `readLogbookLimit` (unset or empty gives the default; anything but a string of digits that is a positive safe integer throws `errors.configInvalidValue` naming the variable). Add cases to the existing config tests for both variables, showing they are independent.
- [x] T007 [P] Extend `packages/mcp/src/ha/client.ts`:
  - Add `"trace/list"`, `"trace/get"`, and `"trace/contexts"` to `ALLOWED_COMMANDS`. No `trace/debug/*` and no `trace/subscribe_breakpoints` (spec FR-017).
  - Generalise the parameter check: each command that takes parameters has its own closed key set: `logbook/get_events` as before; `trace/list` exactly `domain` (`"automation" | "script"`); `trace/get` exactly `domain`, `item_id`, and `run_id` (all strings); `trace/contexts` none. Any other command or key, or a missing key, is rejected with `errors.protocolError` before it reaches the socket. The parameter type becomes a discriminated union so a caller cannot pair a command with another command's keys.
  - Trace commands keep the per-command budget (`commandMs`); only `logbook/get_events` uses the remaining overall deadline.
  - Add cases to `packages/mcp/test/client.test.ts`: each trace command accepted with its keys; params rejected on `get_config`, on `trace/contexts`, and on a trace command with a key of another command; a `trace/debug/breakpoint/set` command rejected as not allowed; several `trace/get` requests in flight at once each resolve with their own reply.
- [x] T008 [P] Extract the shared part of `readContext` in `packages/mcp/src/ha/logbook.ts` into `packages/mcp/src/ha/instance.ts`: `readInstance(client): Promise<Instance>` sends `auth/current_user` and requires `is_admin === true` (else `errors.notAdmin()`), then `get_config`, and returns `{ haVersion, timeZone, latitude, longitude, components }` with the same `protocolError` checks as today (missing or non-string `time_zone`, non-array `components`). `readContext` in `logbook.ts` calls it and keeps its `logbook` component check. `ha_logbook_query` behaviour and tests stay unchanged.
- [x] T009 Create `packages/mcp/src/ha/trace.ts` (the only new code that talks to Home Assistant for this tool):
  - `readTraceContext(client)`: `readInstance` (T008), then requires `"trace"` in `components`, else `errors.tracesUnavailable()`.
  - `readItems(client)`: `config/entity_registry/list` reduced to `{ entity_id, unique_id, platform }` for platforms `automation` and `script`, and `get_states` reduced to the `entity_id` of every `automation.*` state without an `id` attribute (research R3). Anything else is neither kept nor emitted.
  - `listTraces(client, domains)`: `trace/list` for each requested domain, results concatenated (short records). `readContexts(client)`: `trace/contexts`. An `unknown_command` failure of any trace command becomes `errors.tracesUnavailable()`; any other failure stays `retrieval_failed`.
  - `getTraces(client, refs)`: `trace/get` for each `{ domain, item_id, run_id }`, at most 8 in flight (research R4), results in the order of `refs`. A `not_found` reply for a trace that `trace/list` had just returned (evicted while reading) fails the whole call with `errors.retrievalFailed("trace/get", "a stored trace was replaced while it was being read")`, so no subset is returned (spec FR-018).
  - Every result is validated, never trusted: a short record needs a string `run_id`, `domain`, and `item_id`, an object `timestamp` with a string `start`, and a `state`; an extended record also needs an object `trace` and an object `context` with a string `id`. Anything else is `errors.protocolError`.
- [x] T010 [P] Extend `packages/mcp/src/snapshot/redact.ts` with `TRACE_EXEMPT_KEYS`: the union of the snapshot `EXEMPT_KEYS` set (export and reuse it, do not copy it; it covers `entity_id`, `device_id`, `area_id`, `config_entry_id`, `entry_id`, and the other identifier keys) and `run_id`, `item_id`, `domain`, `id`, `parent_id`, `user_id`, `path`, `last_step` (data-model §7, research R11, spec FR-015). `redactRows` is used as it is; the rules do not change. Add a case in `packages/mcp/test/redact.test.ts`: a 32-hex `run_id`, a 32-hex `device_id` in a device trigger, a 32-hex `config_entry_id` in action data, a `parent_id`, and a `path` such as `action/1/choose/0` survive, while a value under a credential-named key (`token`) and a token in a URL query inside `text` are still redacted.

### Test infrastructure

- [x] T011 [P] Create `packages/mcp/test/fixtures/generate-traces.ts`, a seeded generator like `generate-logbook.ts`, exporting `REFERENCE_TRACES` (20 items, 5 runs each, of which about 14 automations and 6 scripts; `time_zone` `Europe/Madrid`; window end fixed), `PERFORMANCE_TRACES` (100 items, 500 runs), `TRACES_EMPTY`, and `EDGE_TRACES` (hand-shaped cases below). Calibrate to research R5 and R16: per-item configurations of realistic size (32% of the raw bytes, one distinct configuration per item shared by its runs); `this` and `trigger` variables with full state objects (`entity_id`, `state`, `attributes`, three timestamps, `context`) on the first step; `choose` and `repeat` paths (`action/1/choose/0/conditions/0`); service-call results with `params`; free text such as notification and prompt messages at about 10% of the steps; ISO timestamps in canonical `isoformat()` form; 26-character ULID contexts, with about a third of the runs sharing their parent's context; scripts started by automations, with the step's `child_id` naming a stored script run, and about a fifth naming one that was evicted; a median of 6 steps per run (1 to 89) and about 4.3 KB per run raw. The edge set has: a not-triggered trace (`not_triggered: true`, `script_execution: "not_triggered"`), a running trace (`state: "running"`, null finish and `script_execution`), an `error` outcome with step `error` and `template_errors`, a `failed_conditions` run, a trace of a removed item (no registry entry), an automation without an `id` (in the states list only), an item with no stored runs, a blueprint automation with `blueprint_inputs`, a `repeat` run with the same path many times, and a run with equal step timestamps. For every run, also emit the logbook rows it produced (in the `LogbookRow` form of feature 002: an `automation triggered` or `script started` row and one state change per action, each with `context_id` equal to the run's context ID), exported as `REFERENCE_TRACE_LOGBOOK`, so SC-007 can be tested against real causes. Also export the matching `records.config` (`time_zone`, `components` including `trace`, `latitude`, `longitude`), the registry entries, and the states. Add a test in `packages/mcp/test/trace-encode.test.ts` (T015) that the reference set's `standard` ratio is within 3.1 to 3.6 (calibration guard); adjust the generator, not the range.
- [x] T012 Extend `packages/mcp/test/support/fake-ha.ts` and the `Fixture` type in `packages/mcp/test/fixtures/generate.ts`:
  - `Fixture` gains an optional `traces?: TraceExtendedRecord[]` (extended records; the short records and the context map are derived from them), plus the registry and states the fixtures of T011 provide.
  - The fake serves `trace/list` (`domain`; short records), `trace/contexts` (context ID → one `{ run_id, domain, item_id }`, later traces overwriting earlier ones with the same context, as Home Assistant does), and `trace/get` (`domain`, `item_id`, `run_id`; the extended record, or an error with code `not_found` and the message `The trace could not be found`).
  - `FakeHaOptions.traces: false` makes the fake answer `unknown_command` to the three commands; `FakeHaOptions.traceNotAdmin: true` makes them fail with code `unauthorized`; `FakeHaOptions.evictOnGet: string` (a run ID) makes `trace/get` for that run answer `not_found` after `trace/list` returned it.
  - The fake records the parameters of every trace command in `receivedTraceParams`. `received` and `authReceived` keep their meaning.

**Checkpoint**: Foundation ready. `pnpm lint && pnpm typecheck && pnpm test` pass, with the same tests as before plus T006, T007, and T010's cases.

---

## Phase 3: User Story 1 - Why did this automation do that (Priority: P1) 🎯 MVP

**Goal**: One call returns the stored runs of an automation or script, step by step, losslessly, in a compact form (at least 3x on the reference set), and a run or context ID from either tool leads straight to its run.

**Independent Test**: Run the tool against the reference fixture through the fake instance for one item, a run ID, and a context ID. Every stored run and every step appears in order with its result, and `compression_ratio` is at least 3.

### Tests for User Story 1 (write first; they must fail)

- [x] T013 [P] [US1] Create `packages/mcp/test/trace-values.test.ts` for the encoder of T022 and the decoder of T003 (data-model §3.2): a canonical timestamp encodes to `"@<ms>"` and decodes to exactly the same string, for six-digit fractions, no fraction, and negative offsets; a timestamp that is not canonical (`Z` suffix, seven digits, a date without time) stays a literal; a ULID context encodes to `"<offset>:<16 characters>"` anchored to the run's second and decodes back; a non-ULID ID stays verbatim; neither form is produced in a configuration or in blueprint inputs; literals that would be misread (`"#3"`, `"@5"`, a string shaped like a compact ID, `{ "$": 1 }`, `{ "S": 1 }`, `{ "v": 1 }`) are emitted as `{ "v": ... }` and decode to themselves; a state object encodes to `{ "S": [...] }` with `lu` and `lr` equal to `0` when equal to the previous timestamp; a state object with an extra key, a numeric `state`, or a missing `context` stays a plain object; a delta against a `from_state` and against a `this` template applies the attribute `set` and `unset` and round-trips; tables: a string of at least 6 characters occurring at least twice goes to `strings`, sorted by descending count then code point, and one occurring once does not; a subtree serialising to at least 16 bytes and occurring at least twice goes to `values`, children before parents, and no entry references a higher index.
- [x] T014 [P] [US1] Create `packages/mcp/test/trace-select.test.ts` for the modules of T018 to T020 (research R3, R4, R8, R14): item resolution maps `unique_id` to entity ID per platform, a trace with no registry entry is keyed `<domain>:<item_id>`, and an automation without an `id` is untraceable; selectors (`automation.*`, `script.night_*`, an exact ID, duplicates, overlapping patterns) select each item once and match entity IDs only, never `<domain>:<item_id>` keys; `run` selects exactly one trace, `context` selects every trace whose context has the same last 16 characters, for the full ULID, the compact form of either tool, and a non-ULID ID matched exactly; a context shared by an automation run and a script run returns both; `run` combined with `context`, `entities`, `start`, or `end`, a malformed run ID (uppercase, 31 characters, non-hex), and a malformed context ID (control characters, more than 64 characters) each throw `selection_invalid`; a run or context ID matching nothing throws `run_not_found`. The window cases are added in T035.
- [x] T015 [P] [US1] Create `packages/mcp/test/trace-encode.test.ts`: on the reference set, `compression_ratio >= 3` (FR-019, SC-001) and the calibration guard of T011; determinism (encoding twice gives identical strings); every reference resolves (`#n` in range, `{ "$": n }` to a lower index, `config` in range, `ids` for every entity-ID item whose item ID differs from the object part, delta bases present); items ordered by the start of their newest run, newest first, then by key, and runs by start, newest first, then by run ID; steps in time order with recorded-order ties, and the decoder regroups paths in order of first appearance; a trace whose step timestamps decrease is emitted in recorded order with `steps_order: "recorded"` and still round-trips (research R7); `last_step` is emitted only when it differs from the last path of the map; an unknown key on the extended record goes to `extra` and an unknown key on a step makes it an object `{ "step": ... }`; a running run has no `duration_ms` and `outcome: "running"`; a run with an unusual `state` and `script_execution` pair emits both instead of `outcome`; the empty set yields a valid document with empty `items` and counts of zero.
- [x] T016 [P] [US1] Create `packages/mcp/test/trace-roundtrip.test.ts` and `packages/schema/test/trace-expand.test.ts`: `expandTrace(encodeStandard(...))` deep-equals the extended records (object key order ignored) for the reference, performance, empty, and edge sets, for hand-built records covering every case of data-model §3 (a string-table reference, a `values` reference, a state object, a state delta against `from_state` and against `this`, a context object, a literal that needed the `v` escape, a step with `child_id`, `error`, and `template_errors`, a step with no optional part, an equal-timestamp pair, a repeated path, a removed item, and a blueprint run). The schema-package test uses hand-written documents, so it does not depend on the encoder.
- [x] T017 [P] [US1] Create `packages/mcp/test/trace-tool.test.ts` for the happy path through `runTrace` (T024) and the fake instance: one automation's runs, newest first; a script's runs in the same form (scenario 8); a run ID returns exactly that run (scenario 6); a context ID taken from a row of `REFERENCE_TRACE_LOGBOOK`, in the compact form `ha_logbook_query` emits for it (encoded with the 002 encoder) returns the run, and the automation run plus the script runs it started when they share a context (scenario 7); the step that started a script names it with `[item, run_id]`, including one whose script run was evicted (scenario 9); for every fixture run, its `context` has the same last 16 characters as the cause of the logbook events it produced (SC-007); a not-triggered trace is returned with outcome `not_triggered`, counted in `counts.not_triggered` and not in `counts.runs` (scenario 10); a running run is returned with the steps recorded so far (FR-018); a stopped-early run states its outcome, `last_step`, and the recorded reason (scenario 3); the configuration is in `configs` and each run references it, and runs of one item share one entry (scenario 4); with `entities`, `trace/list` is sent for the matching domains only and no `trace/get` for other items; `received` contains only allowlisted commands and `receivedTraceParams` only the permitted keys, for every parameter combination, and never a `trace/debug/*` command (SC-006); for each selection mode (none, selectors, run, context) and both detail levels, the envelope carries `time_zone`, `utc_offset`, `selection` with exactly the given parameters (resolved), and `counts`, and every run `start` parses as a local time in `time_zone` (FR-012); `standard` of one item of the performance set completes in under 5 s (SC-004, first half). Run the performance case with `DOMUSOPS_TRACE_MAX_BYTES=10000000`.

### Implementation for User Story 1

- [x] T018 [P] [US1] Create `packages/mcp/src/trace/context-id.ts` (research R8, R14): `parseRunId(value)` accepts exactly 32 lowercase hexadecimal characters; `parseContextId(value)` accepts a 26-character ULID, a compact ID (`^-?\d+:[0-9A-HJKMNP-TV-Z]{16}$`), or a string of at most 64 printable ASCII characters, else `errors.selectionInvalid`; `contextKey(id)` returns the last 16 characters for a ULID or compact ID and the whole string otherwise; `sameContext(a, b)` compares keys, and never treats a ULID key as equal to a non-ULID string. `contextTimeMs(id)` returns the millisecond timestamp of a ULID, or `null` for any other ID (used in T020).
- [x] T019 [P] [US1] Create `packages/mcp/src/trace/items.ts` (research R3): `resolveItems(registry, states, listed)` maps each stored trace to its item key (entity ID through the registry `unique_id` of its platform, else `<domain>:<item_id>`), and returns the known items: registry entries of both platforms, untraceable automations (an `automation.*` state without an `id`), and the keys of traces with no registry entry. It also returns the `ids` map for the document (entity ID → item ID, only where the item ID differs from the entity ID's object part). Pure, no I/O.
- [x] T020 [US1] Create `packages/mcp/src/trace/select.ts` (research R4, R14): `selectTraces(request, items, short, contexts, get)` for the modes without a window: no selector (every stored trace), selectors (`parseSelectors` and `matches` from `packages/mcp/src/logbook/selectors.ts`, matched against entity-ID item keys only), `run` (the short record with that `run_id`, else `run_not_found`), and `context` (research R4: if `trace/contexts` has no entry with that context key, `run_not_found`; otherwise the candidates are the short records whose start is not before the context's creation time from `contextTimeMs`, or every record when it is `null`, each fetched with `trace/get` and kept when its `context.id` has the same context key). Rejects the combinations of T014 with `errors.selectionInvalid` before any connection is opened. Returns the selected short records in the order of `trace/list` (depends on T018, T019).
- [x] T021 [US1] Create `packages/schema/src/trace/expand.ts` with the reference decoder `expandTrace(document)`: rebuilds each run's extended record from `items`, `ids`, `configs`, `strings`, and `values`: `domain` and `item_id` from the item key and `ids`, `timestamp` from `start` and `duration_ms` (with the exact fraction), `state` and `script_execution` from `outcome` (`running` → `state: "running"`, `script_execution: null`; any other outcome → `state: "stopped"` and that `script_execution`), the trace map by grouping steps by path in order of first appearance, `last_step` from the last path unless given, `context` from `context`, `parent_context`, and `user`, and each step's parts via `decodeValue` (T003). Returns the records in document order. Export it from `packages/schema/src/index.ts` (depends on T003, T004).
- [x] T022 [US1] Create `packages/mcp/src/trace/values.ts`, the encoder for data-model §3.2 (the inverse of T003), with the anchored and unanchored forms, the escapes (`{ "v": ... }`), the state object `S`, state delta `D` (bases `"from"` and `"this"`), and context object `C` forms, and the table builders: a string of at least 6 characters occurring at least twice in encodable positions (including step paths, excluding object keys and compact IDs) goes to `strings`, sorted by descending count then code point; an encoded array or object whose serialisation is at least 16 bytes and occurs at least twice goes to `values`, children before parents, in order of first occurrence, built after anchoring. Only canonical `isoformat()` timestamps are encoded; anything else stays a literal. Object keys are never encoded and keep their input order.
- [x] T023 [US1] Create `packages/mcp/src/trace/encode-standard.ts`: `encodeStandard(records, items, context)` produces the `TraceStandardDocument` (data-model §3) from redacted extended records, where `context` carries `haVersion`, `timeZone`, `utcOffset`, and the selection. Apply, in this order: sort steps by timestamp with ties by recorded order and regroup check (fall back to recorded order and `steps_order: "recorded"` when regrouping would not reproduce the recorded map); the item's `this` template (`entity_id` and the attribute pairs shared by every `this` state object of the item's runs, present only when at least one run carries one) and `D` deltas for `this`; `D` deltas of a trigger's `to_state` against its `from_state` when both have the same `entity_id`; positional steps `[path, t, result, variables, child, error, template_errors]` with trailing `0` omitted and `t` in milliseconds from the run's start with up to three decimals; `child` as `[item, run_id]`; `configs` in order of first use and each run's `config` index (null when the raw config is null); `outcome`, `duration_ms`, `parent_context`, `user`, `last_step`, and `extra` per data-model §3.1; local ISO `start` with six fraction digits exactly when the raw timestamp had them; `ids`; `counts`; then the tables of T022. Determinism per data-model §3.4: envelope in the order of §2, then `strings`, `values`, `configs`, `ids`, `items`; run fields in the order of §3.1 (depends on T002, T022; uses `packages/mcp/src/logbook/local-time.ts`).
- [x] T024 [US1] Create `packages/mcp/src/tools/ha-trace.ts` with `runTrace(env, options)`: `readConfig` → `parseSelectors` and `parseRunId` and `parseContextId` and the combination check (all before connecting, so a bad selection never opens a socket) → `HaClient.connect` → `readTraceContext` → `readItems` → `listTraces` for the domains a selector can match (both for no selector, `run`, or `context`) and `readContexts` when needed → `resolveItems` → `selectTraces` → `getTraces` for the selected records → `measureRowsBytes` on the extended records as retrieved → `redactRows` with `token`, `TRACE_EXEMPT_KEYS`, and the instance's `coordinates` → `encodeStandard` → `finalize`. Resolves with the minified document or throws `ToolError`. `options` carries `detail` (only `standard` until T037), `entities`, `run`, `context`, `timeouts`, and `now`. Always closes the client (depends on T005 to T010, T018 to T023).
- [x] T025 [US1] Register the tool in `packages/mcp/src/server.ts`: `registerTool("ha_trace", …)` with the title, description, and annotations of `specs/003-ha-trace/contracts/ha_trace.tool.json` (copied, with the same "Copied from" comment as the other tools), and an input schema with `entities` (`array(string).min(1).max(100)`), `run`, and `context` (`string`), all optional, descriptions from the contract. The `start`, `end`, and `detail` properties are added in T037. Domain failures return `isError: true` with `failure.toToolText("ha_trace")`. Keep the other two registrations untouched (depends on T024).

**Checkpoint**: US1 works end to end for `standard`: `pnpm lint && pnpm typecheck && pnpm test` pass, and the floor of 3 holds in CI. Not yet releasable: the redaction oracle of US2 is not written.

---

## Phase 4: User Story 2 - Secrets never reach the agent (Priority: P1)

**Goal**: No credential, coordinate, or e-mail address reaches the output, including inside variables, action data, error messages, configurations, and blueprint inputs.

**Independent Test**: Run the redaction fixture through the tool and search the output for any six-character fragment of every planted value.

### Tests for User Story 2 (write first; they must fail)

- [x] T026 [P] [US2] Create `packages/mcp/test/fixtures/trace-redaction.json`, hand-written like `logbook-redaction.json`, with a `config` (time zone, `latitude: 41.385064`, `longitude: 2.173404`, components including `trace`), the registry, the extended records, `expected_absent` (high-entropy planted values), and `expected_present` (identifiers that must survive). Plant: a token in an action's `params` data; a token in a URL query (`?token=…`) inside a `template_errors` string; a secret in the automation's `config` (an action URL with user info, and a key named `api_key`) and in `blueprint_inputs`; a JWT and a `Bearer` value in a variable; an e-mail address in an `error` and in a notification message; a coordinate pair as text (`41.3851, 2.1734`) in a message; the configured latitude and longitude as `41.385064` and `2.173404` in a variable; `latitude` and `longitude` attributes in a trigger's `to_state`; and a secret in `changed_variables.this.attributes`. Keep: an `entity_id` that looks like a secret (`sensor.a1b2c3d4e5f6g7h8`), a `run_id`, a context `id` and `parent_id`, a `user_id`, a `child_id.run_id`, a 32-hex `device_id` in a device trigger in `config`, and a 32-hex `device_id` in a step's `target`. Use fixture strings that cannot be mistaken for real credentials.
- [x] T027 [P] [US2] Create `packages/mcp/test/trace-redaction.test.ts`: the oracle of `logbook-redaction.test.ts` (no contiguous fragment of six or more characters of any `expected_absent` value in the output) at `detail=standard` through the tool and the fake instance; every `expected_present` identifier is still in the output; `"[redacted]"` appears and the redacted fields are still present (spec User Story 2, scenario 4); a secret in the configuration is absent from the `configs` table, from the `strings` table, and from `values`; the compression tables never hold a planted value. The `summary` case is added in T038.

### Implementation for User Story 2

- [x] T028 [US2] In `packages/mcp/src/tools/ha-trace.ts`, confirm T027 passes and fix what it shows: redaction runs on the extended records after `getTraces` and before every encoding step (so tables, deltas, and `ids` never see a secret), the raw size is measured before it, and the unredacted records are never part of the output (FR-014). Check the exemption set against the fixture: a secret under a non-exempt key next to an exempt one is still redacted, and `TRACE_EXEMPT_KEYS` is not widened to make a test pass.

**Checkpoint**: US1 and US2 together are the MVP and the first releasable state.

---

## Phase 5: User Story 3 - Loud, actionable failure (Priority: P2)

**Goal**: Every failure names its cause and a next step, no failure returns runs, and an absent trace, an untraceable automation, and a mistyped selector are told apart.

**Independent Test**: Trigger each failure against the fake instance and check the error kind, the text, and the absence of runs and token; then query an item with no runs, an untraceable automation, and a selector matching nothing.

### Tests for User Story 3 (write first; they must fail)

- [ ] T029 [P] [US3] Create `packages/mcp/test/trace-errors.test.ts`, through the tool and the MCP server: each shared kind returns its kind and guidance with the `ha_trace failed [<kind>]:` prefix, with the same cause and next-step text as the other tools (`config_missing` for each variable, `config_invalid`, `unreachable`, `timeout` at connect, `version_unsupported`, `auth_invalid`, `not_admin` (both the administrator check and the fake's `unauthorized`), `retrieval_failed` when a trace command fails and when `evictOnGet` replaces a run while it is read, `protocol_error` for a malformed record); `window_invalid` and `selector_invalid` without opening a socket; `selection_invalid` for each combination and each malformed ID of T014, without opening a socket; `run_not_found` for an unknown run ID and for a context with no stored run, with the texts of T005; `traces_unavailable` both when `components` lacks `trace` and when a trace command is `unknown_command`; `too_large` at both detail levels with the run count, the emitted size, and the limit in the text, with the default limit and with `DOMUSOPS_TRACE_MAX_BYTES=1000` (the `summary` case is added in T035); `config_invalid` naming `DOMUSOPS_TRACE_MAX_BYTES` for `zero`, `-5`, `1.5`, and `0`; setting `DOMUSOPS_LOGBOOK_MAX_BYTES` does not change the trace limit; the limit cannot be passed as a tool argument. For every error: `isError: true`, no run data, and the token never in the text (SC-005).
- [ ] T030 [P] [US3] Add to `packages/mcp/test/trace-tool.test.ts`: an item selected by a selector with no stored trace at all is listed in `no_runs.no_stored_runs`; an item whose stored traces all started outside the window is in `none_in_window`, not `no_stored_runs`; an automation without an `id` selected by an exact ID is in `untraceable`; a selector matching no known item is in `no_match`, in request order; the four lists are distinct and each is present only when non-empty; `counts` and `no_runs` for a mixed query (scenario 4 of User Story 3); an empty result (no stored traces at all, and a query selecting nothing) is a valid document with zero counts and a `compression_ratio` below 1, not an error (edge case).

### Implementation for User Story 3

- [ ] T031 [US3] In `packages/mcp/src/trace/items.ts` and `packages/mcp/src/trace/encode-standard.ts`, compute and emit `no_runs` (data-model §2): `no_match` lists selectors that matched no known item, in request order; `no_stored_runs` lists matched items with no stored trace at all; `none_in_window` lists matched items whose stored traces all started outside the window; `untraceable` lists matched automations without an `id`; the last three in code-point order; each key only when non-empty. With `run` or `context`, or without selectors, `no_runs` is absent.
- [ ] T032 [US3] In `packages/mcp/src/tools/ha-trace.ts`, read the limit with `readTraceLimit` at the start of the call (so a bad value fails before connecting), and after `finalize` compare the UTF-8 length of the emitted document with it: above it, throw `errors.tooLargeRuns(runs, bytes, limit, detail)` and return no runs. The check applies to `standard` here and to `summary` in T037 (depends on T006).
- [ ] T033 [US3] Confirm in `packages/mcp/src/ha/trace.ts` and `packages/mcp/src/ha/client.ts` that every failure path of T029 produces its kind and does not leak records: a drop or a failure after `trace/list` succeeded gives only the error (FR-018). Fix whatever T029 shows.

**Checkpoint**: All failure conditions of FR-004, FR-016, and FR-020 (at the `standard` level) are covered.

---

## Phase 6: User Story 4 - Find the right run first (Priority: P2)

**Goal**: `detail=summary` lists runs as one row each, a window narrows them, and the default is `standard`.

**Independent Test**: Invoke the tool with each `detail` value, with and without selection, with a window, and with an invalid value, and check the shapes.

### Tests for User Story 4 (write first; they must fail)

- [ ] T034 [P] [US4] Create `packages/mcp/test/trace-encode-summary.test.ts`: on the reference set, one row per selected trace with the `columns` of data-model §4; `start` is local `YYYY-MM-DD HH:MM:SS` with the offset appended only when it differs from `utc_offset`; `duration_ms` is an integer, null while running; `trigger` is null for scripts; `outcome` is `script_execution`, or `state` when that is null; `context` is compact and anchored to the second of `start`; `error` omitted when absent; a run whose context the context map does not cover (one of two runs sharing a context) still gets its own context from its extended record (research R4); rows in the orders of data-model §3.1; no steps, variables, or configuration anywhere in the output (FR-008); determinism; the empty set gives a valid document with empty `items`; a `summary` is smaller than the `standard` document of the same selection and its ratio is reported.
- [ ] T035 [P] [US4] Add to `packages/mcp/test/trace-tool.test.ts`, and window cases to `packages/mcp/test/trace-select.test.ts`: `detail` omitted equals `standard` (scenario 4); an invalid `detail` value is rejected with a message listing `summary` and `standard` and no runs (pin how SDK 1.30.1 reports it, as `logbook-tool.test.ts` does); `summary` without selectors covers every automation and script (scenario 2); a window keeps only runs that started inside it, inclusive of both ends, with the defaults of research R14 (only `start`: end is now; only `end`: start is 24 hours before; neither: no window, every stored trace), clamps a future `end` to now, resolves an offset-less time in the instance time zone, and rejects an unparseable time, `end` not after `start`, and `start` after now with `window_invalid` (scenario 3); the window does not apply with `run` or `context` (they reject it); `summary` above the limit fails with `too_large` (the `summary` wording of T005); a `summary` of 500 runs over 100 items completes in under 5 s (SC-004, second half).

### Implementation for User Story 4

- [ ] T036 [US4] Create `packages/mcp/src/trace/encode-summary.ts` (`TraceSummaryDocument`, data-model §4): rows built from the short records, with each run's context from `trace/contexts` when the map points to that run and from its extended record otherwise; the caller fetches those records (they are also the raw side of the ratio, data-model §6). Envelope, orders, and formats per data-model §2 and §4.
- [ ] T037 [US4] In `packages/mcp/src/trace/select.ts`, add the window: `parseWindowInput` and `resolveWindow` from `packages/mcp/src/logbook/window.ts` with the defaults of research R14 (applied when `start` or `end` is given, filtering on the start of each trace), rejected together with `run` or `context`. In `packages/mcp/src/tools/ha-trace.ts`, add the `summary` branch (same retrieval, selection, and redaction; `getTraces` only for the runs whose context the map does not cover; the limit check of T032 applies) and the `start` and `end` options; in `packages/mcp/src/server.ts`, add the `start`, `end`, and `detail` properties (`z.enum(TRACE_DETAIL_LEVELS).default("standard").describe(…)`) with the descriptions of the contract.
- [ ] T038 [US4] Add the `summary` case to the oracle in `packages/mcp/test/trace-redaction.test.ts`, and add a test in `packages/mcp/test/trace-tool.test.ts` that the advertised `ha_trace` definition (`tools/list` through the MCP server) matches `specs/003-ha-trace/contracts/ha_trace.tool.json`: name, title, description, the input schema's property names, types, and defaults, and the annotations. This guards the copy in `server.ts` against drift.

**Checkpoint**: Every acceptance scenario of the four stories passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Format publication, documentation, the three-tool server, and live verification

- [ ] T039 [P] Update `packages/mcp/test/cli.test.ts`: the server now advertises exactly `["ha_snapshot", "ha_logbook_query", "ha_trace"]`, and all keep their annotations. Update the sentence "the server advertises two tools" in `specs/002-ha-logbook-query/contracts/ha_logbook_query.md` and the expectation in `specs/002-ha-logbook-query/quickstart.md` scenario 2 to name three tools, with a one-line pointer to feature 003.
- [ ] T040 [P] Create `packages/schema/src/trace/json-schema.ts`: `traceJsonSchema` (draft-07) for the two documents (FR-021), tight enough to distinguish the step arrays from the `{ "step": ... }` fallback object, the `S`, `D`, `C`, and `v` forms, and the run object with `outcome` from the one with `state` and `script_execution`. Export it from `packages/schema/src/index.ts`. Create `packages/mcp/test/trace-json-schema.test.ts`, following `packages/mcp/test/logbook-json-schema.test.ts`: it accepts the `standard` and `summary` documents of the reference, performance, empty, and edge sets, and rejects a document with a wrong `format`, a missing `time_zone`, and a `standard` step that is not an array.
- [ ] T041 [P] Update `packages/mcp/README.md` with an `ha_trace` section in the style of the other two: what it returns, the input (`entities` with patterns, `start` and `end`, `run`, `context`, `detail`) and the combinations that are rejected, `DOMUSOPS_TRACE_MAX_BYTES` and the `too_large` behaviour at both levels, the limits (the instance keeps the last few traces per item, in memory; only automations with an `id` are traced; not-triggered traces from 2026.7), how a context ID from `ha_logbook_query` leads to a run and why two IDs match on their last 16 characters, the format id `domusops.trace/0.1` and a link to its schema, the floor of 3 and why (`standard` is lossless), and that redaction covers credentials, coordinates, and e-mail addresses, including in configurations, but not hardware identifiers such as MAC addresses. No supported-version list (constitution §8).
- [ ] T042 [P] Add changesets in `.changeset/`: `ha-trace-schema.md` (`"@domusops/schema": minor`, the `domusops.trace/0.1` format, its decoder, and its JSON Schema) and `ha-trace-mcp.md` (`"@domusops/mcp": minor`, the new tool and `DOMUSOPS_TRACE_MAX_BYTES`).
- [ ] T043 [P] Update the "Current focus" section of `CLAUDE.md`: `ha_logbook_query` is done (PR #3); the current feature is `ha_trace` (`specs/003-ha-trace/`), backlog item 1 of `docs/SEED.md` §6, second half; nothing else lands until it works end to end.
- [ ] T044 Run the full `pnpm lint && pnpm typecheck && pnpm test` and fix anything left. Confirm the floor test, the redaction oracles at both detail levels, the round trip, and all tests of features 001 and 002 (unchanged in behaviour).
- [ ] T045 Live verification (SC-008): run `quickstart.md` scenarios 2 to 4 with the maintainer's instance and an administrator token, and for scenario 4 a token of a non-administrator user. Record in the pull request description only: `ha_version`, the run count, the `standard` ratio of one item and of all runs (with `DOMUSOPS_TRACE_MAX_BYTES` raised), and their wall-clock times. Never paste response content. Compare with the calibration of research R5 and R6: a live ratio far below the fixture's means the fixture is miscalibrated; fix the generator.
- [ ] T046 Open the pull request from `003-ha-trace`, after the maintainer confirms, with base `002-ha-logbook-query` until PR #3 merges (then rebase onto `main`; if #3 is squashed, `git rebase --onto main <old base> 003-ha-trace`), title `feat: add the ha_trace tool`, with a summary of the design decisions of plan.md "Decisions to confirm at review" and the results of T045. Wait for CI (`verify` and the sandbox matrix) to pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)** and **US2 (Phase 4)**: after Foundational. US2's tests (T026, T027) can be written in parallel with US1 tests; T028 needs T024.
- **US3 (Phase 5)**: after US1 (needs the tool pipeline).
- **US4 (Phase 6)**: after US1; T037 also needs T032 (the shared limit check).
- **Polish (Phase 7)**: after the stories it documents.

### Within Foundational

- T002 and T003 have no dependencies; T004 needs both.
- T005 first among the `mcp` changes; then T006, T007, T008, and T010 in parallel; T009 needs T005, T007, and T008.
- T011 and T012 are independent of the source changes; T012 needs T011's types.

### Within a Story

- Tests are written first and must fail. Then pure modules (`context-id`, `items`, the decoder), then `select`, the value encoder, the standard encoder, the tool pipeline, then the server registration.

### Parallel Opportunities

- Foundational: T002, T003, T006, T007, T008, T010, T011 together after T005.
- US1 tests: T013 to T017 together. US1 modules: T018, T019, and T022 together; T021 after T003.
- US2: T026 and T027 together.
- US3: T029 and T030 together.
- US4: T034 and T035 together.
- Polish: T039 to T043 together.

```bash
# US1 tests, together:
Task: "value encoding in packages/mcp/test/trace-values.test.ts"
Task: "selection in packages/mcp/test/trace-select.test.ts"
Task: "encoding invariants and floor in packages/mcp/test/trace-encode.test.ts"
Task: "round trip in packages/mcp/test/trace-roundtrip.test.ts"
Task: "tool happy path in packages/mcp/test/trace-tool.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Phase 1 and Phase 2 (format, shared code, fixtures).
2. Phase 3: US1. `standard` works, is lossless, and meets the floor of 3 on the reference set.
3. Phase 4: US2. Redaction is proven at the oracle. **Only now** is the branch releasable.
4. **Stop and validate**: `pnpm lint && pnpm typecheck && pnpm test`.

US2 is P1 and release-blocking: traces carry configurations, action data, and full states, so US1 without its oracle can emit credentials, coordinates, or e-mail addresses.

### Incremental Delivery

1. Setup + Foundational.
2. US1 + US2, the MVP; merge once green.
3. US3, actionable failures. The size limit lands here (T032), so before it a very large query is unbounded: do not publish the MVP alone.
4. US4, `summary`, the window, and the complete tool contract.
5. Polish: JSON Schema, README, changesets, live verification.

Constitution §9 limits feature branches to three days. If the scope does not fit, merge US1 to US3 first and deliver US4 on a short follow-up branch. Never merge the MVP without T032: it is what keeps a busy instance from filling the agent's context.

---

## Notes

- Constitution §2: run `/speckit-analyze` on spec, plan, and tasks **before** `/speckit-implement`.
- Commit after each task or logical group, after the maintainer confirms. Every commit and artifact is in English (§1; the `guard-language` hook enforces it).
- Never hand-edit `pnpm-lock.yaml` (the `guard-scope` hook blocks it); this feature changes no dependency.
- Decisions carried from the plan (see plan.md, "Decisions to confirm at review"). Changing one changes the named tasks:
  - lossless `standard` with a floor of 3 (T011, T015, T023);
  - not-triggered traces included (T011, T017, T023);
  - context IDs matched on their last 16 characters (T018, T020);
  - the size limit at both levels, default 100,000 bytes (T006, T032, T037);
  - the branch base and the pull request target (T001, T046).
- The reference fixture is synthetic and more regular than a real instance. The live ratio (T045) is the counterweight (research R5, R6).
