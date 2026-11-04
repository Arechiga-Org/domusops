---
description: "Task list for the mcp reliability release (0.1.2)"
---

# Tasks: mcp reliability (0.1.2)

**Input**: Design documents from `/specs/008-mcp-reliability/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md, contracts/ (ha_logbook_query.tool.json, ha_trace.tool.json, response-notes.md, readme.md), quickstart.md

**Tests**: Included. Each story writes its tests first and sees them fail. Unit tests run in the default `pnpm test`; container tests run with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: One phase per user story, and each phase is one branch and one pull request from `main`. US3 and US4 both touch `tools/ha-trace.ts`, `server.ts` and `notes.ts`, so US4 starts from the `main` that has US3. US1 and US2 are independent of everything else.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1..US4, from spec.md
- All paths are relative to the repository root. Everything written to the repository is English (constitution §1), and no example, fixture or test contains data from a real home (FR-018).
- Per story, the last tasks are always the same: run the gate (`pnpm lint && pnpm typecheck && pnpm test`), Prettier on only the touched files (never `tasks.md`), and then ask the maintainer before any commit, push or pull request. The maintainer merges. `/code-review` runs after each pull request and its findings are triaged before anything is pushed.
- Every story that changes what users of `@domusops/mcp` see adds one patch changeset; together they release as 0.1.2 (FR-016).

---

## Phase 1: Setup

- [ ] T001 After the maintainer merges pull request #28 (spec, plan and tasks), run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` on a clean `main` and record that the baseline is green before any story starts (constitution §2)

**Checkpoint**: Spec, plan and tasks are on `main`. There is no foundational phase: US3 creates the shared pieces (multi-block results, `notes.ts`, the 008 contracts) that US4 reuses.

---

## Phase 2: User Story 1 — The server says which release it is (Priority: P1)

**Branch**: `008-us1-version` | **Package**: `packages/mcp` | **Changeset**: patch

**Goal**: The handshake reports `domusops-mcp` and the installed package's version (R1).

**Independent Test**: `packages/mcp/test/server-version.test.ts` (quickstart §1).

### Tests for User Story 1 (write first, see them fail)

- [ ] T002 [US1] Create `packages/mcp/test/server-version.test.ts`: (a) connect an in-memory client to `createServer({ env: {} })` and assert `client.getServerVersion()` is `{ name: "domusops-mcp", version: <version in packages/mcp/package.json> }`; (b) spawn the built `packages/mcp/dist/cli.js` over stdio, send `initialize`, and assert the same `serverInfo` (skip with a clear message when `dist/cli.js` is missing, as `mcp.container.test.ts` does). Both fail today with `0.0.0` (SC-001)

### Implementation for User Story 1

- [ ] T003 [US1] In `packages/mcp/src/server.ts`, replace `version: "0.0.0"` with the version read once from `new URL("../package.json", import.meta.url)` (valid from both `src/` and `dist/`). A missing file or a missing `version` throws with a message that names the file; there is no fallback value (R1, FR-002)
- [ ] T004 [US1] Run `pnpm exec vitest run scripts/test/package-contents.test.ts` and confirm `package.json` is in the packed `@domusops/mcp`, so the published server can read it
- [ ] T005 [US1] Add `.changeset/mcp-real-version.md` (`@domusops/mcp` patch): the server reports its real version instead of `0.0.0`
- [ ] T006 [US1] Run the gate; confirm no existing test changed. Then follow the per-story closing steps in the header

**Checkpoint**: US1 is mergeable on its own.

---

## Phase 3: User Story 2 — Setting up the server without guesswork (Priority: P1)

**Branch**: `008-us2-readme` | **Package**: `packages/mcp` (README) | **Changeset**: patch

**Goal**: The README covers the recommended installation, Claude Code, and the decoders, and a test keeps it correct (contracts/readme.md, R7, R8).

**Independent Test**: `packages/mcp/test/readme.test.ts` plus quickstart §2 by hand.

### Tests for User Story 2 (write first, see them fail)

- [ ] T007 [US2] Create `packages/mcp/test/readme.test.ts` that reads `packages/mcp/README.md` and asserts: (a) every `@domusops/mcp@~X.Y` matches the major and minor of `packages/mcp/package.json`, and at least one occurs; (b) the README has the sections of contracts/readme.md (install and run, Claude Code, reading responses), found by heading; (c) the README contains no string shaped like a long-lived token (a JWT with three dot-separated base64url parts), and every `DOMUSOPS_HA_URL` value inside a code block uses `homeassistant.local` or `localhost` as its host (links and the variable's format table are not checked); (d) the block preceded by `<!-- tested example -->` is a JavaScript block with one `import` from `@domusops/schema`: write it to a temporary `.mjs` file inside `packages/mcp/` (so the workspace resolves the import) with a prelude that defines `result` as a tool response built from a fixture document of each tool, import it, and assert it decodes each fixture without throwing. Remove the temporary file in `afterEach`. All four fail on today's README (FR-005, FR-006)

### Implementation for User Story 2

- [ ] T008 [US2] Verify research R7 by hand with a sandbox instance (quickstart §2 steps 1–3): in an empty repository, `npm install --save-dev @domusops/mcp`, then try `"command": "./node_modules/.bin/domusops-mcp"` and `"command": "npx", "args": ["--no", "domusops-mcp"]` in `.mcp.json`; for each, check that Claude Code connects after approval and still connects with the network off. Record the form that passes, and why the other did not, in `specs/008-mcp-reliability/research.md` R7
- [ ] T009 [US2] In `packages/mcp/README.md`, write "Install and run" per contracts/readme.md §1: the development-dependency form with the command from T008, `.gitignore` for `node_modules/`, `${DOMUSOPS_HA_URL}` and `${DOMUSOPS_HA_TOKEN}` from the environment, updating through a pull request; then the global and the `npx --yes @domusops/mcp@~0.1` alternatives with their configurations. Replace the existing `npx` example in the `ha_snapshot` section with a pointer to this section
- [ ] T010 [US2] In `packages/mcp/README.md`, write "Claude Code" per contracts/readme.md §2: project and user scope, approval in `/mcp`, where the token lives, and the troubleshooting list (waiting for approval, command not found, URL or token missing or wrong, user not an administrator, where the server's error output appears)
- [ ] T011 [US2] In `packages/mcp/README.md`, write "Reading responses" per contracts/readme.md §3: the tool × detail × decoder table, the tested JavaScript example preceded by `<!-- tested example -->`, and one sentence that text blocks after the document are notes
- [ ] T012 [US2] Run quickstart §2 step 4 (`git status` in the trial repository: `.mcp.json`, `package.json` and the lockfile tracked, `node_modules/` ignored, no token in any file)
- [ ] T013 [US2] Add `.changeset/mcp-readme-setup.md` (`@domusops/mcp` patch): README with the recommended installation, a Claude Code section, and how to decode responses
- [ ] T014 [US2] Run the gate. Then follow the per-story closing steps in the header

**Checkpoint**: US2 is mergeable on its own.

---

## Phase 4: User Story 3 — Leaving uninteresting entities out of the logbook and traces (Priority: P2)

**Branch**: `008-us3-exclude` | **Package**: `packages/mcp` | **Changeset**: patch

**Goal**: `exclude` on both tools, applied after `entities`, with an exclusion note after the unchanged document (R2, R3, R6; data-model §1 and §3).

**Independent Test**: `logbook-exclude`, `trace-exclude` and `response-notes` tests plus the contract tests (quickstart §3).

### Tests for User Story 3 (write first, see them fail)

- [ ] T015 [P] [US3] Create `packages/mcp/test/logbook-exclude.test.ts` against the simulated instance: no excluded entity in `standard` events or `summary` counts; rows without an entity kept when `entities` is absent; an entity matched by both lists is excluded; with exact `entities` all excluded, no `logbook/get_events` is sent and the document is empty and valid; `no_events` follows R3 (an excluded exact selector is never listed, a pattern whose matches were all excluded is not listed); invalid `exclude` entries fail with `selector_invalid` like `entities`; `compression_ratio` is measured on the kept rows; and on `REFERENCE_LOGBOOK_24H`, with `DOMUSOPS_LOGBOOK_MAX_BYTES` lowered so the `standard` query is refused as `too_large` (as `packages/mcp/test/logbook-tool.test.ts` does), the same query fits once its noisiest entities are excluded (SC-004)
- [ ] T016 [P] [US3] Create `packages/mcp/test/trace-exclude.test.ts`: with `entities: ["automation.*"]` and an `exclude` pattern, no run of an excluded automation is returned at either detail level, counts and the size check leave them out, and no excluded ID appears in any `no_runs` list; `exclude` with `run` or with `context` fails with `selection_invalid`; invalid entries fail with `selector_invalid`
- [ ] T017 [P] [US3] Create `packages/mcp/test/response-notes.test.ts` that calls both tools through an in-memory MCP client: with `exclude`, the result has two text blocks, the first parses as the same document `runLogbookQuery` / `runTrace` return, and the second is exactly the exclusion note of contracts/response-notes.md; without `exclude`, the result is one block, identical to before; an error result has one block
- [ ] T018 [US3] Point `packages/mcp/test/logbook-contract.test.ts` and the contract test in `packages/mcp/test/trace-tool.test.ts` at `specs/008-mcp-reliability/contracts/*.tool.json` (R6); both fail until the server advertises `exclude` and the new descriptions

### Implementation for User Story 3

- [ ] T019 [US3] Create `packages/mcp/src/notes.ts` with `exclusionNote(selectors)` producing the wording of contracts/response-notes.md
- [ ] T020 [US3] In `packages/mcp/src/server.ts`, make `asToolResult` accept `{ document, notes }` and emit the document block followed by one text block per note (errors unchanged); add `exclude` (array of strings, `min(1)`, `max(MAX_SELECTORS)`, optional) to both input schemas; copy the descriptions from the 008 contracts and update the "Copied from" comments to point there
- [ ] T021 [US3] In `packages/mcp/src/tools/ha-logbook-query.ts`, add `queryLogbook` returning `{ document, notes }` and keep `runLogbookQuery` returning the document only; validate `exclude` with `parseSelectors`; with the `exact` strategy request only the IDs not excluded and skip the request when none remain; drop excluded rows before `measureRowsBytes`; compute `no_events` per R3
- [ ] T022 [US3] In `packages/mcp/src/trace/select.ts`, accept `exclude` in `parseRequest` (validated with `parseSelectors`, and refused with `run` or `context` like `entities`), add it to `TraceRequest`, and in `selectTraces` drop runs whose item key matches it from `chosen` and drop excluded IDs from every `NoRuns` list
- [ ] T023 [US3] In `packages/mcp/src/tools/ha-trace.ts`, add `queryTrace` returning `{ document, notes }` and keep `runTrace` returning the document only; pass `exclude` through; add the exclusion note when `exclude` was given; the document's `selection` stays as in 0.1.1
- [ ] T024 [US3] In the `ha_logbook_query` and `ha_trace` sections of `packages/mcp/README.md`, add `exclude` to the input tables and one sentence on the exclusion note
- [ ] T025 [US3] Add `.changeset/mcp-exclude.md` (`@domusops/mcp` patch): `exclude` on `ha_logbook_query` and `ha_trace`, and the note that lists what was excluded
- [ ] T026 [US3] Run the gate; confirm every existing output test passes unedited and the compression floors did not move (SC-006). Then follow the per-story closing steps in the header

**Checkpoint**: US3 is mergeable on its own; US4 starts from the `main` that has it.

---

## Phase 5: User Story 4 — Telling "nothing ran" from "the runs are gone" (Priority: P2)

**Branch**: `008-us4-discarded-runs` | **Package**: `packages/mcp` (+ the sandbox container test) | **Changeset**: patch

**Goal**: A windowed `ha_trace` names the items whose stored runs may no longer reach the window start, with their limits, after the unchanged document (R4, R5; data-model §2).

**Independent Test**: `trace-discarded.test.ts` and the container test (quickstart §4, §5).

### Tests for User Story 4 (write first, see them fail)

- [ ] T027 [US4] Extend `packages/mcp/test/support/fake-ha.ts`: records marked `not_triggered` per item in the trace fixture, an answer to `automation/config` and `script/config` with an optional `trace.stored_traces` per item, an option to make those commands fail, and the received config commands in `received`
- [ ] T028 [US4] Create `packages/mcp/test/trace-discarded.test.ts`: an automation with 5 stored runs, all after `start`, gives one discarded-runs note with `(keeps 5)`; the same with `stored_traces: 20` and 6 runs gives none; with `stored_traces: 2` and 2 runs gives `(keeps 2)`; a failed config read gives `(keeps 5, limit assumed)`; 5 newer not-triggered records and 2 runs give none (separate buckets); 12 affected items give 10 names in entity-ID order and `; and 2 more`; an empty result still carries the note; no note without `start` and `end`, nor for `run` or `context`; an excluded automation is never named and never gets a config read; no config command is sent for a query without a window; in every case the first block equals the document without notes (SC-005, FR-011 to FR-014)
- [ ] T029 [US4] In `packages/sandbox/test/mcp.container.test.ts`, make `withMcp` return every text block, and add a test per channel: a sandbox started with a configuration holding one automation with an `id`, `trace: { stored_traces: 2 }` and an action that runs on demand; trigger it three times with `automation.trigger` through the `HaSocket` the test already opens; a windowed `ha_trace` from before the first run returns the discarded-runs note with `(keeps 2)`, and the same query with that automation in `exclude` returns no note (§8, quickstart §5)

### Implementation for User Story 4

- [ ] T030 [P] [US4] In `packages/mcp/src/ha/trace.ts`, add `readStoredLimits(client, items)` that sends `automation/config` or `script/config` per entity ID, at most `MAX_IN_FLIGHT` at a time, and returns per item `{ limit, assumed }`: `raw_config.trace.stored_traces` when it is a positive integer, otherwise 5; a failed read gives 5 with `assumed: true` and never fails the request
- [ ] T031 [P] [US4] Create `packages/mcp/src/trace/discarded.ts` with `candidates(short, selectedIds, window)` (per item and bucket: count and oldest start, from the `trace/list` records) and `affected(candidates, limits)` per data-model §2 (`count ≥ limit` and oldest start after the window start, or any oldest start when there is no `start`)
- [ ] T032 [US4] In `packages/mcp/src/notes.ts`, add `discardedRunsNote(items)` with the wording, ordering and 10-item cap of contracts/response-notes.md
- [ ] T033 [US4] In `packages/mcp/src/tools/ha-trace.ts`, when the request has a window and no `run` or `context`, compute candidates from the selected, non-excluded items after selection, read limits for candidates only, and append the discarded-runs note after the exclusion note; do it for empty results too, and never on an error path. The document, its counts and its size check are computed exactly as before
- [ ] T034 [US4] In the `ha_trace` section of `packages/mcp/README.md`, add one sentence on the discarded-runs note and `stored_traces`
- [ ] T035 [US4] Add `.changeset/mcp-discarded-runs.md` (`@domusops/mcp` patch): a windowed `ha_trace` now says which automations and scripts may have discarded runs from the window, and how to keep more
- [ ] T036 [US4] Run the gate, then the container test on the two local releases (`DOMUSOPS_SANDBOX_RELEASE=2026.10.0` and `2026.9.4`, never the unpinned stable channel). Then follow the per-story closing steps in the header

**Checkpoint**: All four stories are merged; the Version Packages pull request bumps `@domusops/mcp` to 0.1.2 alone.

---

## Phase 6: Polish

- [ ] T037 After US1–US4 merge, check each `FR-001..FR-018` and `SC-001..SC-007` against the merged pull requests and record any gap in `specs/008-mcp-reliability/checklists/requirements.md` Notes
- [ ] T038 After the maintainer merges Version Packages, confirm `@domusops/mcp@0.1.2` is on npm with provenance, that `@domusops/schema`, `@domusops/sandbox` and `@domusops/bootstrap` did not change version (SC-007), and that a Claude Code session using the README's recommended setup reports `0.1.2` (SC-001, SC-002)

---

## Dependencies & Execution Order

- **Phase 1** first: pull request #28 merges before any story branch.
- **US1 → US2 → US3 → US4** in that order of merging. US1 and US2 touch different files and could be built in parallel. US4 depends on US3 (`notes.ts`, multi-block results, the 008 contracts, `exclude` in selection).
- Within a story, tests come first and must fail before the implementation tasks start.

## Parallel Opportunities

- **US3**: T015, T016 and T017 are different test files.
- **US4**: T030 and T031 touch different files; T027 must precede T028.
- **Across stories**: US1 and US2 can be worked on together.

## Implementation Strategy

- **MVP**: US1 and US2, the two P1 stories. With them merged, the server loads from a pinned local installation, reports its version, and the decoders are documented; that alone removes the setup failure of the first real use.
- **Incremental**: US3 then US4, each one pull request with its patch changeset. The four changesets release together as `@domusops/mcp` 0.1.2.
