---
description: "Task list for ha_ping (feature 009, first tool of 0.2.0)"
---

# Tasks: ha_ping

**Input**: Design documents from `/specs/009-ha-ping/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12), data-model.md, contracts/ (ha_ping.tool.json, ping-format.md), quickstart.md

**Tests**: Included. Tests are written first and seen to fail. Unit tests run in the default `pnpm test`; container tests run with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: The two stories (US1 healthy setup, US2 setup problems) share every file and the tool is small, so the feature is one branch (`009-ha-ping`) and one pull request. Spec, plan and tasks are committed first; the implementation follows in atomic commits.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 or US2, from spec.md
- All paths are relative to the repository root. Everything written to the repository is English (constitution §1), and no example, fixture or test contains data from a real home (FR-017).
- The last tasks are always the same: run the gate (`pnpm lint && pnpm typecheck && pnpm test`), Prettier on only the touched files (never `tasks.md`), and then ask the maintainer before any commit, push or pull request. The maintainer merges. `/code-review` runs after the pull request and its findings are triaged before anything is pushed.
- The feature adds a minor changeset for `@domusops/mcp` and one for `@domusops/schema` (FR-016). The Version Packages pull request is held until features 010 to 012 merge (research R12).

---

## Phase 1: Setup

- [X] T001 Run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` on the branch before any code and record that the baseline is green (constitution §2)

---

## Phase 2: Foundational (blocks both stories)

**Purpose**: the format, the shared identity and the client change that the tool needs.

- [X] T002 [P] In `packages/mcp/test/ping-json-schema.test.ts`, write tests for the format: `PING_FORMAT` is `domusops.ping/0.1`; `pingJsonSchema` accepts the two examples of `specs/009-ha-ping/contracts/ping-format.md`; it rejects a document without `format`, with `admin` not a boolean, with a `reasons` entry that is not `version_unsupported`, `not_admin` or `integration_missing:` followed by `[a-z0-9_]+`, and with `ready: false` and no `reasons`; it accepts names in `tools` and `integrations` it does not know (FR-019, R9)
- [X] T003 [P] In `packages/schema/src/ping/format.ts`, add `PING_FORMAT` and the types `PingDocument`, `PingInstance` and `PingToolReadiness` exactly as data-model §1 and §2 (keys in that order; `next_steps` optional; `reasons` optional); in `packages/schema/src/ping/json-schema.ts`, add `pingJsonSchema`; export both from `packages/schema/src/index.ts` (R9). No decoder
- [X] T004 [P] In `packages/schema/README.md`, add the format's row to the Formats table (no detail levels, no decoder: the document is read as it is) and `PING_FORMAT`, `PingDocument` and `pingJsonSchema` to the exports list
- [X] T005 [P] In `packages/mcp/test/client.test.ts`, add tests that `HaClient.connect` with `minVersion: null` connects to a fake instance below `MIN_VERSION` and exposes its `haVersion`, and that the default still fails with `version_unsupported` (R3)
- [X] T006 In `packages/mcp/src/ha/client.ts`, let `ClientOptions.minVersion` be `string | null`; `null` skips the `isSupported` check at `auth_required` (an unparseable version still fails as a protocol error); the default is unchanged (R3)
- [X] T007 In `packages/mcp/src/package-info.ts`, move `readVersion` and `packageVersion` out of `packages/mcp/src/server.ts` and add `SERVER_NAME = "domusops-mcp"`; make `server.ts` import them (R11). No behaviour change: `packages/mcp/test/server-version.test.ts` passes unedited

**Checkpoint**: the format is published in the workspace, the client can connect to an old instance, and the server's identity has one source.

---

## Phase 3: User Story 1 — Confirming the setup before the first query (Priority: P1)

**Goal**: one call on a healthy instance answers with the small document and reads nothing else (spec FR-001 to FR-010, FR-012, FR-013).

**Independent Test**: `packages/mcp/test/ping.test.ts` (quickstart §1) and the container test (quickstart §3).

### Tests for User Story 1 (write first, see them fail)

- [X] T008 [US1] Create `packages/mcp/test/ping.test.ts` against the fake instance, with the reference fixture's `get_config` given the components `logbook` and `trace`: the document equals the healthy example of `contracts/ping-format.md` (with the fixture's version, time zone and the computed `compression_ratio`); the server's name and version equal the handshake's (FR-002); the fake instance saw one connection and, after the handshake, exactly `auth/current_user`, `get_config` (FR-008); for this, `packages/mcp/test/support/fake-ha.ts` gains `connections`, the number of connections it accepted; two calls give byte-identical documents; the text holds no token, no `127.0.0.1` address, no coordinates, no `location_name`, no user name or id (FR-010); `ha_snapshot`, `ha_logbook_query` and `ha_trace` outputs are untouched (FR-015); `encodePing` with the table of the six tools 0.2.0 lists (`ha_snapshot`, `ha_logbook_query`, `ha_trace`, `ha_state`, `ha_history`, `ha_system_log`, needing `logbook`, `trace`, `history`, `recorder` and `system_log` between them), on an instance below `MIN_VERSION`, with `admin: false` and none of those integrations loaded, gives a document under 2,000 bytes (SC-003, research R8); `compression_ratio` is at least 3 on the reference fixture (FR-013, R7)
- [X] T009 [US1] In `packages/mcp/test/tool.test.ts`, add that `ha_ping` is listed with the title, description, empty input schema and annotations of `specs/009-ha-ping/contracts/ha_ping.tool.json` (`readOnlyHint` true, `destructiveHint` false, `idempotentHint` true), that a call returns one text block, and that the requirements table of R4 names every registered tool except `ha_ping` (R4)

### Implementation for User Story 1

- [X] T010 [P] [US1] Create `packages/mcp/src/ping/requirements.ts`: one entry per tool in registration order — `ha_snapshot` (administrator, no integrations), `ha_logbook_query` (administrator, `logbook` and `recorder`), `ha_trace` (administrator, `trace`) — as research R4
- [X] T011 [US1] Create `packages/mcp/src/ping/encode.ts`: `encodePing(input, requirements = REQUIREMENTS)` builds the document of data-model §1 in that key order from `{ serverVersion, instanceVersion, timeZone, admin, components, rawBytes }` and the requirements table (the real one of T010 by default; tests pass their own): `integrations` holds every integration any listed tool needs, in name order, true only when its exact name is in `components` (R2); `instance.supported` is `isSupported(version)`; each tool's `reasons` in the order of data-model §2; `next_steps` per data-model §3, absent when every tool is ready; `compression_ratio` through `finalize(document, rawBytes)`
- [X] T012 [US1] Create `packages/mcp/src/tools/ha-ping.ts`: `runPing(env, options)`, where `options` is `{ timeouts?: Partial<Timeouts> }` passed to `HaClient.connect` as `runSnapshot` does, reads the configuration (`readConfig`), connects with `minVersion: null` (R3), sends `auth/current_user` then `get_config`, keeps only `is_admin`, `time_zone` and `components` (R1), validates their shapes as `readInstance` does (a protocol error for a malformed answer), measures `rawBytes` as the two answers as received, and returns `encodePing(...)`; it does not use `readInstance` (R1)
- [X] T013 [US1] In `packages/mcp/src/server.ts`, register `ha_ping` with the title, description, empty input schema and annotations copied from `specs/009-ha-ping/contracts/ha_ping.tool.json`, with a "Copied from specs/009-ha-ping/contracts/…" comment like the other tools
- [X] T014 [US1] In `packages/mcp/README.md`, add the `ha_ping` section (what it reads, the document, what `ready` means, the error cases) and a row for it in the decoder table of "Reading responses" (no decoder; read as JSON); change the tested example so a document whose `format` has no decoder is returned as it is, and in `packages/mcp/test/readme.test.ts` run it on a ping document (R10)
- [X] T015 [P] [US1] Add `.changeset/mcp-ha-ping.md` (`@domusops/mcp` minor: the `ha_ping` tool) and `.changeset/schema-ping-format.md` (`@domusops/schema` minor: the `domusops.ping/0.1` format, its types and JSON Schema)

**Checkpoint**: a healthy instance gets the document, nothing else is read, and the format and README are published.

---

## Phase 4: User Story 2 — Telling a setup problem from a data problem (Priority: P1)

**Goal**: every setup problem is named, with the tools it affects and what to change (spec FR-006, FR-007, FR-011, FR-018).

**Independent Test**: the problem cases of `packages/mcp/test/ping.test.ts` (quickstart §1).

### Tests for User Story 2 (write first, see them fail)

- [X] T016 [US2] In `packages/mcp/test/ping.test.ts`, add cases on the fake instance: a user with `is_admin: false` gives `admin: false`, `not_admin` in every tool's `reasons` and the administrator sentence in `next_steps`; an instance without the `trace` component gives `integration_missing:trace` in `ha_trace` only; without `logbook`, `integration_missing:logbook` in `ha_logbook_query` only; a missing `recorder` changes nothing, as the tool does not check it; a component named `trace.sensor` does not count as `trace` (R2); an instance of a version below `MIN_VERSION` gives `supported: false`, `version_unsupported` in every tool and the upgrade sentence, and the document is still returned (FR-018, R3); a beta version (`2026.10.0b3`) is judged on its base version; reasons come in the order of data-model §2 and `next_steps` in the order of §3 with one sentence per distinct reason; a stalled `get_config`, an instance that never sends `auth_required` (`stall: "connect"`) with `connectMs: 200`, which fails with `timeout` in under one second (SC-004), a refused token, an unreachable address, a missing `DOMUSOPS_HA_URL` and a malformed one each give an error result with the existing kind and text, and no document, and a missing variable sends no connection (FR-011, FR-018, R6)

### Implementation for User Story 2

- [X] T017 [US2] Make T016 pass: complete `reasons` and `next_steps` in `packages/mcp/src/ping/encode.ts` as data-model §2 and §3 (the sentences quoted there), and make `runPing` in `packages/mcp/src/tools/ha-ping.ts` let the existing configuration, connection and timeout errors propagate unchanged through `asToolResult` (R5, R6)

**Checkpoint**: both stories pass on the fake instance.

---

## Phase 5: Polish and closing

- [X] T018 In `packages/sandbox/test/mcp.container.test.ts`, add a test per channel: a sandbox with `default_config` and the built server, `ha_ping` returns a `domusops.ping/0.1` document (its validity against `pingJsonSchema` is tested in `packages/mcp`, which the sandbox package does not depend on) with `instance.supported` true, `admin` true, the integrations loaded, every tool ready, a non-empty `time_zone`, a `compression_ratio` of at least 3 and no `next_steps`; the same document twice is byte-identical (SC-005, §8)
- [X] T019 Run the gate (`pnpm lint && pnpm typecheck && pnpm test`), then `pnpm build` and the container test on `DOMUSOPS_SANDBOX_RELEASE=2026.10.0` and `2026.9.4` (never the unpinned stable channel); run Prettier only on the touched files, never on `tasks.md`
- [ ] T020 Mark these tasks `[X]` as they complete, and ask the maintainer before any commit, push or pull request; after the pull request, run `/code-review` and triage the findings before pushing fixes
- [ ] T021 After the maintainer merges, update `CLAUDE.md`'s current focus to point at feature 010 (`ha_state`); the 0.2.0 release itself waits for features 010 to 012

---

## Dependencies and order

- T001 first. Phase 2 before both stories: T002 → T003 (the schema test before its code); T005 → T006; T007 is independent of both.
- Phase 3: T008 and T009 before T010–T014; T010 before T011; T011 before T012; T012 before T013; T013 before T014's README claims.
- Phase 4 extends the files of Phase 3 and so follows it: T016 → T017.
- T018 needs the built server (T019's build); T019 and T020 close.

### Parallel opportunities

- Phase 2: T002/T003/T004 (schema) with T005/T006 (client) and T007.
- Phase 3: T010 and T015 are independent of the other implementation tasks.

## Implementation strategy

Phase 2, then Phase 3 as the minimum useful tool (a healthy ping), then Phase 4, which is what motivated the tool. Both ship in the same pull request, since the tool is not useful without its failure findings.

## Requirement coverage

| Requirement            | Tasks                                |
| ---------------------- | ------------------------------------ |
| FR-001, FR-009         | T008, T009, T013                     |
| FR-002                 | T007, T008, T012                     |
| FR-003, FR-004, FR-005 | T008, T011, T012, T016               |
| FR-006, FR-007         | T016, T017                           |
| FR-008                 | T008, T012                           |
| FR-010                 | T008, T012                           |
| FR-011, FR-018         | T016, T017                           |
| FR-012                 | T002, T003, T004                     |
| FR-013                 | T008, T011, T018                     |
| FR-014                 | T018, T019                           |
| FR-015                 | T008                                 |
| FR-016                 | T015                                 |
| FR-017                 | every test task (invented data only) |
| FR-019                 | T002, T003                           |
| SC-001                 | T016                                 |
| SC-002                 | T008, T018                           |
| SC-003                 | T008                                 |
| SC-004                 | T016                                 |
| SC-005                 | T018                                 |
| SC-006                 | T008, T019                           |
