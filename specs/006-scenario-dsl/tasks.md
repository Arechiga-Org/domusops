---
description: "Task list for the scenario and assertion DSL (@domusops/sandbox, part 2)"
---

# Tasks: Scenarios — Declaring and Proving What an Automation Does

**Input**: Design documents from `/specs/006-scenario-dsl/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R16 and the five verification facts), data-model.md, contracts/ (scenario-format, report-format, library-api, cli, companion), quickstart.md

**Tests**: Included. The plan fixes the test layout: unit tests run in the default `pnpm test`; `*.container.test.ts` run only with `DOMUSOPS_CONTAINER_TESTS=1` (`pnpm --filter @domusops/sandbox run test:container`), on the channels of `packages/sandbox/test/support/channels.ts`.

**Organization**: Grouped by user story. US1 + US2 (both P1) form the first increment (constitution §9): format, runner, stand-ins, absent actions, the `test` command and the extended `sandbox-gate`. US3, US4 and US5 follow as separate pull requests.

**Pull requests**: the first increment is two pull requests, so no branch outlives three days (§9). PR-A = T001, T002, T004–T011, T013–T016, T022–T027 (format in the schema, with the fixture base and the facts test; releasable alone; on the current branch, with the spec documents). PR-B = T003, T012, T017–T021, T028–T053 (runner, stand-ins, absent actions, the `test` command, the gate), on a new short branch off `main` once PR-A is merged. The US2 grammar (T042, T045) goes in PR-B, with the story that runs it.

**Grammar grows by story**: the format is one contract, `domusops.scenario/0.1`, but `check.ts`, `normalize.ts` and `json-schema.ts` accept each part of the grammar in the story that runs it. Until a part lands, the checker refuses its keys with `unknown_key`, so an older reader refuses a newer document instead of misreading it (FR-001).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1..US5, from spec.md
- All paths are relative to the repository root. `schema/` below means `packages/schema/`, `sandbox/` means `packages/sandbox/`.
- Everything written to the repository is English (constitution §1); every scenario, fixture and example uses synthetic entities only (FR-032).

---

## Phase 1: Setup

- [ ] T001 Update `packages/sandbox/package.json`: add the dependencies `yaml` (same range as `packages/bootstrap`, `^2.6.0`) and `@domusops/schema` (`workspace:*`); add `ajv` (same range as `packages/sandbox`, `^8.20.0`) to the `devDependencies` of `packages/schema/package.json` (test only; the schema keeps zero runtime dependencies, §5); run `pnpm install` and confirm `pnpm typecheck` and `pnpm lint` still pass
- [ ] T002 [P] Add `.changeset/scenario-format.md` (`@domusops/schema` minor: the `domusops.scenario/0.1` and `domusops.scenario-report/0.1` formats, checker, normaliser, `resolveSuite`, `compareValue`, JSON Schemas), carried by PR-A (R15: schema 0.3.0)
- [ ] T003 [P] Add `.changeset/scenario-runner.md` (`@domusops/sandbox` minor: `loadScenarios`, `runScenarios`, `renderReport`, `exitStatus`, `Sandbox.fireEvent`, the `test` command, the `domusops_sandbox/actions/absent` companion command), at the start of PR-B (R15: sandbox 0.2.0)
- [ ] T004 [P] Add `docs` to `files` in `packages/sandbox/package.json` and `schema` to `files` in `packages/schema/package.json` (the documentation and the JSON Schema files ship with the packages); `scripts/test/package-contents.test.ts` only lists the packages, so it needs no change

---

## Phase 2: Foundational (blocks every story)

- [ ] T005 [P] Create `packages/schema/src/scenario/format.ts`: the constants of contracts/library-api.md exactly (`SCENARIO_FORMAT = "domusops.scenario/0.1"`, `SCENARIO_REPORT_FORMAT = "domusops.scenario-report/0.1"`, `DEFAULT_SCENARIO_DATE = "2026-04-15"` (a Wednesday), `DEFAULT_SCENARIO_TIME = "12:00:00"`, `DEFAULT_SCENARIO_TIMEOUT_SECONDS = 300`, `DEFAULT_SETTLE_SECONDS = 5`, `STAND_IN_KINDS` = `switch, binary_sensor, sensor, light, lock, fan, cover, valve, device_tracker`); the normalised types of data-model.md §1 verbatim (`Duration` "seconds, > 0, <= 604800", `Comparison`, `EntityValue`, `StartingPoint`, `Step`, `Target`, `Expectation`, `ResolvedScenario`, `ScenarioFile`); `ScenarioIssue` `{ path, code, message }` with `ScenarioIssueCode` exactly the codes of contracts/scenario-format.md §7
- [ ] T006 [P] Create `packages/schema/src/scenario/values.ts` and `packages/schema/test/scenario-values.test.ts`: entity ID `^[a-z0-9_]+\.[a-z0-9_]+$`; action `<domain>.<service>` with both parts `^[a-z0-9_]+$`, and the absent-action pattern `<domain>.*`; scenario and starting-point name `^[a-z0-9][a-z0-9_]{0,63}$`; durations as a number of seconds, `"HH:MM:SS"`, `"HH:MM"` or `{ hours, minutes, seconds }` with at least one field, "greater than 0 and at most 7 days" (604800 s); time of day `"HH:MM"` or `"HH:MM:SS"` 24-hour; date `"YYYY-MM-DD"`, "a real calendar day" (2026-02-29 refused, 2028-02-29 accepted); instants `"YYYY-MM-DDTHH:MM[:SS]"`
- [ ] T007 [P] Create `packages/schema/src/scenario/compare.ts` and `packages/schema/test/scenario-compare.test.ts`: `compareValue(expected, actual)` by research R10: `null` matches absent or null; numbers or text that reads as a finite decimal number on both sides compare as numbers (`15` matches `"15"` and `15.0`); otherwise text, booleans as `true`/`false` (`on` does not match `true`); lists and objects as JSON, in order; `at_least`, `at_most`, `between` (inclusive) need numbers on both sides, else `{ ok: false, reason: "not_a_number" }`; `not` and `in` follow the same equality
- [ ] T008 [P] Create `packages/schema/src/scenario/report.ts`: the report types of data-model.md §4 (`ExpectationFailure` with `calls` "<= 10", `ScenarioResult` with `instance_errors` "<= 5", `ScenarioReport`, `CouldNotRunCode` = the codes of contracts/report-format.md §2) and `scenarioReportJsonSchema` matching contracts/report-format.md (`failures` only when `outcome` is `failed`, `reason` only when `could_not_run`, `instance_errors[].message` at most 300 characters, `config` an object or `null`)
- [ ] T009 Export the scenario constants, types, `compareValue` and `scenarioReportJsonSchema` from `packages/schema/src/index.ts`; `pnpm --filter @domusops/schema build`
- [ ] T010 [P] Create the reference fixture `packages/sandbox/fixtures/scenario-config/`: `configuration.yaml` (header comment as in `fixtures/reference-config`: written for this repository, copies nothing from a real installation; `default_config:`; helpers `input_boolean.study_light`, `input_number.study_brightness` (0–100)) and `automations.yaml` with one automation `helper_night_motion`: trigger `binary_sensor.study_motion` to `on`, condition `presence.house` is `away` and the time is between 22:00 and 06:00, actions `input_number.set_value` 15 on `input_number.study_brightness` then `input_boolean.turn_on` on `input_boolean.study_light`; an empty `scenarios/` directory with a `.gitkeep`. `binary_sensor.study_motion` and `presence.house` are plain states set by scenarios. Every automation of the fixture, here and in later stories, has its own trigger entity, so a scenario fires only the automation it targets
- [ ] T011 Container test `packages/sandbox/test/scenario-facts.container.test.ts` on every channel of `CHANNELS` (skip beta on `no_beta_in_progress`): the verification before building of research.md. (1) A test-only custom component `packages/sandbox/test/fixtures/probe-actions/custom_components/domusops_probe/`, copied with the fixture into a temporary directory, wraps `ServiceRegistry.async_call` at class level; a script that calls an unknown action raises `ServiceNotFound` and the wrapper sees the call. (2) With the clock frozen at 03:00 and `presence.house` set to `away` (so the conditions of `helper_night_motion` hold), subscribing over `packages/sandbox/src/ha/ws.ts`: a `call_service` event for an action called with `target: { entity_id: … }` carries `entity_id` inside `service_data`, and setting `binary_sensor.study_motion` to `on` produces `automation_triggered` with `entity_id: automation.helper_night_motion`. (3) With the clock frozen, `time_fired` of a `state_changed` equals the frozen instant. (4) In a copy of the fixture with `homeassistant: time_zone: Europe/Lisbon`, `get_config` reports that zone after onboarding (the empty `core_config` of onboarding does not override it). (5) Under the same conditions, with `binary_sensor.study_motion` `off`: turning `helper_night_motion` off with `stop_actions: true`, setting the sensor to `on`, and turning the automation on again records no `automation_triggered`; then setting the sensor to `off` and back to `on` records exactly one (positive control). If a fact fails, update research R6, R7, R8 or R16 before writing T030, T031, T032 or T046
- [ ] T012 [P] Create `packages/sandbox/test/support/fake-sandbox.ts`: an in-memory `Sandbox` handle (`setState`, `getState`, `callService`, `fireEvent`, `addDevices`, `time.*`, `stop`) with scripted reactions ("when X is set, after N ms set Y") and a fake event feed shaped like the recorder's `Recorded` (data-model.md §3), for the unit tests of expect, scenario and run; and `packages/sandbox/test/support/scenario-config.ts`: `withScenarios(files)` copies `packages/sandbox/fixtures/scenario-config` into a temporary directory, replaces its `scenarios/` with only the listed files, and returns the directory and a hash of it, so container tests run fixture scenarios without the path selection of US4

**Checkpoint**: shared types, values, comparisons, the report type, the fixture base and the five facts exist; stories can start.

---

## Phase 3: User Story 1 - Proving one automation with one scenario (P1) 🎯 MVP

**Goal**: a scenario next to the configuration, with a starting point, one step and expectations on states, attributes, triggered automations and called actions, runs in a throwaway instance and reports each expectation with expected and actual values.

**Independent Test**: quickstart 1, 2 (with the helpers scenario) and 3: the helpers scenario passes; the failing copy fails on exactly the changed expectation (expected 30, found 15) and a missing entity fails with `entity_missing`; the source directory is unchanged and no labelled container is left.

### Tests for US1

- [ ] T013 [P] [US1] `packages/schema/test/scenario-check.test.ts`: the US1 grammar of contracts/scenario-format.md: both top-level shapes; `format_missing`; `format_unsupported` for `domusops.scenario/0.2` naming 0.1; `unknown_key` everywhere except entity IDs; `missing_key`; `wrong_type`; `bad_entity_id`; `bad_action`; `bad_time`; `bad_date`; `bad_comparison` (`between` with low > high, `in` empty); `empty_list`; `bad_name`; a step with two kinds; an expectation with two entity keys; every issue carries a JSON Pointer path; the SEED example without `stand_ins` and `absent_actions` is valid
- [ ] T014 [P] [US1] `packages/schema/test/scenario-normalize.test.ts`: a bare value becomes `{ eq }`; an entity value becomes `{ state, attributes }` (attributes named `state` or `attributes` read from `attributes`); `given` gets `date` 2026-04-15 and `time` 12:00:00 when absent; a single `when` step becomes a one-item list; `then` becomes a final `expect` step; `not_called` becomes `called` with `times: 0`; `within: 0` and `settle` inherited from the scenario, then `DEFAULT_SETTLE_SECONDS`; every step and expectation keeps its `line`-ready path
- [ ] T015 [P] [US1] `packages/schema/test/scenario-resolve.test.ts`: `resolveSuite` refuses two scenarios with the same name in one file or in two files with `duplicate_scenario`, naming both places; a valid suite returns `ResolvedScenario[]` in file order then position
- [ ] T016 [P] [US1] `packages/schema/test/scenario-json-schema.test.ts`: `checkScenarioDocument` and `scenarioJsonSchema` (with `ajv`) agree, valid or invalid, on every fixture under `packages/schema/test/fixtures/scenarios/` (`valid/*.json`, `invalid/*.json`); later stories add their fixtures to the same folders
- [ ] T017 [P] [US1] `packages/sandbox/test/scenario-load.test.ts`: files `*.yaml` and `*.yml` under `<config>/scenarios`, recursive, in path order; YAML 1.2 keeps `on`/`off` as text; issues carry `file:line:column`; `yaml_syntax` for broken YAML and duplicate keys; `tag_not_allowed` for `!secret`, `!include`, `!input` and merge keys (`<<`); anchors and aliases accepted; a missing scenarios directory or an empty suite is a usage error; `config_dir_invalid` before anything else
- [ ] T018 [P] [US1] `packages/sandbox/test/scenario-expect.test.ts` with the fake sandbox: state and attribute comparisons; `entity_missing` distinct from a wrong value (FR-016); `not_a_number` showing the value; `brightness_pct` derived for `light.*` as `round(brightness × 100 / 255)` only when the entity does not carry it; a positive expectation retried every 100 ms until it holds or `settle` real seconds pass (US1 AS4); `triggered` and `called` counted from the first step, with `times`, `target` subset (entity, device and area IDs) and `data` comparisons; `not_called` and `times` exact counts checked after 500 ms without a new recorded event, at most `settle`; a failed `called` lists up to 10 matching calls, newest last, each `{ at, data, absent }`; `read_at` is instance time; `expectations` counts checks (an entity expectation counts its state and each stated attribute separately; `triggered` and `called` count one each)
- [ ] T019 [P] [US1] `packages/sandbox/test/scenario-run.test.ts` with a fake `startSandbox`: lifecycle `starting → preparing → applying → running → checking` (data-model.md §2); every end state stops the instance before the result is emitted; a given state not read back after `settle` gives `could_not_run` `starting_point_not_held`, naming the entity, the state set and the state found; the harness errors map as data-model.md §6 (`instance_gone` and `time_control_failed` → `instance_stopped`, `no_beta_in_progress` → `not_run`, any other → `instance_stopped` with the scrubbed message); `config_invalid` on one release is reported for every scenario of that release after one attempt; reaching `timeout` fails with `time_limit`, stops the instance and the run goes on with the next scenario (FR-020); a scenario's own `timeout` wins over `scenarioTimeout`; with no container runtime the run tries no instance and every scenario is could not run `runtime_missing`; automations that were on are off while `given` is applied and on again before the first step, and one that was off stays off (R16); `onResult` is called once per scenario
- [ ] T020 [P] [US1] `packages/sandbox/test/scenario-report.test.ts`: `renderReport` matches contracts/report-format.md §3 (one block per release and scenario, every expectation listed, the count line); `exitStatus` is 1 when any failed, else 3 when any could not run, else 0; `not_run` rows do not change it; the run outcome follows §2; the report validates against `scenarioReportJsonSchema`; a seeded token and a secret value never appear in the machine or the readable report, replaced by `[redacted]` (FR-028, SC-007); a failed scenario carries `activity` (at most 20 entries per map, the rest in `more`) and a passed one does not; the report carries `config` with `secrets` and `placeholder_keys` from the instance's `ConfigSummary`, never a secret's value; with no instance started, `config` is `null` and the report still validates
- [ ] T021 [P] [US1] `packages/sandbox/test/scenario-cli.test.ts` with the fake runtime: `test --config <dir> --check` exits 0 without starting a container; invalid files print one `file:line:column code message` line each and exit 2 with no container started (SC-003); `--secrets-file`, `--channel` or `--release` (one of them), `--scenario-timeout` 30 to 3600, `--report <file>`; `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN` in the environment are ignored (FR-018); progress lines on standard error

### Implementation for US1

- [ ] T022 [US1] `packages/schema/src/scenario/check.ts`: `checkScenarioDocument(value)` for the US1 grammar of contracts/scenario-format.md §1–§5: `format`, `scenario`, `description`, `timeout` (seconds of real time, 30 to 3600), `settle`, `scenarios`; `given` keywords `date` and `time` plus entity IDs; `when` as one step or a list of state, `action` (`target` as an entity ID, a list or `{ entity_id, device_id, area_id }`; `data`) and `event` (`event_type` `^[a-z0-9_]+$`; `data`) steps; `then` items: entity (exactly one entity key), `triggered` (an `automation.*` ID) with `times`, `called` with `target`, `data` and `times`, `not_called`; per-expectation `settle`. Every issue at once, never the first only
- [ ] T023 [US1] `packages/schema/src/scenario/normalize.ts`: `normalizeScenarioDocument(value)` to the shape of data-model.md §1, with the defaults of T014; every scenario, step and expectation carries `path`, its JSON Pointer, so the sandbox can map it to a line (the schema knows no lines)
- [ ] T024 [US1] `packages/schema/src/scenario/resolve.ts`: `resolveSuite(files)` taking `{ file, document }[]` (contracts/library-api.md): unique names across the suite, `file` relative to the configuration directory, `timeout` and `settle` filled from the defaults
- [ ] T025 [US1] `packages/schema/src/scenario/json-schema.ts`: `scenarioJsonSchema` for the same grammar (draft 2020-12, `$id` naming `domusops.scenario/0.1`), usable from an editor with `# yaml-language-server: $schema=…`; add the T016 fixtures under `packages/schema/test/fixtures/scenarios/`
- [ ] T026 [US1] Export `checkScenarioDocument`, `normalizeScenarioDocument`, `resolveSuite` and `scenarioJsonSchema` from `packages/schema/src/index.ts`
- [ ] T027 [US1] Add the scenario and scenario-report formats to the Formats table and export list of `packages/schema/README.md` (identifier; no detail levels; no decoder; `checkScenarioDocument`, `normalizeScenarioDocument`, `resolveSuite`, `compareValue`); write `packages/schema/schema/scenario.schema.json` and `scenario-report.schema.json` from `scenarioJsonSchema` and `scenarioReportJsonSchema` with `packages/schema/scripts/write-schemas.mjs`; `packages/schema/test/scenario-json-schema.test.ts` fails when a file differs from its constant, so US2, US3 and US5 regenerate them with their grammar (FR-002)
- [ ] T028 [US1] `packages/sandbox/src/scenario/load.ts`: `loadScenarios({ config, paths?, names? })` and `ScenarioFileError` (contracts/library-api.md): find files (R2), parse with `yaml` 2.x (`version: "1.2"`, `uniqueKeys: true`, a `LineCounter`), refuse custom tags and merge keys, call the checker, map every JSON Pointer to `line` and `column` through the document's nodes, normalise, resolve, and return `LoadedScenario`s whose scenario carries `line` and whose steps and expectations are mapped in `lines`; no instance is started. `paths` and `names` are accepted but only the default directory is exercised until US4
- [ ] T029 [US1] Add `fireEvent(eventType, data?)` to the `Sandbox` handle in `packages/sandbox/src/instance/handle.ts` (contracts/library-api.md "Handle addition"): `eventType` must match `^[a-z0-9_]+$` (else `TypeError`), posts to `/api/events/<eventType>`; nothing existing changes (FR-031); a case in `packages/sandbox/test/state.test.ts` or the file that tests `setState` today
- [ ] T030 [US1] `packages/sandbox/src/scenario/record.ts`: one WebSocket per scenario over `packages/sandbox/src/ha/ws.ts`, opened right before the first step, subscribed to `state_changed`, `call_service` and `automation_triggered`; each event kept in order as a `Recorded` (data-model.md §3) with `time_fired` as `at`, `call_service` data with its target as found (fact 2), `absent` from `domusops_absent`; at 20 000 events the scenario fails with `recording_limit`; `lastEventAt()` for the quiet wait; closed on every end state
- [ ] T031 [US1] `packages/sandbox/src/scenario/expect.ts`: evaluate one expectation against the handle and the record by research R9 and R10, as T018 specifies; returns a pass or an `ExpectationFailure` (data-model.md §4) with `at` (`then[i]` or `when[j].then[i]`), `line`, `subject`, `check`, `expected` as written, `actual`, `reason`, `read_at`; builds a failed scenario's `activity` from the record
- [ ] T032 [US1] `packages/sandbox/src/scenario/prepare.ts`: read the instance's time zone (`get_config`), freeze the clock at `given.date` + `given.time` in that zone (R8), turn off every automation that is on (`automation.turn_off`, `stop_actions: true`), write the `given` entities in written order with `setState`, then read each back until it holds or `settle` passes; a mismatch gives `starting_point_not_held`; turn the same automations on again (R16). Record the start moment as `"<ISO with offset> <Weekday>"` for the report (FR-006)
- [ ] T033 [US1] `packages/sandbox/src/scenario/outcome.ts`: harness errors → could-not-run causes and `not_run` exactly as data-model.md §6; build `ScenarioResult` (data-model.md §4)
- [ ] T034 [US1] `packages/sandbox/src/scenario/scenario.ts`: one scenario's lifecycle (data-model.md §2): `startSandbox({ release, config: { dir, secretsFile }, devices: [], mode: "tied" })`, prepare, open the recording, run the steps (`states` with `setState`, `action` with `callService`, `event` with `fireEvent`, `expect`), then the final `then`; every expectation still reached is reported; the total time limit counted from the start of the instance (FR-020); `stop()` on every end state, then the result
- [ ] T035 [US1] `packages/sandbox/src/scenario/run.ts`: `runScenarios(options)` (contracts/library-api.md): check the container runtime once with `detectRuntime()` before the first instance, resolve each target once, run each scenario on it in turn (one instance at a time; `parallel` lands in US4), `config_invalid` once per release, `onResult`, the report object with `runner` (`@domusops/sandbox` and its version), `started_at`, `duration_ms`, `counts`, `releases`, `config` (from the first instance that started, `null` when none did), and results in the stable order of contracts/report-format.md §2
- [ ] T036 [US1] `packages/sandbox/src/scenario/report.ts`: build the `ScenarioReport`, `renderReport(report)`, `exitStatus(report)`, and scrub every string with `redact()` from `packages/sandbox/src/errors.ts` using the instance token and `secretValues()` of the secrets file the run was given (R14)
- [ ] T037 [US1] Export `loadScenarios`, `ScenarioFileError`, `runScenarios`, `renderReport`, `exitStatus` and their option and result types from `packages/sandbox/src/index.ts`
- [ ] T038 [US1] Add the `test` subcommand to `packages/sandbox/src/cli.ts` per contracts/cli.md, US1 subset: `--config` (default the current directory), `--secrets-file`, one `--channel` or `--release` (default stable), `--scenario-timeout`, `--report <file>`, `--check`; it only parses, calls `loadScenarios`, `runScenarios` and `renderReport`, prints, and exits with `exitStatus`, or 2 on usage errors and invalid files (FR-021)
- [ ] T039 [P] [US1] Add `packages/sandbox/fixtures/scenario-config/scenarios/helpers.yaml` with `helper_night_motion` (given 03:00 and `presence.house: away`; when `binary_sensor.study_motion: on`; then `input_number.study_brightness` 15, `input_boolean.study_light` on, `triggered: automation.helper_night_motion` `times: 1`, `called: input_boolean.turn_on` on `input_boolean.study_light`); and `packages/sandbox/test/fixtures/scenarios-failing/` (`helpers-30.yaml`, the same scenario expecting 30; `nowhere.yaml`, one expecting `light.nowhere` on) and `packages/sandbox/test/fixtures/scenarios-invalid/` (one file per issue code of T013, each with a known line and column)
- [ ] T040 [US1] Container test `packages/sandbox/test/scenario-reference.container.test.ts` on every channel, running `withScenarios([helpers-30.yaml, nowhere.yaml])`: it fails on exactly the brightness expectation with expected 30 and actual 15 and the others reported with their own outcome (US1 AS2), and on `light.nowhere` with `entity_missing` (AS3); a hash of `packages/sandbox/fixtures/scenario-config` and of the temporary copy is unchanged after the run and no container with the `io.domusops.sandbox` label is left (AS6, FR-018). The passing reference suite (AS1) is proven by the T052 step on every leg, so no leg starts it twice

**Checkpoint**: US1 runs end to end on helpers (quickstart 1 and 3).

---

## Phase 4: User Story 2 - Standing in for devices the sandbox cannot run (P1)

**Goal**: stand-ins take real entity IDs as virtual devices, and declared absent actions are recorded instead of failing, so the SEED example passes.

**Independent Test**: quickstart 2 and 4: `hallway_night_motion` passes with a stand-in light and an absent `media_player.*`; without the stand-in it fails naming the missing entity; an existing entity or an offered action stops the scenario with its reason.

### Tests for US2

- [ ] T041 [P] [US2] `packages/sandbox/test/companion-actions-probe.test.ts` and `packages/sandbox/test/support/probe_actions.py`, as `companion-probe.test.ts` does for the clock (stand-in packages, no container): with every internal present the command installs the wrapper; without `ServiceNotFound` or `ServiceRegistry.async_call` it answers `actions_unavailable` naming the missing one and leaves the registry untouched; a bad pattern answers `invalid_format`; an exact pattern for an offered action answers `action_offered` listing them; a second call replaces the list; an undeclared missing action still raises `ServiceNotFound`; a declared one fires `call_service` with `domusops_absent: true` and returns `None` (or `{}` when a response was asked for)
- [ ] T042 [P] [US2] Extend `packages/schema/test/scenario-check.test.ts` and `scenario-normalize.test.ts`: `stand_ins.<entity_id>` with optional non-empty `class` and `initial`; a domain outside `STAND_IN_KINDS` refused with `stand_in_kind_unsupported` listing the kinds; `absent_actions` as a list of actions or `<domain>.*` (`bad_action` otherwise), deduplicated in first-seen order; add the matching fixtures for T016
- [ ] T043 [P] [US2] `packages/sandbox/test/stand-in-kinds.test.ts`: `STAND_IN_KINDS` from `@domusops/schema` equals `DEVICE_KINDS` from the sandbox (data-model.md §1; the schema cannot import the sandbox)
- [ ] T044 [P] [US2] Extend `packages/sandbox/test/scenario-run.test.ts`: a stand-in whose entity ID already has a state, or whose created `entityId` differs (`light.hallway_2`), gives `stand_in_exists`; `unsupported_device_kind` from the harness gives `stand_in_kind_unsupported`; `virtual_unavailable`; `action_offered` and `actions_unavailable` from the companion; a failed scenario carries up to 5 `instance_errors` (`logger`, `message` cut at 300 characters, scrubbed), read before the instance is removed; a passed one carries none

### Implementation for US2

- [ ] T045 [US2] Extend `packages/schema/src/scenario/check.ts`, `normalize.ts` and `json-schema.ts` with `stand_ins` and `absent_actions` (contracts/scenario-format.md §3); regenerate `packages/schema/schema/`
- [ ] T046 [US2] `packages/sandbox/companion/custom_components/domusops_sandbox/actions.py` and its registration in `__init__.py`: the admin-only command `domusops_sandbox/actions/absent` of contracts/companion.md (patterns 1 to 100; `invalid_format`, `action_offered`, `actions_unavailable`); wraps `ServiceRegistry.async_call` once, catching `ServiceNotFound` only for declared patterns (a domain pattern covers only what that domain does not offer), firing `call_service` with the target merged in and `domusops_absent: true` at the instance's time; internals probed on first use; logs the patterns once at info, never call data (R6)
- [ ] T047 [US2] Extend `packages/sandbox/src/scenario/prepare.ts`: stand-ins by research R5 (kind = domain, `hass-virtual` name = object ID, `class` and `initial` mapped; `getState` must be null first; `addDevices`; each created `entityId` must equal the declared one), then the absent-action patterns through the companion command over the scenario's WebSocket, both before the clock is frozen and the `given` states are written
- [ ] T048 [US2] Extend `packages/sandbox/src/scenario/scenario.ts` and `outcome.ts`: the US2 could-not-run causes; on a failed scenario, read `system_log/list` before `stop()` and keep up to 5 error or warning entries as `instance_errors` (contracts/report-format.md §2)
- [ ] T049 [US2] Extend the fixture: in `packages/sandbox/fixtures/scenario-config/automations.yaml`, `hallway_night_motion` (trigger `binary_sensor.hallway_motion` on, condition `presence.house` away and night, actions `light.turn_on` on `light.hallway` with `brightness_pct: 15`, then `media_player.turn_off` on `media_player.living_room`) and `garage_motion_notice` (trigger `binary_sensor.garage_motion` to `on`; actions `light.turn_on` on the stand-in `light.garage`, then `notify.mobile_app_phone`, then `input_boolean.turn_on` on `input_boolean.notice_sent`); a template switch `switch.fixture_fan` owned by the configuration; `scenarios/hallway.yaml` with the SEED example of contracts/scenario-format.md §9 exactly, and `hallway_daytime_motion` (default time 12:00: `light.hallway` stays `off` and `not_called: light.turn_on`); `scenarios/garage.yaml` with `garage_motion_notice` declaring `notify.mobile_app_phone` absent and expecting it called and `input_boolean.notice_sent` on, and `garage_notice_domain` declaring `notify.*` instead; the reference suite then holds five scenarios, and T059 and T075 bring it to the ten SC-005 measures
- [ ] T050 [P] [US2] Add `packages/sandbox/test/fixtures/scenarios-could-not-run/` (`stand-in-exists.yaml`, a stand-in on `switch.fixture_fan`; `action-offered.yaml`, `input_boolean.turn_on` declared absent) and, in `packages/sandbox/test/fixtures/scenarios-failing/`, `hallway-no-stand-in.yaml` (the SEED scenario without its stand-in) and `garage-no-absent.yaml` (`garage_motion_notice` without its `absent_actions`)
- [ ] T051 [US2] Container test `packages/sandbox/test/scenario-standins.container.test.ts` on every channel, each case through `withScenarios`: the reference `hallway.yaml` passes in under 2 minutes from the call with the image present, measured and printed (US2 AS1, SC-001); `hallway-no-stand-in.yaml` fails with `entity_missing` on `light.hallway`; the two `scenarios-could-not-run` files, run together, give `stand_in_exists` and `action_offered` and `exitStatus` 3; the reference `garage.yaml` passes and `garage-no-absent.yaml` fails with `instance_errors` naming `notify.mobile_app_phone` (US2 AS4)
- [ ] T052 [US2] `.github/workflows/ci.yml`: in each `sandbox-matrix` leg, after the smoke check, a step `Scenario suite` (`if: ${{ !cancelled() }}`) running `node packages/sandbox/dist/cli.js test --config packages/sandbox/fixtures/scenario-config --channel ${{ matrix.channel }} --report scenario-report-${{ matrix.channel }}.json` and uploading `scenario-report-<channel>` (`if: always()`); with no beta in progress the report holds `not_run` rows and the step exits 0; `sandbox-gate` downloads `scenario-report-*` into its own directory, `scenario-reports`, never into `sandbox-results` (`readResults` reads every `.json` there), and runs `supported-versions.mjs --gate sandbox-results --scenarios scenario-reports`. Nothing prints the environment or a token
- [ ] T053 [US2] Extend the gate: a `scenarioGateVerdict(reports)` next to `gateVerdict` in `packages/sandbox/src/results/table.ts`, used by `packages/sandbox/scripts/supported-versions.mjs --gate <dir> --scenarios <dir>`: with `--scenarios`, a missing stable or previous-stable report, or one whose outcome is `failed` or `could_not_run`, fails the gate; beta is listed as a warning, never a failure; the counts per channel go to the job summary (FR-030); cases in `packages/sandbox/test/table.test.ts`

**Checkpoint**: first increment complete (PR-A and PR-B). Validate quickstart 1–4 and open PR-B (it carries T003); the extended `sandbox-gate` blocks on stable and previous stable.

---

## Phase 5: User Story 3 - Time and sequences (P2)

**Goal**: `when` is a sequence with time advancing and expectations between steps; expectations can wait in instance time (`within`) or must hold for a span (`for`).

**Independent Test**: quickstart 5: `hallway_off_after_five_minutes`, `weekday_routine` and `porch_stays_off` pass, each over at least an hour of instance time in under 30 s once ready; with the delay at ten minutes the second expectation fails with `found on at 03:06:00`.

### Tests for US3

- [ ] T054 [P] [US3] Extend the schema tests (`scenario-check`, `scenario-normalize`, fixtures for T016): `when` lists with `advance` (every duration form; `bad_duration` for 0, over 7 days, `"25:00:00"`), `advance_to` (time of day or instant), nested `then` steps; `within` and `for` (`exclusive_keys` together; `for` only on entity expectations); `at` paths `when[j].then[i]`
- [ ] T055 [P] [US3] Extend `packages/sandbox/test/scenario-expect.test.ts` and `scenario-run.test.ts`: `within` advances the clock in steps of max(1 s, duration / 60) and checks after each until it holds or the duration has passed; a `for` span waits for quiet, advances by its duration and fails with `changed_during_span` at the first recorded change of the entity (or the attribute), with its instance time and value; `advance_to` reaches the next occurrence of a time of day, or an instant, and a moment already past fails with `advance_to_past` (`check: "step"`, `subject: "advance_to"`, `expected` the moment, `actual` the instance time)

### Implementation for US3

- [ ] T056 [US3] Extend `packages/schema/src/scenario/check.ts`, `normalize.ts` and `json-schema.ts` with sequences, `advance`, `advance_to`, `then` steps, `within` and `for` (contracts/scenario-format.md §4–§5); regenerate `packages/schema/schema/`
- [ ] T057 [US3] Extend `packages/sandbox/src/scenario/scenario.ts`: `advance` with `time.advance`; `advance_to` computing the seconds in the instance's time zone; `expect` steps between steps, each expectation reported with its `when[j].then[i]` place
- [ ] T058 [US3] Extend `packages/sandbox/src/scenario/expect.ts` with `within` and `for` (research R9)
- [ ] T059 [US3] Extend the fixture: `homeassistant: time_zone` set to a non-UTC zone in `packages/sandbox/fixtures/scenario-config/configuration.yaml` (so the stated offset is exercised); automations `hallway_off_after_five_minutes` (motion off for five minutes turns `light.hallway` off), `weekday_routine` (07:00, weekdays only, turns `input_boolean.morning_routine` on) and `porch_guard` (must not turn `light.porch` on during the day); `scenarios/time.yaml` with `hallway_off_after_five_minutes` (motion off, advance 4 min, expect on, advance 2 min, expect off), `weekday_routine` (default date, `advance_to: "07:00"`, expect triggered once) and `porch_stays_off` (`for: "01:00:00"`)
- [ ] T060 [US3] Container test `packages/sandbox/test/scenario-time.container.test.ts` on every channel: the instance's clock shows the given date and time in the configuration's zone when the starting point is applied (US3 AS1); the default date is reported as `Wednesday` (AS2); the three time scenarios pass, each in under 30 s of real time after ready (SC-006, measured and printed); a copy of the fixture with a ten-minute delay fails the second expectation with `found on at 03:06:00` (quickstart 5); a change during a `for` span reports its instance time and value (AS4)
- [ ] T061 [US3] Add `.changeset/scenario-time.md` (`@domusops/schema` minor and `@domusops/sandbox` minor: sequences, time steps, `within`, `for`)

**Checkpoint**: US3 is demonstrable on its own (quickstart 5).

---

## Phase 6: User Story 4 - Running a suite of scenarios in CI and for an agent (P2)

**Goal**: one command runs a selection of scenarios on one or more releases, with a stable order, a compact machine report, an exit status for CI and a documented example workflow that CI proves.

**Independent Test**: quickstart 6 and 9, and the `scenario-example` CI job: a suite with one passing and one failing scenario exits 1, the report names each release, and the machine report is at least 5 times smaller than the readable one.

### Tests for US4

- [ ] T062 [P] [US4] Extend `packages/sandbox/test/scenario-cli.test.ts`: a positional argument that names an existing file or directory is a path, any other is a name; paths choose the files and names filter them; a name that matches nothing is a usage error naming it (exit 2); `--channel` and `--release` repeat and keep their order; `--parallel` 1 to 8; `--json` prints the machine report on standard output instead of the readable one
- [ ] T063 [P] [US4] Extend `packages/sandbox/test/scenario-run.test.ts`: with `parallel: 3` no more than three instances run at once and the report order stays release order, then file path, then position, whatever the completion order; a beta target with no beta in progress gives one `not_run` row per scenario and does not change the exit status
- [ ] T064 [P] [US4] Extend `packages/sandbox/test/scenario-report.test.ts` with SC-009: for a 10-scenario report with one failure, the machine report (`JSON.stringify`, as written by `--report`) is at least 5 times smaller than the readable one
- [ ] T065 [P] [US4] `packages/sandbox/test/scenario-example.test.ts`: the commands of the `scenario-example` job in `.github/workflows/ci.yml` equal the workflow block between `<!-- domusops:scenario-example:start -->` and `<!-- domusops:scenario-example:end -->` in `packages/sandbox/docs/scenarios.md` (FR-021a); every YAML scenario block in that document and in `packages/sandbox/README.md` passes `loadScenarios` checks (SC-008)

### Implementation for US4

- [ ] T066 [US4] Extend `packages/sandbox/src/scenario/load.ts` with `paths` and `names` selection (FR-023)
- [ ] T067 [US4] Extend `packages/sandbox/src/scenario/run.ts`: several targets in the order given, `parallel` instances at once (default 1, R1), the stable report order (FR-022)
- [ ] T068 [US4] Extend the `test` subcommand in `packages/sandbox/src/cli.ts` with positional names and paths, repeated `--channel`/`--release`, `--parallel` and `--json` (contracts/cli.md)
- [ ] T069 [US4] Write `packages/sandbox/docs/scenarios.md`: what a scenario is, the format by example (pointing to the JSON Schema for editors), comparisons (R10), the default date 2026-04-15 and time 12:00, stand-ins and absent actions, time and sequences, named starting points, running (`test`, exit codes, reports), and the example CI workflow between the markers of T065, failing the job when a scenario fails or could not run; synthetic entities only; trademark-safe wording (§6)
- [ ] T070 [US4] Add the `scenario-example` job to `.github/workflows/ci.yml`: pack `@domusops/schema`, `@domusops/mcp` and `@domusops/sandbox` with `pnpm pack`, build a throwaway repository from `packages/sandbox/fixtures/scenario-config`, install the three tarballs with one `npm install <schema.tgz> <mcp.tgz> <sandbox.tgz>` as a user would from the registry (`pnpm pack` writes the workspace dependencies as their current, unreleased versions, so they must be installed together), and run exactly the documented commands on stable (FR-021a, SC-008); not a required check
- [ ] T071 [US4] Add `.changeset/scenario-suite.md` (`@domusops/sandbox` minor: selection, several releases, `--parallel`, `--json`, the scenarios documentation)

**Checkpoint**: US4 is demonstrable on its own (quickstart 6, 9 and 10).

---

## Phase 7: User Story 5 - Reusable starting points (P3)

**Goal**: named starting points defined once and referred to with `use`, applied first, in order, then the scenario's own `given`.

**Independent Test**: quickstart 7: two `night_*` scenarios share `empty_house_night`, one overriding `presence.house`, and both pass; a cycle is refused before any instance starts.

### Tests for US5

- [ ] T072 [P] [US5] Extend `packages/schema/test/scenario-check.test.ts` and `scenario-resolve.test.ts` (and the T016 fixtures): `starting_points` with the `given` grammar; `use` as a name or a list; references applied in order, then the scenario's own values, which replace earlier ones key by key (an entity's whole value, `date`, `time`) while `stand_ins` and `absent_actions` accumulate; `unknown_starting_point`, `starting_point_cycle` and `duplicate_starting_point` name the reference and where it is (FR-009)

### Implementation for US5

- [ ] T073 [US5] Extend `packages/schema/src/scenario/check.ts`, `normalize.ts` and `json-schema.ts` with `starting_points` and `use` (contracts/scenario-format.md §3, §6); regenerate `packages/schema/schema/`
- [ ] T074 [US5] Extend `packages/schema/src/scenario/resolve.ts`: apply `use` across the files of the suite, refuse unknown references, cycles and duplicate starting-point names
- [ ] T075 [US5] Add `packages/sandbox/fixtures/scenario-config/scenarios/night.yaml` with `empty_house_night` and two scenarios `night_motion_away` and `night_motion_home`, the second overriding `presence.house: home` and expecting no light; and `packages/sandbox/test/fixtures/scenarios-invalid/cycle.yaml` (two starting points referring to each other)
- [ ] T076 [US5] Extend `packages/sandbox/test/scenario-cli.test.ts`: `cycle.yaml` is refused with `starting_point_cycle` and no container started (US5 AS2); both `night_*` scenarios passing, each with its own `presence.house` (AS1), is proven by the T052 step on every leg
- [ ] T077 [US5] Add `.changeset/scenario-starting-points.md` (`@domusops/schema` minor and `@domusops/sandbox` minor: named starting points)

**Checkpoint**: every story is demonstrable; the reference suite holds about ten scenarios.

---

## Phase 8: Polish & cross-cutting

- [ ] T078 [P] Container test `packages/sandbox/test/scenario-determinism.container.test.ts`: `hallway_off_after_five_minutes` 20 times on one release gives one outcome (SC-004); runs only when `DOMUSOPS_SANDBOX_CHANNEL` is `stable` or unset; the run count is `DOMUSOPS_DETERMINISM_RUNS`, default 20
- [ ] T079 [P] Update `packages/sandbox/README.md`: a "Scenarios" section (what, one example, `domusops-sandbox test`, a link to `docs/scenarios.md`; the example is checked by T065); never a real instance; trademark-safe wording
- [ ] T080 [P] Update `CLAUDE.md` "Current focus": the scenario and assertion DSL (006) is the current feature, with the published versions unchanged until release
- [ ] T081 Run quickstart scenarios 1–10 from `specs/006-scenario-dsl/quickstart.md`; record any deviation and the measured SC-001, SC-005 (from the CI legs) and SC-006 times in `specs/006-scenario-dsl/research.md`
- [ ] T082 Run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm --filter @domusops/sandbox run test:container`; every file in the diff is English (§1); no fixture, scenario or example names a real entity, person or schedule (FR-032); no report written by the tests contains a token
- [ ] T083 Mark all tasks `[X]`; show the diff and wait for the maintainer's confirmation before any commit, push or pull request (the maintainer runs merges)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 → US2 (US1 + US2 = first mergeable increment, with the CI wiring of T052–T053) → US3, US4, US5.
- T011 (the five facts) must pass on all three channels before T030 (record), T031 (expect), T032 (prepare) and T046 (companion wrapper) are considered done; a failed fact updates research.md first.
- US2 extends `prepare.ts`, `scenario.ts` and the fixture from US1. US3 extends `scenario.ts` and `expect.ts`; US4 extends `load.ts`, `run.ts` and `cli.ts`; US5 extends the schema checker and `resolve.ts`. US3, US4 and US5 are independent of each other but touch `check.ts`, `normalize.ts` and `json-schema.ts`, so those edits run one story at a time.
- Inside a story: tests and independent files [P] first, then schema edits, then `prepare.ts`/`scenario.ts`/`run.ts`/`cli.ts` edits in order (same files, never parallel).
- T078 needs US3 (its scenario); T081 needs every story.

## Parallel Examples

- Phase 2: T005, T006, T007, T008 and T010 together; T011 once T010 exists; T012 at the start of PR-B, once `fireEvent` and `Recorded` exist (T029, T030).
- US1: T013–T021 together; then T022–T027 (schema) alongside T029 and T030 (sandbox, different files).
- US2: T041, T042, T043, T044 together; T046 (Python) alongside T045 (schema).
- US4: T062, T063, T064 and T065 together; T069 (docs) alongside T066–T068.

## Implementation Strategy

1. MVP = Phase 1, Phase 2, US1 and US2, in two pull requests. PR-A (format in the schema, carrying T002) merges first; PR-B (runner, stand-ins, absent actions, the `test` command, the gate, carrying T003) follows on a fresh branch. Then the SEED example passes in a throwaway instance, the `test` command runs the reference suite, and `sandbox-gate` blocks on stable and previous-stable failures. Validate with quickstart 1–4.
2. Add US3, US4 and US5 as one small pull request each, each with its own changeset and its quickstart scenario.
3. Finish with the polish phase: determinism, README, `CLAUDE.md`, the measured times and the full gate.
