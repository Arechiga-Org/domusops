---
description: "Task list for the @domusops/sandbox ephemeral harness (part 1 of 2)"
---

# Tasks: Sandbox harness (`@domusops/sandbox`, part 1)

**Input**: Design documents from `/specs/005-sandbox-harness/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R16), data-model.md, contracts/ (library-api, cli, companion, run-result), quickstart.md

**Tests**: Included. The plan fixes the test layout (R15): unit tests run in the default `pnpm test`; `*.container.test.ts` run only with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: Grouped by user story. US1 + US2 (both P1) form the first mergeable increment (constitution §9, branches under 3 days).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1..US6, from spec.md
- All paths are relative to the repository root. `sandbox/` below means `packages/sandbox/`.
- Everything written to the repository is English (constitution §1).

---

## Phase 1: Setup

- [X] T001 Update `packages/sandbox/package.json`: description "Ephemeral test harness for Home Assistant: throwaway instances, virtual devices, time control"; `bin` `{"domusops-sandbox": "dist/cli.js"}`; `files` `["dist", "companion", "fixtures", "schema"]`; dependencies `tar` (^7), `@domusops/mcp` (`workspace:*`), `@modelcontextprotocol/sdk` (same range as `packages/mcp`); remove the `@domusops/schema` dependency; add the script `"test:container": "DOMUSOPS_CONTAINER_TESTS=1 vitest run --root ../.. packages/sandbox/test"` (same form as `bootstrap`'s `test:bootstrap:container`); keep `version` at `0.0.0` (the changeset in T006 sets 0.1.0)
- [X] T002 [P] Create `packages/sandbox/tsconfig.json` and `packages/sandbox/tsconfig.test.json` mirroring `packages/bootstrap`; add `packages/sandbox/tsconfig.test.json` to the root `typecheck` script in `package.json`
- [X] T003 [P] Create `packages/sandbox/test/support/channels.ts` exporting `CHANNELS`: the single channel in `DOMUSOPS_SANDBOX_CHANNEL` when set (one CI matrix leg), otherwise stable, previous-stable and beta. Container tests need no skip logic of their own: `vitest.config.ts` already excludes `*.container.test.ts` unless `DOMUSOPS_CONTAINER_TESTS` is set
- [X] T004 [P] Create the skeleton `packages/sandbox/README.md` (what it is, Docker is the only hard dependency, never touches a real instance, trademark-safe wording per constitution §6; usage sections are completed in T072)
- [X] T005 Run `pnpm install` and confirm `pnpm typecheck` and `pnpm lint` still pass with the new package.json (lockfile updated, no stale `@domusops/schema` reference)
- [X] T006 Add `.changeset/sandbox-harness.md` (`@domusops/sandbox` minor, first release 0.1.0: start, stop, list, cleanup, resolve) so the first pull request (US1 + US2) carries its own changeset (constitution §9)

---

## Phase 2: Foundational (blocks every story)

- [X] T007 Create `packages/sandbox/src/errors.ts`: `SandboxError` with a `code` union exactly `runtime_missing | channel_unresolved | no_beta_in_progress | image_unavailable | not_ready | config_invalid | config_dir_invalid | virtual_unavailable | unsupported_device_kind | not_a_sandbox | instance_gone | time_control_failed`, an English `message`, optional `logs` (the last 50 log lines, for `not_ready` only); a `redact()` helper so no message ever contains a token (data-model.md "Error codes"). Invalid options are programmer errors, not `SandboxError`s: `channel` and `release` together, a `release` that fails the release regex, `maxLifetimeMinutes` outside 1..1440, or `readinessTimeoutSeconds` ≤ 0 throw `TypeError`/`RangeError`; the CLI maps them to exit code 2
- [X] T008 [P] Create `packages/sandbox/src/release/versions.ts`: `Channel` (`stable | previous-stable | beta`), the release regex `^\d{4}\.\d{1,2}\.\d+(b\d+)?$`, parse and compare functions; unit tests in `packages/sandbox/test/versions.test.ts` (valid/invalid releases, beta ordering, `2026.9.3` < `2026.10.0b1`)
- [X] T009 [P] Create `packages/sandbox/src/runtime/docker.ts`: a `Runtime` interface (run, create, start, stop, rm, cp stdin tar, exec, port, logs, ps by label, inspect, image inspect) and a spawn-based implementation of the `docker`/`podman` CLI (R2): `DOMUSOPS_CONTAINER` override, `runtime_missing` when neither is found or the daemon is down, image prefix `ghcr.io/home-assistant/home-assistant`, `--user uid:gid` as in `packages/bootstrap/src/env/container.ts`; no shell string interpolation, argument arrays only
- [X] T010 [P] Create `packages/sandbox/src/runtime/labels.ts`: label keys `io.domusops.sandbox=1`, `.id`, `.mode`, `.deadline`, `.owner-host`, `.owner-pid`, `.release`; container name `domusops-sandbox-<id>`; id = 12 lowercase hex random; build and parse functions; unit tests in `packages/sandbox/test/labels.test.ts`
- [X] T011 [P] Create `packages/sandbox/test/support/fake-runtime.ts`: an in-memory `Runtime` that records calls and holds labelled containers, for the unit tests of resolve, reaper, handle and cli

**Checkpoint**: errors, versions, runtime wrapper and labels exist; stories can start.

---

## Phase 3: User Story 1 - Start a ready instance (P1) 🎯 MVP

**Goal**: one call starts a throwaway instance at a chosen channel or release, ready with a known admin token and no manual onboarding, reachable only on `127.0.0.1`.

**Independent Test**: `sbx start -- sh -c 'curl -sf -H "Authorization: Bearer $DOMUSOPS_HA_TOKEN" "$DOMUSOPS_HA_URL/api/config"'` exits 0 in under 3 minutes with the image present (quickstart 1 and 2; SC-001).

### Tests for US1

- [X] T012 [P] [US1] `packages/sandbox/test/resolve.test.ts`: stub the PyPI JSON; stable = newest non-pre-release; previous stable = newest release of the month series before stable; beta = newest `b` release; `no_beta_in_progress` when the newest beta is not newer than stable; `channel_unresolved` on network or parse failure; an explicit `--release` is validated against the release regex

### Implementation for US1

- [X] T013 [US1] `packages/sandbox/src/release/resolve.ts`: `resolveChannel(channel)` reading `https://pypi.org/pypi/homeassistant/json` (R3); the result carries the release string and the image tag
- [X] T014 [P] [US1] `packages/sandbox/src/ha/rest.ts`: minimal `fetch` helpers (JSON POST, bearer GET) with timeouts, never logging a token
- [X] T015 [P] [US1] `packages/sandbox/src/ha/ws.ts`: minimal WebSocket client of its own (R11): auth handshake, request/response by id, `close()` rejecting pending commands, no dependency on `@domusops/mcp` client code
- [X] T016 [US1] Create the companion skeleton `packages/sandbox/companion/custom_components/domusops_sandbox/manifest.json` (dependencies `http`, `api`, `websocket_api`, `onboarding`, `auth`, `config`) and `__init__.py` with only the admin-only `domusops_sandbox/info` command returning `{ id, mode, deadline, frozen }` from `DOMUSOPS_SANDBOX_ID`, `DOMUSOPS_SANDBOX_MODE`, `DOMUSOPS_SANDBOX_DEADLINE` (contracts/companion.md)
- [X] T017 [US1] `packages/sandbox/src/config/pack.ts`: `packConfig()` builds the in-memory tar (`tar` package, R5) with the baseline `configuration.yaml` (`default_config:` plus a `domusops_sandbox:` line) and the companion directory; directory input is added in T039
- [X] T018 [US1] `packages/sandbox/src/instance/onboard.ts`: onboarding over HTTP per R4 (`/api/onboarding/users` with client_id `http://domusops-sandbox/`, `/auth/token`, `core_config`, `analytics`, `integration`), then WebSocket `auth/long_lived_access_token` (client name `domusops-sandbox`, 1-day lifespan); the token is written only inside the container at `/config/.domusops-sandbox/token` with mode 0600 (through `exec`, never through a host file) and held in memory by the handle
- [X] T019 [US1] `packages/sandbox/src/instance/ready.ts`: readiness per R9 (HTTP up, onboarding done, `get_config` state RUNNING, then `check_config`); default limit 150 s; on timeout throw `not_ready` with the last 50 log lines
- [X] T020 [US1] `packages/sandbox/src/instance/start.ts`: `startSandbox(options)` through the lifecycle resolving → pulling → creating → starting → onboarding → validating → ready (data-model.md): `docker create --rm --init --entrypoint python … -m homeassistant --config /config` with labels, `-p 127.0.0.1::8123`, files copied with `docker cp -` from the tar, port read back with `docker port`; calls `onProgress(state)` on every lifecycle state; any failure removes the container before rethrowing (failed → gone); an image already present locally is used without pulling (release tags never change); `image_unavailable` only when the pull fails and the image is absent; `--readiness-timeout` option
- [X] T021 [US1] `packages/sandbox/src/instance/handle.ts`: the `Sandbox` handle basics: `id`, `release` (a `ResolvedRelease`, which carries the channel and whether it is a beta; US1 scenario 3), `mode`, `url` (always `http://127.0.0.1:<port>`), `deadline`, `config` (`ConfigSummary | null`, `null` until T039), `connection()`; `stop()` that removes the container; the token is never in `toString`, JSON or error output
- [X] T022 [US1] `packages/sandbox/src/index.ts`: export `resolveChannel`, `startSandbox`, the `Sandbox` type and `SandboxError`
- [X] T023 [US1] `packages/sandbox/src/cli.ts`: `resolve <channel>` and `start [opts] -- <cmd>` (tied mode runs the command with `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN` set, stops the instance when it exits, returns the command's exit code); options `--channel`, `--release`, `--readiness-timeout`; exit codes 0/1/2/3 (contracts/cli.md); the CLI ignores `DOMUSOPS_HA_*` from its own environment; progress on stderr from `onProgress`; `--json`
- [X] T024 [P] [US1] `packages/sandbox/test/cli.test.ts`: argument parsing, exit codes, usage error code 2, `DOMUSOPS_HA_*` in the environment is ignored, `--json` output shape (using the fake runtime)
- [X] T025 [US1] Container test `packages/sandbox/test/onboard.container.test.ts` on stable, previous-stable and beta (skip beta when `no_beta_in_progress`): ready in under 180 s with the image already present (SC-001) and with a known admin token, `/api/config` answers, no manual onboarding, port bound to `127.0.0.1` only, `not_ready` returns at most 50 log lines. This is the R4 verification: if an onboarding body is wrong, fix `onboard.ts` and update `specs/005-sandbox-harness/research.md` R4 before continuing
- [X] T026 [US1] Confirm in the same test that the container exits when HA stops under `--entrypoint python` with `--init` (R1); if it does not, update research R1 and `start.ts`

**Checkpoint**: US1 is demonstrable on its own (quickstart 1 and 2).

---

## Phase 4: User Story 2 - Clean teardown, crash safety, never a real instance (P1)

**Goal**: nothing is left behind after success, failure, SIGKILL of the owner, or deadline; the harness can only act on containers it created.

**Independent Test**: `sbx start -- sleep 600 &`, wait for ready, `kill -9`: the container is gone within 25 s (quickstart 7 and 9; SC-002, SC-007).

### Tests for US2

- [X] T027 [P] [US2] `packages/sandbox/test/reaper.test.ts` (fake runtime) covers the data-model decision table: deadline passed → remove; tied + same host + owner pid dead → remove; other host → keep; a container without the `io.domusops.sandbox=1` label is never touched
- [X] T028 [P] [US2] Extend `packages/sandbox/test/cli.test.ts` for `list`, `stop <id>…`, `stop --all`, `cleanup`, `start --background` (never prints the token) and `not_a_sandbox` for an unlabelled id

### Implementation for US2

- [X] T029 [US2] Extend the companion `__init__.py`: stop the instance at `DOMUSOPS_SANDBOX_DEADLINE` checked against real time (exit code 0); `attach`/`detach` commands; in tied mode an owner connection that closes without `detach` stops the instance after a 15 s grace unless a new connection attaches; no attach within 300 s of startup stops it; never open network connections, never read outside `/config`
- [X] T030 [US2] `packages/sandbox/src/runtime/reaper.ts`: scan containers labelled `io.domusops.sandbox=1` and apply the decision table; return ids removed and the reason
- [X] T031 [US2] `packages/sandbox/src/instance/list.ts`: `listSandboxes()` from labels only (id, mode, release, url, deadline, owner)
- [X] T032 [US2] Extend `handle.ts` and `index.ts`: `attachSandbox(id)` (reads the token back from `/config/.domusops-sandbox/token` with `exec`, research R4), `stopSandbox(id)`, `cleanup()`; every call checks the label and the companion `info` id, else `not_a_sandbox` or `instance_gone`; `detach()` leaves a background instance running
- [X] T033 [US2] Extend `start.ts`: `mode` (`tied` default, `background`), `maxLifetime` (default 2 h, "1 min ≤ value ≤ 24 h", otherwise a usage error), deadline label and environment, run the reaper before creating and return every id it removed with the reason (FR-017); in tied mode register `exit`, `SIGINT` and `SIGTERM` handlers and attach the owner WebSocket; concurrent starts must not collide on ids or ports (FR-020)
- [X] T034 [US2] Extend `cli.ts`: `list`, `stop`, `cleanup`, `start --background` and `--max-lifetime`; refuse any id that is not a labelled sandbox (FR-019); `start` prints the reaper's removals on stderr
- [X] T035 [US2] Container test `packages/sandbox/test/teardown.container.test.ts`: normal stop leaves no container or dangling volume; `kill -9` of the owner process removes the container within 25 s; a 1-minute deadline removes a background instance; two concurrent starts both succeed on different ports and neither tears down the other; a foreign (unlabelled) container id is refused and untouched; a SIGINT during startup, before ready, leaves no container; the concurrency case runs `DOMUSOPS_SANDBOX_PAIRS` pairs (default 1; 10 in T073 for SC-008)

**Checkpoint**: US1 + US2 = first mergeable increment. Run `pnpm lint && pnpm typecheck && pnpm test` and the container tests, then stop and review before US3.

---

## Phase 5: User Story 3 - Load a repository's configuration (P2)

**Goal**: a configuration directory from a repository runs in the sandbox without secrets and without modifying the source.

**Independent Test**: byte-identity check of the source directory before and after (quickstart 4; SC-003).

- [X] T036 [P] [US3] `packages/sandbox/test/pack.test.ts`: excludes `.storage/`, `.cloud/`, `deps/`, `tts/`, `backups/`, `__pycache__/`, `.git/`, `home-assistant_v2.db*`, `*.log*`, `.HA_VERSION`, `secrets.yaml`, `secrets.sops.yaml` and age key files; links resolving outside the source are skipped and reported; the source tree is byte-identical after packing it 20 times in a row (SC-003); nothing is ever written to `config.dir`; appends `custom_components/domusops_sandbox/`, a generated `secrets.yaml` and the `domusops_sandbox:` line in `configuration.yaml`
- [X] T037 [P] [US3] `packages/sandbox/test/secrets.test.ts`: typed placeholders `domusops-placeholder-<key>`, or `0`/`0.0`/`false` from `ENC[…,type:…]` markers (R8); a caller-named plaintext secrets file wins; the generated file never contains values from a real `secrets.yaml`
- [X] T038 [US3] `packages/sandbox/src/config/secrets.ts`: collect `!secret` references from the YAML files and produce the generated `secrets.yaml` (placeholders or the `--secrets-file` content)
- [X] T039 [US3] Extend `packages/sandbox/src/config/pack.ts` to accept `config.dir` with the exclusion list and the symlink rule above; return a `ConfigSummary` (fields in data-model.md: excluded patterns, skipped links, `secrets: placeholders|file`); invalid directory → `config_dir_invalid`; `start.ts` sets the handle's `config` to that summary
- [X] T040 [US3] Config validation in `start.ts`: after boot run `check_config`; failures end with `config_invalid`, the validation errors, and the container removed
- [X] T041 [US3] `packages/sandbox/fixtures/reference-config/configuration.yaml` and `packages/sandbox/fixtures/reference-config/packages/smoke.yaml` (an automation at 03:00 that turns on a light from the virtual device `Hall`; no real-instance content, nothing copied from a real repository) Also add `fixtures` to `files` in `packages/sandbox/package.json`.
- [X] T042 [US3] Add `--config <dir>` and `--secrets-file <file>` to `cli.ts` and print the `ConfigSummary` on start
- [X] T043 [US3] Container test `packages/sandbox/test/config.container.test.ts`: reference config loads and the source checksum is unchanged; a `!secret` reference without a plaintext file boots with placeholders; an invalid `configuration.yaml` ends with `config_invalid` and no container left
- [X] T044 [US3] Add `.changeset/sandbox-config.md` (`@domusops/sandbox` minor: `--config`, `--secrets-file`, configuration loading)

**Checkpoint**: US3 works with US1 alone.

---

## Phase 6: User Story 4 - Virtual devices, states, and time (P2)

**Goal**: add virtual devices by reusing `hass-virtual`, set and read states, freeze and advance time.

**Independent Test**: the `time.container.test.ts` scenario (quickstart 5; SC-004), under 10 s of real time.

- [ ] T045 [US4] Verify the hass-virtual config-flow field names (`group_name`, `file_name` in R7) against v0.9.3 from a throwaway container before writing code; if they differ, update research R7 first
- [ ] T046 [P] [US4] `packages/sandbox/test/virtual.test.ts`: device validation exactly as data-model.md ("name 1–64 chars and unique", kind one of `switch|binary_sensor|sensor|light|lock|fan|cover|valve|device_tracker`), `unsupported_device_kind`, `class` and `initial` passed through, the `domusops-virtual.yaml` rendering; packing with devices requested appends `custom_components/virtual/` and `domusops-virtual.yaml`, and packing without devices appends neither
- [ ] T047 [US4] `packages/sandbox/src/devices/fetch.ts`: download `twrecked/hass-virtual` v0.9.3 pinned by SHA-256 into `$XDG_CACHE_HOME/domusops/sandbox` (fallback `~/.cache`), verify the digest, `virtual_unavailable` on a mismatch or download failure (R7)
- [ ] T048 [US4] `packages/sandbox/src/devices/virtual.ts`: render `domusops-virtual.yaml`, create the config entry through the config-flow HTTP API, read back the resulting `entityId`; extend `packages/sandbox/src/config/pack.ts` to add `custom_components/virtual/` and `domusops-virtual.yaml` only when devices are requested; when the config entry fails to set up (the integration does not load on this release), throw `virtual_unavailable` naming the integration (`hass-virtual` v0.9.3) and the release (FR-011)
- [ ] T049 [US4] `packages/sandbox/companion/custom_components/domusops_sandbox/clock.py` and the `time/freeze`, `time/advance` (seconds > 0 and ≤ 7 days), `time/resume`, `time/now` commands in `__init__.py` with error codes `not_frozen`, `invalid_time`, `time_control_failed`; `advance` without a prior freeze freezes first and runs due timers (`fired`)
- [ ] T050 [US4] Extend `start.ts` to accept the `devices` option and create them before `ready` (contracts/library-api.md); extend `handle.ts` and `index.ts`: `addDevices`, `setState`, `getState`, `callService`, and `time.{freeze,advance,resume,now}` mapped to the companion commands and the ha/ws client
- [ ] T051 [US4] Add repeatable `--device <kind>:<name>[:<class>]` to `cli.ts`
- [ ] T052 [US4] Container tests `packages/sandbox/test/virtual.container.test.ts` and `packages/sandbox/test/time.container.test.ts` on all channels: `binary_sensor.hall` set to `on` and read back; freeze 02:59:50, advance 20 s, the reference automation fires once and the light is `on`, within 10 s of real time measured from freeze to the read-back (SC-004); hass-virtual v0.9.3 loads on the 2026 releases (if not, record it and change the pin before continuing)
- [ ] T053 [US4] Add `.changeset/sandbox-devices-time.md` (`@domusops/sandbox` minor: virtual devices, entity states, time control)

**Checkpoint**: US4 independently verifiable.

---

## Phase 7: User Story 5 - Reach the instance with existing tools (P2)

**Goal**: point `@domusops/mcp` and a WebSocket client at the sandbox with no change to either.

**Independent Test**: quickstart 6 (SC-005).

- [ ] T054 [US5] Extend `handle.ts`: `connection()` and `mcpEnv()` return exactly the two keys `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`; no function in the library accepts a URL or a token (R10)
- [ ] T055 [US5] Add `env <id>` to `cli.ts`: the only command that prints a token, as `KEY=value` lines usable with `eval` or a `.env` file
- [ ] T056 [US5] Container test `packages/sandbox/test/mcp.container.test.ts`: start `@domusops/mcp` from its built entry with the `mcpEnv()` environment and call `ha_snapshot`; open a WebSocket and run `get_states`; assert `packages/mcp` is untouched by this feature (`git diff --stat main -- packages/mcp` empty); after `stop()`, the old URL and token no longer work (US5 scenario 4)
- [ ] T057 [US5] Add `.changeset/sandbox-env.md` (`@domusops/sandbox` minor: the `env` command, `connection()`, `mcpEnv()`)

---

## Phase 8: User Story 6 - CI proves the supported versions (P3)

**Goal**: a CI job runs the smoke check per channel and the README table is generated from its results, never hand-written (constitution §8).

**Independent Test**: quickstart 3 and 10 (SC-006: each row links to the recorded CI run).

- [ ] T058 [P] [US6] `packages/sandbox/schema/run-result.schema.json` for `domusops.sandbox-result/0.1` (contracts/run-result.md: `release` absent only for `no-beta-in-progress`; `failedStep` present exactly when the outcome is `failed` or `could-not-run`; `steps` empty for `could-not-run` and `no-beta-in-progress`; `message` ≤ 300 characters) Also add `schema` to `files` in `packages/sandbox/package.json`.
- [ ] T059 [P] [US6] `packages/sandbox/test/result.test.ts`: results validate against the schema; no token, secret or entity state in a message
- [ ] T060 [P] [US6] `packages/sandbox/test/smoke.test.ts`: with `DOMUSOPS_HA_URL=http://192.0.2.1:8123` and a `DOMUSOPS_HA_TOKEN` set in `process.env`, the mcp-snapshot step spawns the MCP server with an environment built from scratch: `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN` equal the `mcpEnv()` values, and nothing else comes from `process.env` except `PATH` and `HOME` (FR-019, quickstart 9); `steps.ts` takes the spawn function as an injectable dependency for this test
- [ ] T061 [US6] `packages/sandbox/src/results/result.ts`: build and write the result JSON (runner, `sandboxVersion`, `ciRunUrl` from `GITHUB_*`)
- [ ] T062 [US6] `packages/sandbox/src/smoke/steps.ts`: the eight steps (start, load-config, virtual-device, set-state, time, mcp-snapshot, websocket, teardown) on the reference config; the MCP step builds its environment from scratch Also add the `@domusops/mcp` (`workspace:*`) and `@modelcontextprotocol/sdk` (same range as `packages/mcp`) dependencies to `packages/sandbox/package.json`, and run `pnpm install`; they were left out of the MVP because nothing imported them.
- [ ] T063 [US6] `packages/sandbox/src/smoke/run.ts`: `runSmoke`; the first failure is recorded, later steps are `skipped`, teardown always runs; outcomes `passed`, `failed`, `could-not-run`, `no-beta-in-progress` (FR-023); export `runSmoke` from `packages/sandbox/src/index.ts`
- [ ] T064 [US6] Add `smoke [--channel|--release] [--result <file>]` to `cli.ts` with the exit codes of contracts/cli.md (0 passed or no beta, 1 failed, 3 could not run)
- [ ] T065 [P] [US6] `packages/sandbox/src/results/table.ts`: `renderSupportedVersions` over `docs/supported-versions.json` (`domusops.supported-versions/0.1`, one row per channel in the order stable, previous-stable, beta) producing the README table of contracts/run-result.md; export `renderSupportedVersions` from `packages/sandbox/src/index.ts`
- [ ] T066 [US6] `packages/sandbox/scripts/supported-versions.mjs` and the root `package.json` script `sandbox:table` (`--run <id>`, downloads artifacts with `gh run download`, rewrites `docs/supported-versions.json` and the README block between `<!-- domusops:supported-versions:start -->` and `<!-- domusops:supported-versions:end -->`, touching nothing outside the markers)
- [ ] T067 [US6] Add the two markers and an initial generated block to the root `README.md` and create `docs/supported-versions.json` from the first smoke run
- [ ] T068 [US6] `packages/sandbox/test/readme-table.test.ts`: fails when the README block differs from the rendering of `docs/supported-versions.json` (FR-024)
- [ ] T069 [US6] `.github/workflows/ci.yml`: replace the `sandbox-matrix` placeholder with a channel matrix that builds the package (`pnpm --filter @domusops/sandbox... build`) and runs `node packages/sandbox/dist/cli.js smoke --channel <leg> --result <file>` (FR-032) on pull requests, `main` and a weekly schedule, uploading the result artifacts; the beta leg is `continue-on-error`; add `sandbox-gate` (`needs: sandbox-matrix`, `if: always()`) that fails when a stable result is not `passed` and writes the table to the job summary (FR-025); each matrix leg also runs `pnpm --filter @domusops/sandbox run test:container` with `DOMUSOPS_SANDBOX_CHANNEL` set to its channel (research R15; the container tests skip beta when no beta is in progress); no step runs `env` or prints a token (FR-005)
- [ ] T070 [US6] Add `.changeset/sandbox-smoke.md` (`@domusops/sandbox` minor: the `smoke` command, run results, the supported-versions table)

---

## Phase 9: Polish & cross-cutting

- [X] T071 [P] Update `CLAUDE.md` "Current focus": `ha_snapshot`, `ha_logbook_query`, `ha_trace` and `ha-bootstrap` are merged; the current feature is `@domusops/sandbox` part 1
- [ ] T072 [P] Complete `packages/sandbox/README.md`: library and CLI usage, the supported-versions pointer, the security notes (never a real instance, token never printed except by `env`), trademark-safe wording
- [ ] T073 Run the quickstart scenarios 1–10 from `specs/005-sandbox-harness/quickstart.md` and record any deviation in `specs/005-sandbox-harness/research.md`; run the concurrency case with `DOMUSOPS_SANDBOX_PAIRS=10` (SC-008) and record the measured SC-001 and SC-004 times
- [ ] T074 Run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm --filter @domusops/sandbox run test:container` (not `DOMUSOPS_CONTAINER_TESTS=1 pnpm test`, which also runs `bootstrap`'s container test and needs `sops` and `age`); every file in the diff is English (§1); no hand edit in the README block
- [ ] T075 Mark all tasks `[X]`; show the diff and wait for the maintainer's confirmation before any commit or push (the maintainer runs force pushes and merges), then mention that `sandbox-gate` must be added to the required checks on `main`

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 → US2 (US1 + US2 = first mergeable increment) → US3, US4, US5, US6.
- US3 extends `pack.ts` and `start.ts` from US1/US2; US4 needs the reference config of US3 (T041) for its time test; US5 needs only US1; US6 needs US3, US4 and US5 (the smoke steps use all of them).
- Inside a story: tests and independent files [P] first, then `start.ts`/`handle.ts`/`cli.ts` edits in order (same files, never parallel).
- T045 (hass-virtual verification) and T025/T026 (onboarding and container-exit verification, in `onboard.container.test.ts`) must pass before the code that depends on them is considered done.

## Parallel Examples

- Phase 2: T008, T009, T010, T011 together.
- US1: T012 with T014 and T015; T024 while T025 is prepared.
- US3: T036 and T037 together.
- US6: T058, T059, T060 and T065 together.

## Implementation Strategy

1. MVP = Phase 1, Phase 2, US1 and US2 (T001–T035): start, use and always tear down a throwaway instance. Validate with quickstart 1, 2, 7 and 9, then open the first PR (it carries the T006 changeset).
2. Add US3, US4 and US5 as one or more small PRs (each independently testable, each with its own changeset).
3. Finish with US6 and the polish phase so the README table is generated from a real CI run.
