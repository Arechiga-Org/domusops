---
description: "Task list for ha_system_log (feature 012, fourth and last tool of 0.2.0)"
---

# Tasks: ha_system_log

**Input**: Design documents from `/specs/012-ha-system-log/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R15), data-model.md, contracts/ (ha_system_log.tool.json, system-log-format.md), quickstart.md

**Tests**: Included. Tests are written first and seen to fail. Unit tests run in the default `pnpm test`; container tests run with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: User Stories 1 and 2 share every file (attribution, filters, encoding, limit) and User Story 3 is small, so the feature is one branch (`012-ha-system-log`) and one pull request (plan, Delivery). Spec, plan and tasks are committed first; the implementation follows in atomic commits.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 or US3, from spec.md
- All paths are relative to the repository root. Everything written to the repository is English (constitution §1), and no example, fixture or test contains data from a real home: no real log capture, traceback or path (FR-022).
- The last tasks are always the same: run the gate (`pnpm lint && pnpm typecheck && pnpm test`), Prettier on only the touched files (never `tasks.md`), and then ask the maintainer before any commit, push or pull request. The maintainer merges. `/code-review` runs after the pull request and its findings are triaged before anything is pushed.
- The feature adds a minor changeset for `@domusops/mcp` and one for `@domusops/schema` (FR-021). The Version Packages pull request (#36) is merged after this feature, releasing 0.2.0 (research R15).
- Existing helpers are reused as they are, not copied: `parseSelectors`, `matcher`, `exclusion`, `MAX_SELECTORS` and `MAX_SELECTOR_LENGTH` (`packages/mcp/src/logbook/selectors.ts`), `parseWindowInput` and `resolveWindow` (`packages/mcp/src/logbook/window.ts`), `localParts`, `formatOffset` and `formatLocalIso` (`packages/mcp/src/logbook/local-time.ts`), the string rules of `packages/mcp/src/snapshot/redact.ts`, `finalize` and `byteLength` (`packages/mcp/src/snapshot/ratio.ts`), `readCurrentUser` and `readCore` (`packages/mcp/src/ha/instance.ts`), the shared `readLimit` (`packages/mcp/src/ha/config.ts`), `put` (`packages/mcp/src/util/json.ts`), `exclusionNote` (`packages/mcp/src/notes.ts`), and `Rng` (`packages/mcp/test/fixtures/generate.ts`).
- Every error wording the existing tools use stays byte-identical; new wordings come from new subjects or new functions (FR-020, research R2, R4, R9).

---

## Phase 1: Setup

- [ ] T001 Run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` on the branch before any code and record that the baseline is green (constitution §2)

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the published format and its decoder, the new read, the limit, the errors, the notes, the selector kind, the path and redaction helpers, and the simulated log that every story uses.

- [ ] T002 [P] Create `packages/mcp/test/system-log-json-schema.test.ts`: `SYSTEM_LOG_FORMAT` is `domusops.system_log/0.1`; `systemLogJsonSchema` accepts the standard and summary examples of `specs/012-ha-system-log/contracts/system-log-format.md`; it rejects a document without `format`, a `detail` other than `summary` or `standard`, a `utc_offset` not of the form `±HH:MM`, a `level` other than `warning`, `error` or `critical`, a `standard` document without `files`, `parts` or `entries`, a part that is neither a string nor `[integer, integer, string]` or `[integer, integer, string, string]`, an entries date not `YYYY-MM-DD`, an entry whose time is not `HH:MM:SS` with an optional `±HH:MM`, an entry with fewer than seven or more than ten items, a `count` below 1, a `source` that is not `[integer, integer]`, a traceback item that is neither a non-negative integer nor a string, a last item other than `1`, a summary without `counts` or `by_integration`, a count pair that is not two non-negative integers, and a summary with `files`
- [ ] T003 In `packages/schema/src/system-log/format.ts`, add `SYSTEM_LOG_FORMAT`, `SYSTEM_LOG_DETAIL_LEVELS`, `SYSTEM_LOG_LEVELS` (`warning`, `error`, `critical`) and the types `SystemLogEnvelope`, `SystemLogStandardDocument`, `SystemLogPart`, `SystemLogFrame`, `SystemLogEntryRow`, `SystemLogSummaryDocument`, `SystemLogDocument` and `SystemLogRecord`, with the keys and order of data-model §2 to §5 (envelope: `format`, `detail`, `ha_version`, `compression_ratio`, `time_zone`, `utc_offset`, then optional `integrations`, `level`, `start`, `custom`); in `packages/schema/src/system-log/json-schema.ts`, add `systemLogJsonSchema`; export both modules from `packages/schema/src/index.ts` (R6, R10, R13). Make T002 pass
- [ ] T004 [P] Create `packages/schema/test/system-log-expand.test.ts` with hand-built documents: entries come in the document's order, dates and times rebuilt as local ISO 8601 with `utc_offset` or the entry's own offset; `first_occurred` equals `last_occurred` when position 7 is absent, takes the entry's date when it is `HH:MM:SS`, and is used as given when it is a full ISO time; `integration_from` is `logger`, `source` (position 9 is `1`) or `null`; `custom` is true only for a domain in `custom`; `source` resolves `files`; a traceback rebuilds the exact text from part indexes and strings joined by newlines, a frame as `  File "<file>", line <line>, in <function>` followed by its `code`, including a chained traceback, caret lines and a `<template>` frame; `null` when there is none; a summary document is refused with an error that names `detail=standard`; the decoded entries of `contracts/system-log-format.md`'s standard example match the values its text states
- [ ] T005 Create `packages/schema/src/system-log/expand.ts` with `expandSystemLog(document: SystemLogStandardDocument): SystemLogRecord[]` as data-model §5 and research R13; export it from the index. Make T004 pass. The existing `expand`, `expandLogbook`, `expandTrace`, `expandState` and `expandHistory` tests pass unedited
- [ ] T006 [P] In `packages/schema/README.md`, add the format's row to the Formats table (detail levels `summary` and `standard`; decoder `expandSystemLog` for `standard`) and `SYSTEM_LOG_FORMAT`, `SYSTEM_LOG_LEVELS`, the `SystemLog*` types, `systemLogJsonSchema` and `expandSystemLog` to the exports list
- [ ] T007 [P] In `packages/mcp/test/config.test.ts`, add cases for `DOMUSOPS_SYSTEM_LOG_MAX_BYTES`: absent gives 100000; a valid value is used; an invalid one is a `config_invalid` error naming the variable; then in `packages/mcp/src/ha/config.ts` add `SYSTEM_LOG_LIMIT_VARIABLE`, `DEFAULT_SYSTEM_LOG_LIMIT = 100_000` and `readSystemLogLimit` through the shared `readLimit` (R9)
- [ ] T008 [P] In `packages/mcp/src/errors.ts`, with cases in a new `packages/mcp/test/system-log-errors.test.ts`: rename the `notAdmin` subject `"entity_history"` to `"required"`, its wording byte-identical, and update `packages/mcp/src/tools/ha-history.ts` and its tests to the new name; add `systemLogUnavailable()` (kind `system_log_unavailable`, "The instance does not provide its system log", "Make sure the system_log integration is loaded (Home Assistant loads it at startup unless the configuration prevents it), then try again"); give `selectorInvalid` a subject, default `"entity"` (today's remediation, byte-identical), and `"integration"` with the remediation "Use an integration domain or a pattern made of lowercase letters, digits, underscores, and * (for example mqtt, hue*, or *_cloud)"; give `inputInvalid` the subject `"system_log"`, whose remediation is "Give level as warning, error, or critical"; add `tooLargeSystemLog(entries, bytes, limit, detail)` with the cause and the two remediations of R9 (R2, R4, R9). `packages/mcp/test/logbook-errors.test.ts`, `packages/mcp/test/trace-errors.test.ts`, `packages/mcp/test/history-errors.test.ts` and the `ha_state` error cases pass with no edited wording
- [ ] T009 [P] In `packages/mcp/test/logbook-selectors.test.ts`, add cases, then in `packages/mcp/src/logbook/selectors.ts` add the kind `"integration selector"` to `parseSelectors`, with the same limits and deduplication and the character set `[a-z0-9_*]` (a dot is refused), its errors through `selectorInvalid(…, "integration")`; the entity and exclusion kinds keep their character set and wordings (R4)
- [ ] T010 [P] In `packages/mcp/test/response-notes.test.ts`, add cases, then in `packages/mcp/src/notes.ts` add `emptyLogNote()` — "Note: the system log is empty." — and `noEntryMatchedNote()` — "Note: no log entry matched the query." (R15)
- [ ] T011 [P] In `packages/mcp/test/client.test.ts`, add cases, then in `packages/mcp/src/ha/client.ts` add `system_log/list` to `COMMANDS` with no parameter and the per-command time limit; the client refuses it with any parameter before it reaches the socket (R1)
- [ ] T012 [P] In `packages/mcp/src/ha/instance.ts`, read `config_dir` from `get_config` into the core config (a string, a protocol error otherwise), with a case in the existing instance tests; no other tool's output changes (R7)
- [ ] T013 [P] Create `packages/mcp/test/system-log-paths.test.ts`, then `packages/mcp/src/system-log/paths.ts`: `rootPaths(text, configDir)` replaces, in a path or in free text, the configuration directory followed by `/` with `{config}/`, a path up to and including its last `/homeassistant/` segment with `{ha}/`, and a path up to and including `/lib/python<major>.<minor>/` with `{python}/`, the first that applies; cases for the container image's paths, a virtual environment under a home directory (`/home/<user>/…/site-packages/homeassistant/…`, `…/lib/python3.13/site-packages/aiohttp/…`), a core install's configuration directory under a home directory, a path in a message, a relative source path and `<template>` left as they are, and an absolute path outside the three roots left as it is (R7, FR-009)
- [ ] T014 [P] In `packages/mcp/src/snapshot/redact.ts`, export a `redactText(text, { token, coordinates })` that applies the string rules (`redactString`) to one text, replacing only the matching text; with cases in a new `packages/mcp/test/system-log-redaction.test.ts` for the configured token, URL user info, a credential query parameter, a JWT, a bearer token, an e-mail address, a coordinate pair and the instance's own coordinates inside a message and inside a traceback line, and a file path, a line number and an IP address left as they are; `ha_snapshot`'s, `ha_state`'s and `ha_history`'s redaction tests pass unedited (R8)
- [ ] T015 [P] Create `packages/mcp/test/fixtures/generate-system-log.ts`: a deterministic generator of a raw `system_log/list` answer of 50 entries, newest first, calibrated to research R12 and R14 (coordinator and HTTP client failures sharing frames, platform setup errors, custom integration errors with tracebacks, a library logger whose source lies in a custom integration, repeated warnings with several messages, an entry with five messages, a chained traceback, a `<template>` frame, caret lines, an absolute source path, a `py.warnings` entry, an entry of `homeassistant.helpers.*` with no integration, critical, error and warning levels), every name generated from the seed, every path under the container image's three roots, with a header comment that states the calibration; export `REFERENCE_SYSTEM_LOG` and its `config_dir`. In `packages/mcp/test/support/fake-ha.ts`, add a `systemLog` option and answer `system_log/list` as research R1 records, `invalid_format` for any parameter, `unknown_command` when the option is `false`, and add `config_dir` to `get_config`
- [ ] T016 Create `packages/mcp/src/ha/system-log.ts`: `readSystemLog(client)` sends the command, maps `unknown_command` to `systemLogUnavailable()`, and validates the answer as an array of entries with a string `name`, a non-empty string array `message`, a `level` of `WARNING`, `ERROR` or `CRITICAL`, a `source` of a string and an integer, numeric `timestamp` and `first_occurred`, a string `exception` and an integer `count` ≥ 1, any other shape a protocol error and no entries (R1, R2)

**Checkpoint**: the format, its JSON Schema and its decoder are published in the workspace; the read, the limit, the errors, the notes, the selector kind, the paths, the text redaction and the simulated log exist.

---

## Phase 3: User Story 1 — Reading the errors of an integration (Priority: P1) 🎯 MVP

**Goal**: `ha_system_log` with `integrations` returns every selected entry with its level, logger, integration, source, count, first and last occurrence, messages and traceback, re-rooted, redacted, deterministic, from one read on one connection (spec FR-001 to FR-004, FR-007 to FR-009, FR-011, FR-013 to FR-016, FR-018).

**Independent Test**: `packages/mcp/test/system-log.test.ts`, `system-log-encode.test.ts`, `system-log-roundtrip.test.ts` and `system-log-redaction.test.ts` (quickstart §1 and §2).

### Tests for User Story 1 (write first, see them fail)

- [ ] T017 [US1] Create `packages/mcp/test/system-log.test.ts` against the fake instance with a small synthetic log: with no input every entry is returned, oldest last occurrence first, ties by logger then source (FR-007); each entry has its level, logger, source, count, first and last occurrence, messages in the instance's order and traceback (FR-002, SC-001); an entry grouped by the instance appears once with its count; the integration comes from `homeassistant.components.<domain>…` and `custom_components.<domain>…` loggers, from the source path for a library logger and a `py.warnings` entry, marked `1`, and is `null` for `homeassistant.core` and `homeassistant.helpers.*` loggers with a helper source; custom integrations are listed in `custom` (FR-003, R3); `integrations` keeps the matching domains, built-in and custom, by exact domain and by pattern, and leaves out entries with no integration (FR-004); an empty log gives an empty document and the empty-log note; no match gives an empty document and the no-entry-matched note (FR-011); the fake instance saw one connection and, after the handshake, exactly `auth/current_user`, `get_config` and one `system_log/list` with no parameter (FR-014); a user with `is_admin: false` gets `not_admin` with the `required` wording and the log is not read; without `system_log` in the components, or with the command unknown, `system_log_unavailable` (FR-013); an invalid `integrations` gives `selector_invalid` with the integration wording and no connection; `config_missing`, `auth_invalid`, `unreachable`, a stalled read (`timeout`) and an instance below `MIN_VERSION` give the existing kinds; a malformed answer gives `protocol_error` and no document; two calls on an unchanged log give byte-identical text (SC-005); every document is valid against `systemLogJsonSchema`; the outputs of the other tools on the same instance are untouched (FR-020)
- [ ] T018 [P] [US1] Create `packages/mcp/test/system-log-encode.test.ts` for the standard encoding on hand-built entries: the envelope's keys and order (data-model §2), `utc_offset` the offset at the time of the call; entries grouped by local date of the last occurrence, time `HH:MM:SS` and an offset only when it differs; `first` absent when equal to the last to the second, `HH:MM:SS` on the same date, ISO otherwise; trailing `null` dropped and `1` last when the integration came from the source; `files` holds source and frame paths once each in order of first use; `parts` holds every distinct frame once (`code` absent when the frame has no indented line, verbatim with caret lines otherwise) and every traceback line that appears more than once, while a line that appears once stays inline, consecutive inline lines joined in one string; a frame shared by two entries is one part; on `REFERENCE_SYSTEM_LOG`, `compression_ratio` is at least 1.8 (FR-017, SC-002, R12)
- [ ] T019 [P] [US1] Create `packages/mcp/test/system-log-roundtrip.test.ts`: for `REFERENCE_SYSTEM_LOG` and selections of it (one built-in integration, one custom integration, the entries with no integration, a chained traceback, an entry with five messages), `expandSystemLog(encode(entries))` gives every entry with its fields and its traceback text equal to the instance's, after `rootPaths` and redaction, times compared to the second (FR-016, SC-002)
- [ ] T020 [P] [US1] In `packages/mcp/test/system-log-redaction.test.ts`, add a synthetic log that seeds every redaction rule into messages and tracebacks across many entries, and paths under the three roots with a host user's name in them: none of the seeded values appear in the text, no seeded root appears, and every seeded file name, line number, logger and integration name does (FR-009, SC-004)
- [ ] T021 [P] [US1] In `packages/mcp/test/tool.test.ts`, add that `ha_system_log` is listed between `ha_history` and `ha_ping` with the title, description, input schema and annotations of `specs/012-ha-system-log/contracts/ha_system_log.tool.json` (`readOnlyHint` true, `destructiveHint` false, `idempotentHint` true, `openWorldHint` true), and that a call returns the document then the notes as text blocks; the existing check that the requirements table names every registered tool except `ha_ping` now covers `ha_system_log` (FR-001, FR-015, FR-018)

### Implementation for User Story 1

- [ ] T022 [P] [US1] Create `packages/mcp/src/system-log/inputs.ts`: `parseSystemLogInputs(input)` validates `integrations` and `exclude` with `parseSelectors(…, "integration selector")`, `level` (`warning`, `error` or `critical`, else `inputInvalid(problem, "system_log")`) and `detail` (`summary` or `standard`, default `standard`) (R4)
- [ ] T023 [P] [US1] Create `packages/mcp/src/system-log/entries.ts`: `integrationOf(entry)` as research R3; `selectEntries(entries, { integrations, exclude, level, startMs })` keeps, in the order of R5, the entries that pass every filter (R4); `prepareEntry(entry, { configDir, token, coordinates })` applies `rootPaths` then `redactText` to every message and to the traceback, and `rootPaths` to an absolute source (R7, R8)
- [ ] T024 [P] [US1] Create `packages/mcp/src/system-log/traceback.ts`: `splitTraceback(text)` gives the frames (a `  File "…", line N, in …` line with its indented lines) and the other lines, in order; a `PartTable` that, over a whole document, gives every distinct frame and every line seen more than once an index in `parts`, its paths an index in `files`, and returns each traceback's items with consecutive one-time lines joined (R6)
- [ ] T025 [P] [US1] Create `packages/mcp/src/system-log/envelope.ts`: `systemLogFrame({ detail, haVersion, timeZone, nowMs, integrations, level, startMs, custom })` builds the envelope of data-model §2 in that key order, `utc_offset` the offset at `nowMs`, `start` local ISO to the second, optional keys only when given; and the local time and date of an entry as R11
- [ ] T026 [US1] Create `packages/mcp/src/system-log/encode-standard.ts`: `encodeStandardSystemLog(frame, entries)` builds `files`, `parts` and `entries` of data-model §3 with `put` for keys written as data. Make T018 and T019 pass
- [ ] T027 [US1] Create `packages/mcp/src/tools/ha-system-log.ts`: `runSystemLog(env, options)` and `querySystemLog(env, options)`: validate the inputs and `start` before connecting; read the configuration and `readSystemLogLimit`; connect once; read the user and the core config together, refuse a non-administrator with `notAdmin("required")` and a missing `system_log` component with `systemLogUnavailable()`; resolve `start` with `parseWindowInput` and `resolveWindow`; read the log; select, prepare and encode; measure `rawBytes` as the selected entries as received (R12); `finalize`; return the document with the notes of R15 in order. Make T017 and T020 pass
- [ ] T028 [P] [US1] In `packages/mcp/src/ping/requirements.ts`, add `ha_system_log: { admin: true, integrations: ["system_log"] }` after `ha_history` (R15, FR-018)
- [ ] T029 [US1] In `packages/mcp/src/server.ts`, register `ha_system_log` after `ha_history` and before `ha_ping`, with the title, description, input schema (zod with every limit of the contract: `integrations` and `exclude` 1 to 100 items, `level` `warning`, `error` or `critical`, `start` a string, `detail` `summary` or `standard`) and annotations copied from `specs/012-ha-system-log/contracts/ha_system_log.tool.json`, with a "Copied from specs/012-ha-system-log/contracts/…" comment like the other tools, through `asToolResult("ha_system_log", …)`. Make T021 pass
- [ ] T030 [US1] In `packages/mcp/test/ping.test.ts`, update the healthy-document expectation so `tools` lists `ha_system_log` ready (the FR-020 exception), and add that it is not ready when `system_log` is not loaded; in `packages/mcp/test/cli.test.ts`, add `ha_system_log` to the expected tool list
- [ ] T031 [US1] In `packages/mcp/README.md`, add the `ha_system_log` section (what it reads, that the instance keeps a bounded number of entries since its last start, the inputs, the integration attribution, the root markers, the document, the limit and `DOMUSOPS_SYSTEM_LOG_MAX_BYTES`, the notes, the errors) and its row in the decoder table of "Reading responses" (`expandSystemLog` for `standard`; `summary` is read as it is); in `packages/mcp/test/readme.test.ts`, run the tested decoding example on a system log document
- [ ] T032 [P] [US1] Add `.changeset/mcp-ha-system-log.md` (`@domusops/mcp` minor: the `ha_system_log` tool) and `.changeset/schema-system-log-format.md` (`@domusops/schema` minor: the `domusops.system_log/0.1` format, its types, JSON Schema and `expandSystemLog`)

**Checkpoint**: an integration's entries can be read; the tool is registered, listed by `ha_ping` and documented.

---

## Phase 4: User Story 2 — Keeping a noisy log within bounds (Priority: P1)

**Goal**: `exclude`, `level`, `start` and the size limit keep a result bounded, and an oversize query is refused with the entry count and how to narrow it (spec FR-004 to FR-006, FR-010).

**Independent Test**: the narrowing and limit cases of `packages/mcp/test/system-log.test.ts` and `system-log-encode.test.ts` (quickstart §2).

### Tests for User Story 2 (write first, see them fail)

- [ ] T033 [US2] In `packages/mcp/test/system-log.test.ts`, add cases: `exclude` removes integrations after `integrations`, by domain and pattern, never removes an entry with no integration, and the exclusion note comes first; `level: "error"` keeps error and critical entries, `critical` only critical, `warning` all (FR-005); `start` keeps the entries whose last occurrence, to the second, is at or after it, an entry that began before `start` and recurred after it included, an offset-less `start` read in the instance's time zone, and the envelope echoes `start`, `level` and `integrations` (FR-006); validation before any connection: a `level` of `info` or `debug` is `input_invalid` with the `system_log` wording, an integration selector with a dot or an upper-case letter is `selector_invalid`, a malformed `start`, one before 1970 and one in the future are `window_invalid` with the logbook's wordings; with `DOMUSOPS_SYSTEM_LOG_MAX_BYTES` set low, a `standard` result above it is a `too_large` error whose text holds the entry count, the byte size and the limit, and no logger or message (SC-003); the same query with `detail: "summary"` succeeds
- [ ] T034 [P] [US2] In `packages/mcp/test/system-log-encode.test.ts`, add that `compression_ratio` measures only the selected entries as received (a filter that leaves one entry gives the ratio of that entry), and that a synthetic log of 500 entries with long tracebacks exceeds the default limit (R9)

### Implementation for User Story 2

- [ ] T035 [US2] In `packages/mcp/src/tools/ha-system-log.ts`, pass `exclude`, `level` and `start` to `selectEntries` and the envelope, add the exclusion note, and refuse a `standard` document above `readSystemLogLimit` with `tooLargeSystemLog(entries, bytes, limit, "standard")` (R9). Make T033 and T034 pass

**Checkpoint**: both P1 stories pass on the fake instance.

---

## Phase 5: User Story 3 — Seeing which integrations are failing before reading the details (Priority: P2)

**Goal**: `detail: "summary"` gives the counts of entries and occurrences per integration and level, with a row for entries without an integration, under the same filters and limit (spec FR-012).

**Independent Test**: the summary cases of `packages/mcp/test/system-log.test.ts` and `system-log-encode.test.ts` (quickstart §2).

### Tests for User Story 3 (write first, see them fail)

- [ ] T036 [US3] In `packages/mcp/test/system-log-encode.test.ts` and `packages/mcp/test/system-log.test.ts`, add cases: the summary of `REFERENCE_SYSTEM_LOG` has `counts`, `by_integration` and `without_integration` equal to what its `standard` result lists (entries counted once, occurrences summed from `count`), domains in name order and levels in severity order; `without_integration` is absent when every entry has an integration; `custom` lists the custom integrations; the filters narrow the counts as they narrow `standard`; an empty log gives zero counts and the empty-log note; with the limit set low, a summary above it is `too_large` with the summary remediation; the summary carries no message, source or traceback, is valid against `systemLogJsonSchema`, and `expandSystemLog` refuses it

### Implementation for User Story 3

- [ ] T037 [US3] Create `packages/mcp/src/system-log/encode-summary.ts`: `encodeSummarySystemLog(frame, entries)` builds `counts`, `by_integration` and `without_integration`, as data-model §4 and research R10
- [ ] T038 [US3] In `packages/mcp/src/tools/ha-system-log.ts`, for `detail: "summary"` skip the traceback and message preparation, encode with `encodeSummarySystemLog`, and apply the limit with `tooLargeSystemLog(…, "summary")` (R9, R10). Make T036 pass

**Checkpoint**: all three stories pass on the fake instance.

---

## Phase 6: Polish and closing

- [ ] T039 Build the server and, on a sandbox of 2026.10.0 with a temporary configuration holding a synthetic custom integration that logs on a service call (warnings, an error with a chained traceback, a library logger's error, a message with an e-mail address, URL credentials and a coordinate pair) and a broken template sensor, compare the raw `system_log/list` answer with what `packages/mcp/test/support/fake-ha.ts` gives for the same shape, fixing the fake if they differ; measure `compression_ratio` of an unfiltered `standard` call and of a `summary`; record the values in research R12. T040 asserts the ratio is above 1 if the measurement supports it; otherwise R12 records why and T040 asserts it is reported and positive, while the CI floor of 1.8 on the reference fixture stays the §4 contract
- [ ] T040 In `packages/sandbox/test/mcp.container.test.ts`, add a test per channel: write the configuration of T039 to a temporary directory, start the sandbox with it and the built server, call the integration's service twice and `system_log.write` once from the test (the server never writes, FR-019); then `ha_system_log` with `integrations: ["<domain>"]` returns a `domusops.system_log/0.1` document whose entries have the expected counts and messages, the library logger's entry belongs to the integration through its source, every frame path starts with `{config}/`, `{ha}/` or `{python}/`, and the seeded e-mail address, credentials and coordinates are redacted; an unfiltered `summary` whose counts match the unfiltered `standard` result; `level: "error"` leaves out the warnings; the `compression_ratio` bound T039 set; the same call twice with no new log entry is byte-identical (SC-005, SC-006, §8)
- [ ] T041 [P] In the root `README.md`, add the `ha_system_log` row to the tool table
- [ ] T042 Run the gate (`pnpm lint && pnpm typecheck && pnpm test`), then `pnpm build` and the container test on `DOMUSOPS_SANDBOX_RELEASE=2026.10.0` and `2026.9.4` (never the unpinned stable channel); confirm that no existing output test of `ha_snapshot`, `ha_logbook_query`, `ha_trace`, `ha_state` or `ha_history` was edited beyond the internal `notAdmin` subject rename, and that `ha_ping`'s tests changed only by the new tool entry (SC-007); run Prettier only on the touched files, never on `tasks.md`
- [ ] T043 Mark these tasks `[X]` as they complete, and ask the maintainer before any commit, push or pull request; after the pull request, run `/code-review` and triage the findings before pushing fixes
- [ ] T044 After the maintainer merges, update `CLAUDE.md`'s current focus: the four 0.2.0 tools are merged and the Version Packages pull request (#36) is next; then the scenario and assertion DSL (006)

---

## Dependencies and order

- T001 first. Phase 2 before every story: T002 → T003 (the schema test before its code); T004 → T005, after T003; T006 after T005; T007 to T015 are independent of the schema work and of each other; T016 after T008 and T011.
- Phase 3: T017 to T021 before T022 to T031; T022 to T025 before T026; T013, T014 and T023 before T027; T026 and T016 before T027; T027 and T028 before T029; T029 before T030 and T031.
- Phase 4 extends the files of Phase 3 and so follows it: T033, T034 → T035.
- Phase 5 follows Phase 4 (it shares `ha-system-log.ts` and the limit): T036 → T037 → T038.
- T039 before T040: the comparison fixes the fake and the measurement sets the sandbox bound. T039 and T040 need the built server; T042, T043 and T044 close.

### Parallel opportunities

- Phase 2: T002–T006 (schema) alongside T007 to T015 (mcp).
- Phase 3: T018, T019, T020 and T021 once T017 is written; T022, T023, T024, T025, T028 and T032 alongside each other.
- Phase 6: T041 alongside T040.

## Implementation strategy

Phase 2, then Phase 3 as the minimum useful tool (an integration's entries), then Phase 4, which makes it safe on a noisy log, then Phase 5. All ship in the same pull request: the limit of Phase 4 is what makes `standard` bounded (§4), and its remediation points at the summary of Phase 5.

## Requirement coverage

| Requirement | Tasks                                            |
| ----------- | ------------------------------------------------ |
| FR-001      | T017, T021, T029                                 |
| FR-002      | T015, T017, T019, T026, T027                     |
| FR-003      | T017, T023, T027                                 |
| FR-004      | T009, T017, T022, T023, T033, T035               |
| FR-005      | T022, T033, T035                                 |
| FR-006      | T033, T035                                       |
| FR-007      | T017, T023                                       |
| FR-008      | T018, T025                                       |
| FR-009      | T012, T013, T014, T020, T023                     |
| FR-010      | T007, T008, T033, T034, T035                     |
| FR-011      | T010, T017, T027                                 |
| FR-012      | T036, T037, T038                                 |
| FR-013      | T008, T016, T017, T027                           |
| FR-014      | T011, T016, T017, T027                           |
| FR-015      | T021, T029                                       |
| FR-016      | T002–T006, T018, T019, T024, T026                |
| FR-017      | T018, T027, T039, T040                           |
| FR-018      | T021, T028, T030                                 |
| FR-019      | T039, T040, T042                                 |
| FR-020      | T008, T017, T030, T042                           |
| FR-021      | T032                                             |
| FR-022      | T015, T020, every test task (invented data only) |
| SC-001      | T017                                             |
| SC-002      | T018, T019                                       |
| SC-003      | T033                                             |
| SC-004      | T014, T020                                       |
| SC-005      | T017, T040                                       |
| SC-006      | T040                                             |
| SC-007      | T042                                             |
