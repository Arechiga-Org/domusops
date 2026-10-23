---
description: "Task list for the debt paydown after the 0.1.0 release"
---

# Tasks: Debt paydown after 0.1.0

**Input**: Design documents from `/specs/007-debt-paydown/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R23), data-model.md, contracts/ (mcp-behaviour, sandbox-api, bootstrap-cli, release), quickstart.md

**Tests**: Included. Each story states which test fails first. Unit tests run in the default `pnpm test`; container tests run with `DOMUSOPS_CONTAINER_TESTS=1`.

**Organization**: One phase per user story, and each phase is one branch and one pull request from `main` (FR-030). The stories do not depend on each other in code, except that US5 follows US1 (both touch `tools/ha-trace.ts` and `ha/client.ts`). The delivery order is in plan.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1..US6, from spec.md
- All paths are relative to the repository root. Everything written to the repository is English (constitution §1).
- Per story, the last tasks are always the same: run the gate (`pnpm lint && pnpm typecheck && pnpm test`), Prettier on only the touched files (never `tasks.md`), and then ask the maintainer before any commit, push or pull request. The maintainer merges. `/code-review` runs after each pull request and its findings are fixed.

---

## Phase 1: Setup

- [ ] T001 From a clean `main`, run `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` and record that the baseline is green before any story starts
- [ ] T002 Commit the spec artifacts on branch `007-debt-paydown` (`specs/007-debt-paydown/`; `.specify/feature.json` is ignored and stays local) after the maintainer confirms, and open the pull request that merges them first (constitution §2)

**Checkpoint**: Spec, plan and tasks are on `main`. There is no foundational phase: every story is independent.

---

## Phase 2: User Story 1 — Trace reads that fail fast and never hang (Priority: P1)

**Branch**: `007-us1-mcp-correctness` | **Package**: `packages/mcp` | **Changeset**: patch

**Goal**: `ha_trace` stops after the first failed read, `close()` settles pending commands, independent reads run together, and `standard` refuses early when the result is certain to be too large (R1–R4).

**Independent Test**: The `packages/mcp` suite, including the new tests below, against the simulated instance in `packages/mcp/test/support`.

### Tests for User Story 1 (write first, see them fail)

- [X] T003 [P] [US1] In `packages/mcp/test/trace-get.test.ts`, add a test that ten `trace/get` reads with the third failing return `retrieval_failed` and that the simulated instance receives no `trace/get` whose request started after the failure (SC-001)
- [X] T004 [P] [US1] In `packages/mcp/test/client.test.ts`, add tests that `close()` with three pending commands rejects all three within one second with `the connection closed before a reply arrived`, and that a second `close()` is harmless (SC-002)
- [X] T005 [P] [US1] In `packages/mcp/test/trace-tool.test.ts`, add a test with a 300 ms simulated delay per read that a request for one run finishes in under 1500 ms, where reading one after another takes about 1900 ms (SC-003), and a test that when one of them fails the others settle, `client.close()` runs, and nothing is left unhandled
- [X] T006 [P] [US1] In `packages/mcp/test/trace-tool.test.ts`, add a test with 500 stored runs, no selectors, `detail=standard` and the default limit: the result is `too_large` with `bytes or more`, and fewer than 250 `trace/get` were received (SC-004). Add a test that a result which fits the limit is identical to the output before this change and is never refused (FR-004, FR-005). Build the 500-run fixture so that every run encodes to at least 500 bytes at `standard`, so the overflow is proven within the first 248 runs (chunks 8+16+32+64+128); assert that size in the test itself so a smaller fixture fails loudly instead of passing by accident
- [X] T007 [P] [US1] Create `packages/mcp/test/trace-monotonic.test.ts`: with a seeded pseudo-random generator, take random subsets `S ⊂ T` of the existing trace fixtures and assert `sizeFloor(encodeStandard(S)) <= emitted size of T` using the real `encodeStandard` and `finalize`. The comparison uses `sizeFloor` (`packages/mcp/src/trace/size.ts`), not the plain size, because string table indexes can shrink as runs are added (research R4)

### Implementation for User Story 1

- [X] T008 [US1] In `packages/mcp/src/ha/trace.ts`, give the `getTraces` workers a shared `stopped` flag: a worker sets it when its `trace/get` fails, and every worker checks it before taking the next index. Keep `MAX_IN_FLIGHT = 8` and the result order (R1)
- [X] T009 [US1] In `packages/mcp/src/ha/client.ts`, make `close()` call the private `abort(null)` before it sets `closed`, so every pending command is rejected with the existing dropped-connection error. Keep the timer clearing and the guarded `socket.close()` (R2)
- [X] T010 [US1] In `packages/mcp/src/tools/ha-trace.ts`, read in two groups, each started together: `readTraceContext` with `readItems`, then, after the window is resolved from the time zone, `listTraces` (its domains together) with `readContexts` when needed. A `together` helper reports the first-listed read's error when both fail. The lists wait for the instance check so a non-administrator or an instance without traces still gets no `trace/*` command. Selection and encoding stay unchanged (R3)
- [X] T011 [US1] In `packages/mcp/src/tools/ha-trace.ts`, read the extended records at `detail=standard` in chunks of 8, 16, 32, … runs in selection order (at most `MAX_IN_FLIGHT` reads in flight). After each chunk, encode what has been read with `encodeStandard` and `finalize`; if the text is already above the limit, throw `errors.tooLargeRuns` with a flag meaning "more than". Keep the existing exact-size path when all runs were read (R4)
- [X] T012 [US1] In `packages/mcp/src/errors.ts`, extend `tooLargeRuns` so the message reads `would be <bytes> bytes or more` for the early refusal and keeps `would be <bytes> bytes` otherwise; the guidance line, the code and `<runs>` (runs selected) are unchanged (contracts/mcp-behaviour.md)
- [X] T013 [P] [US1] Update `specs/003-ha-trace/contracts/ha_trace.md` with one sentence linking to `specs/007-debt-paydown/contracts/mcp-behaviour.md` for the early-refusal wording
- [X] T014 [US1] Add `.changeset/mcp-trace-fail-fast.md` (`@domusops/mcp` patch): fail-fast trace reads, pending commands settled on close, concurrent reads, early too-large refusal for `standard`
- [ ] T015 [US1] Run the gate and `node_modules/.bin/vitest run packages/mcp/test < /dev/null`; confirm every existing `ha_trace` output test passes unedited. Then follow the per-story closing steps in the header (confirm with the maintainer; commit, push and pull request; `/code-review`)

**Checkpoint**: US1 is mergeable. Its "Version Packages" pull request must stay unmerged until US2 is merged and the trusted publishers exist (R23).

---

## Phase 3: User Story 2 — Releases published without a long-lived secret (Priority: P1)

**Branch**: `007-us2-release` | **Surfaces**: workflows, all four `package.json`, `packages/schema/README.md`, `scripts/test/` | **Changeset**: one patch for all four packages

**Goal**: OIDC trusted publishing with no token fallback, node24 actions, a schema README, and source maps that resolve from each package (R5–R9, contracts/release.md).

**Independent Test**: `pnpm typecheck && node_modules/.bin/vitest run scripts/test < /dev/null` before merge; the registry-side steps of quickstart US2 after merge.

### Tests for User Story 2 (write first, see them fail)

- [X] T016 [US2] Create `scripts/test/package-contents.test.ts`: for each directory under `packages/`, run `npm pack --dry-run --json` (no network) and assert that the file list contains `README.md`, contains `src/` files, and contains no `test/` file; then read every shipped `.map` from the working tree and assert each `sources` entry, resolved against the map's own directory, is in the file list (FR-010, FR-011, FR-012, R8). Run it and see it fail for the missing schema README and the missing `src/`. When a package has no `dist/`, fail with "run pnpm typecheck first (it builds dist/)" instead of passing vacuously
- [X] T017 [US2] Create `scripts/tsconfig.test.json` (extending `tsconfig.base.json`, including `scripts/test`), add `scripts/test/**/*.test.ts` to `include` in `vitest.config.ts`, and add `tsc -p scripts/tsconfig.test.json` to the `typecheck` script in `package.json`

### Implementation for User Story 2

- [X] T018 [P] [US2] Create `packages/schema/README.md` in the style of `packages/mcp/README.md`: what the package is ("the public formats shared by the DomusOps tools, for Home Assistant"), how to install it, the format identifiers it exports (snapshot, logbook and trace at both detail levels) with their reference decoders and JSON Schemas, and the stability promise of constitution §5 (a format change is a new identifier). Nominative Home Assistant wording only (§6)
- [X] T019 [P] [US2] In `packages/schema/package.json`, `packages/mcp/package.json`, `packages/bootstrap/package.json` and `packages/sandbox/package.json`, add `"src"` to `files`, keeping each package's existing extras (`companion`, `fixtures`, `schema` and so on) (R7)
- [X] T020 [US2] First, confirm that `pnpm publish` in pnpm 9.15.0 hands the upload to the npm CLI: run `pnpm --filter @domusops/schema publish --dry-run --no-git-checks --loglevel verbose` and check the log shows npm doing the publish, and record the result in research R5. If it does not, change the root `release` script to pack each package with `pnpm pack` and publish each tarball with `npm publish <tarball> --access public` (or equivalent), and record that instead. Then rewrite `.github/workflows/release.yml` (R5, R6, contracts/release.md): keep `permissions` with `id-token: write`; remove `registry-url` from `actions/setup-node`, `NODE_AUTH_TOKEN` and `NPM_TOKEN`; add a step `npm install -g npm@^11.5.1` before publishing; use `changesets/action` v2 with `version-script: pnpm version-packages`, `publish-script: pnpm release` and `github-token: ${{ secrets.GITHUB_TOKEN }}`. Pin every action by full commit SHA with the version as a trailing comment: checkout v7, setup-node v7, pnpm/action-setup v6, changesets/action v2. Resolve each SHA with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, following the tag object when it is annotated
- [X] T021 [US2] In `.github/workflows/ci.yml`, move `actions/checkout` to v7, `actions/setup-node` to v7, `actions/upload-artifact` to v7, `actions/download-artifact` to v8 and `pnpm/action-setup` to v6, keeping the major-tag form and every existing `with:` input (R6). Check that no job relies on setup-node's automatic caching beyond the explicit `cache: pnpm`
- [X] T022 [P] [US2] Search every other workflow in `.github/workflows/` for `uses:` references with `grep -rn "uses:" .github/workflows` and move any remaining deprecated-runtime action to its node24 major
- [X] T023 [US2] Add `.changeset/release-package-contents.md` listing `@domusops/schema`, `@domusops/mcp`, `@domusops/sandbox` and `@domusops/bootstrap` as patch: schema README, shipped sources for source maps
- [X] T024 [US2] Run the gate and the quickstart US2 "Before merge" check; prove the test by removing `"src"` from one package's `files`, seeing T016 fail, and restoring it. Confirm in the CI log of the pull request that pnpm/action-setup v6 installed pnpm 9.15.0. Then follow the per-story closing steps in the header

### Maintainer steps after merge (not code; do not skip the order)

- [ ] T025 [US2] Maintainer: add the trusted publisher on npmjs.com to each of the four packages (organization `Arechiga-Org`, repository `domusops`, workflow `release.yml`, empty environment), following `specs/007-debt-paydown/contracts/release.md`. Confirm that each package lists only this one trusted publisher (US2 acceptance scenario 2)
- [ ] T026 [US2] Maintainer: merge the open "Version Packages" pull request (it carries US1's changeset and US2's), watch the `release` run, and confirm each new version on npm shows provenance from `Arechiga-Org/domusops` by `release.yml` (SC-005). If the registry refuses, fix the trusted-publisher fields and re-run; never add a token back
- [ ] T027 [US2] Maintainer, only after T026 succeeded: set "Require two-factor authentication and disallow tokens" on each package, run `! gh secret delete NPM_TOKEN`, and revoke the granular token `domusops-release-ci` on npmjs.com (FR-008)
- [ ] T028 [US2] Search the latest `ci` and `release` run logs on `main` for "Node.js 20"; there must be no match (SC-006)

**Checkpoint**: US2 is proven by a real release. Later stories publish through OIDC.

---

## Phase 4: User Story 3 — A sandbox that keeps working across sessions and releases (Priority: P2)

**Branch**: `007-us3-sandbox` | **Package**: `packages/sandbox` | **Changeset**: patch

**Goal**: devices on attached handles, ownership that survives a host-name change, a clear `time_unavailable` error, a verified virtual-device download, and a redaction test that can fail (R10–R14).

**Independent Test**: `node_modules/.bin/vitest run packages/sandbox/test < /dev/null`, then the container tests with `DOMUSOPS_CONTAINER_TESTS=1`.

### Tests for User Story 3 (write first, see them fail)

- [X] T029 [P] [US3] In `packages/sandbox/test/reaper.test.ts` (extend the existing file), add one test per row of the ownership decision table in data-model §2, including a simulated host-name change with a dead owner (removed, "owner process gone") and a live owner (kept), a legacy label set with a differing host (kept, deadline only), and a machine identifier that is `null` (SC-008)
- [X] T030 [P] [US3] Create `packages/sandbox/test/machine-id.test.ts`: the identifier is 32 lowercase hex characters; it is created once and reused; two concurrent first uses agree; invalid content is treated as absent and the file is not overwritten; an unwritable directory gives `null`. Use a temporary `XDG_STATE_HOME`
- [X] T031 [P] [US3] In `packages/sandbox/test/labels.test.ts` (extend), assert that `owner-machine` round-trips, is omitted for background instances and when the identifier is `null`, and that a malformed value parses as absent without rejecting the container (data-model §2)
- [X] T032 [P] [US3] In `packages/sandbox/test/devices-fetch.test.ts` (extend or create), assert that a tampered file and a substituted file in the archive both fail with `virtual_unavailable` and the text `the download failed its integrity check`, that nothing is cached, that an archive with a link inside `custom_components/virtual/` is rejected, and that a cache entry whose digest no longer matches is deleted and downloaded again once (SC-009)
- [X] T033 [P] [US3] In `packages/sandbox/test/devices-state.test.ts` (create), using a fake runtime and fake HA, assert the device state file of data-model §3: written with `revision` incremented on every successful `initialise` and `add`; `resume` of a valid file yields the recorded devices; a missing, unparsable or wrong-`format` file gives no device support; an unloaded `entryId` gives no device support with a message saying so; a revision that moved makes `add` fail with `virtual_unavailable` and change nothing
- [X] T034 [P] [US3] In `packages/sandbox/test/errors.test.ts` and `packages/sandbox/test/smoke.test.ts`, add tests that `time_unavailable` is a `SandboxErrorCode`, that a `time` step receiving it yields step outcome `failed` with message `time control unavailable on <release>` and run outcome `failed`, and that the run still validates against `schema/run-result.schema.json` with no new outcome value (FR-017)
- [X] T035 [US3] In `packages/sandbox/test/smoke.test.ts`, change the token of "keeps the token out of a teardown message even though the sandbox is stopped" to a value that is neither JWT-shaped nor behind `Bearer`, for example `plain-instance-token-0123456789abcdef`, and make the fake instance hand that token to the run (R14). Prove it: temporarily drop the `secrets` argument on the teardown path, see the test fail, and restore it (FR-019)

### Implementation for User Story 3

- [X] T036 [US3] Create `packages/sandbox/src/runtime/machine-id.ts` per data-model §1: path `$XDG_STATE_HOME/domusops/machine-id`, else `~/.local/state/domusops/machine-id` when the variable is unset or empty; 128 random bits as 32 lowercase hex; exclusive create, reading the winner's file on a lost race; invalid content treated as absent and never overwritten; unreadable or unwritable gives `null`
- [X] T037 [US3] In `packages/sandbox/src/runtime/labels.ts`, add `LABEL_OWNER_MACHINE = "io.domusops.sandbox.owner-machine"`, write it for tied instances when the identifier is not `null`, and make `parseLabels` return `owner: { host, pid, machine: string | null }` with a malformed value read as `null`. In `packages/sandbox/src/instance/start.ts`, pass the identifier into the labels (R11)
- [X] T038 [US3] In `packages/sandbox/src/runtime/reaper.ts`, replace `ownerMayBeAlive` with the decision table of data-model §2 (the deadline check stays first, removal reasons stay as they are), and make `packages/sandbox/src/cli.ts` use the same function for the "held" column of `list`
- [X] T039 [US3] In `packages/sandbox/src/errors.ts`, add `time_unavailable` to `SandboxErrorCode`. In `packages/sandbox/src/instance/handle.ts`, map the companion's `time_unavailable` error to it with the message `Time control is unavailable on Home Assistant <release>: <internal> is missing. Other operations still work.`, leaving `time_control_failed` for operation failures
- [X] T040 [US3] In `packages/sandbox/companion/custom_components/domusops_sandbox/clock.py`, stop importing the patched internals at module level: resolve them in a probe at the first freeze, checking that `dt_util.utcnow`, `dt_util.now`, `ha_event.time_tracker_utcnow`, `homeassistant.core.time` and the entity and script clock hooks exist and are callable. A missing one raises `ClockError("time_unavailable", …)` naming the attribute and the Home Assistant version. The companion must still load, and teardown at the deadline must still work (R12)
- [X] T041 [US3] In `packages/sandbox/src/smoke/steps.ts`, make the `time` step report `time control unavailable on <release>` as a failed step when it meets `time_unavailable`; leave the results format and `schema/run-result.schema.json` unchanged
- [X] T042 [US3] In `packages/sandbox/src/devices/fetch.ts`, replace `VIRTUAL_SHA256` with `VIRTUAL_COMMIT = "a056ceaf73d4907e258ae055c3541342a3275400"`, `VIRTUAL_URL` built from the commit, and `VIRTUAL_CONTENT_SHA256` (data-model §4). Compute the manifest (sorted `<path>\0<sha256 of file>\n` lines under `custom_components/virtual/`, links rejected) once from a tarball that the old pin already verifies, and commit that digest. Extract to `<cache>/hass-virtual-<commit>/custom_components/virtual/`, recompute the manifest on every cache read, and delete and re-download once on a mismatch. Install nothing before verification (R13)
- [X] T043 [US3] In `packages/sandbox/src/devices/virtual.ts`, write `/config/.domusops_sandbox/devices.json` (format `domusops.sandbox-devices/0.1`, `revision`, `entryId`, `specs`, `devices`) on every successful `initialise` and `add`, add `VirtualDevices.resume(context, state)`, and make `add` re-read the revision first and fail with `virtual_unavailable` (`The device list of sandbox <id> changed in another process. Attach again to continue.`) when it moved (R10)
- [X] T044 [US3] In `packages/sandbox/src/instance/manage.ts`, make `attachSandboxWith` read the state file and build the handle with `VirtualDevices.resume` and the recorded `devices`; with no usable file the handle has no device support. In `packages/sandbox/src/instance/handle.ts`, change the no-support message to `This instance was started without virtual-device support. Start it with \`devices\` (an empty list is enough) to add devices later.` (contracts/sandbox-api.md)
- [X] T045 [US3] In `packages/sandbox/src/config/pack.ts`, skip the top-level `.domusops_sandbox` directory so a loaded configuration can neither supply nor overwrite the state file; add a test in `packages/sandbox/test/pack.test.ts`
- [X] T046 [P] [US3] In `packages/sandbox/test/attach.container.test.ts` (create), with `DOMUSOPS_CONTAINER_TESTS=1`: start a background instance with `devices: []`, attach from a second handle, add a device, and see it in that handle's `devices`. The companion's probe is tested without a container, against a stand-in `homeassistant` package, in `packages/sandbox/test/companion-probe.test.ts` (with `test/support/probe_clock.py`); that the instance keeps answering is the same code path as on any release
- [X] T047 [P] [US3] Update `packages/sandbox/README.md`: devices can be added through an attached handle, two processes adding to one instance at once is unsupported, `time_unavailable`, the ownership label and machine identifier file, and the integrity check
- [X] T048 [US3] Add `.changeset/sandbox-robustness.md` (`@domusops/sandbox` patch)
- [ ] T049 [US3] Run the gate, then the container tests with `DOMUSOPS_CONTAINER_TESTS=1 node_modules/.bin/vitest run packages/sandbox/test < /dev/null`, and confirm `sandbox-matrix` and `sandbox-gate` stay green. Do not touch the user's unrelated containers. Then follow the per-story closing steps in the header

**Checkpoint**: US3 is mergeable.

---

## Phase 5: User Story 4 — Bootstrap that never clobbers or misleads (Priority: P2)

**Branch**: `007-us4-bootstrap` | **Package**: `packages/bootstrap` | **Changeset**: patch

**Goal**: pinned commands in generated comments, a refusal for a customised `.sops.yaml`, and a membership report in `init` (R16–R18).

**Independent Test**: `node_modules/.bin/vitest run packages/bootstrap/test < /dev/null`; the `bootstrap-macos` job runs the same with real `sops` and `age`.

### Tests for User Story 4 (write first, see them fail)

- [X] T050 [P] [US4] In `packages/bootstrap/test/templates.test.ts` (extend or create), render every generated file and assert that no line tells the user to run a bare `domusops-bootstrap`, and that each command named is `npx --yes @domusops/bootstrap@<release> …` (SC-010, FR-020)
- [X] T051 [P] [US4] In `packages/bootstrap/test/secrets-keys.test.ts` (extend or create), assert that with a hand-edited `.sops.yaml` both add-key and remove-key exit `1`, print the refusal text of contracts/bootstrap-cli.md on standard error, and leave `.sops.yaml`, `secrets.sops.yaml` and the generation record byte-identical (SC-011); that an unedited file with a record behaves as before; that a file with no record entry that equals the rendered template proceeds; and that one with no record entry that differs is refused
- [X] T052 [P] [US4] In `packages/bootstrap/test/init-membership.test.ts` (create), assert that `init --apply` against a fixture whose recipients exclude the local key adds the add-key line with the local public key to `next_steps` and fills `key`; that a preview with no local key adds the "no age key yet" line; that neither is a stop and the exit code is unchanged; and that a key which is a recipient adds no line

### Implementation for User Story 4

- [X] T053 [US4] In `packages/bootstrap/src/baseline/templates.ts`, change the two comments that name the bare `domusops-bootstrap` (the `.sops.yaml` add-key and remove-key hint and the `validate` mention) to `npx --yes @domusops/bootstrap@${release} …`, as the generated hook and workflow already run (R16)
- [X] T054 [US4] In `packages/bootstrap/src/commands/secrets.ts`, before any write in `runAddKey` and `runRemoveKey`, compute `elementState(entry, renderSopsConfig(recipients), content)` for `sops-config`; on `edited` print the refusal of contracts/bootstrap-cli.md and return `EXIT_PROBLEMS` without changing any file. `current` and `outdated` proceed as today, and there is no override option (R17, FR-021)
- [X] T055 [US4] In `packages/bootstrap/src/commands/init.ts`, when `.sops.yaml` already lists recipients, resolve the local key (create with `--apply`, look up only in a preview), fill the summary's `key`, and add the `next_steps` lines of contracts/bootstrap-cli.md when the local public key is not a recipient or no key exists yet. It is never a stop and `domusops.bootstrap-summary/0.1` is unchanged (R18, FR-022)
- [X] T056 [US4] Confirm `skills/ha-bootstrap/SKILL.md` and `packages/bootstrap/test/skill.test.ts` still pass unchanged, and update `specs/004-ha-bootstrap/contracts/cli.md` and `generated-files.md` with one sentence each linking to `specs/007-debt-paydown/contracts/bootstrap-cli.md`
- [X] T057 [US4] Add `.changeset/bootstrap-safety.md` (`@domusops/bootstrap` patch)
- [X] T058 [US4] Run the gate and the bootstrap tests. Never read `mi-ha-config/secrets.yaml` or `mi-ha-config/.mcp.json`, and use only fixtures. Then follow the per-story closing steps in the header

**Checkpoint**: US4 is mergeable.

---

## Phase 6: User Story 5 — MCP internals with one way to do each thing (Priority: P3)

**Branch**: `007-us5-mcp-internals` | **Package**: `packages/mcp` | **Changeset**: none (FR-031) | **After**: US1 is merged

**Goal**: remove duplication and dead code with no output change (R19, R20).

**Independent Test**: the existing MCP suite passes with no existing expectation edited (SC-012).

### Tests for User Story 5

- [ ] T059 [P] [US5] In `packages/mcp/test/client.test.ts`, add a test that a `logbook/get_events` error with the instance code `unknown_command` yields `history_unavailable`, that the same words in a message with another code do not, and that the result text is unchanged (FR-025)
- [ ] T060 [P] [US5] In `packages/mcp/test/selectors.test.ts` (extend or create), add a test that `selectRows` calls the selector matcher once per distinct `entity_id` for 1000 rows over 10 entities, and that its output equals the previous behaviour (FR-026)
- [ ] T061 [P] [US5] In `packages/mcp/test/client.test.ts`, add a test that `ALLOWED_COMMANDS` is exactly the keys of the new command table in the same order as today, and that parameter validation and the overall-budget rule for `logbook/get_events` behave as before

### Implementation for User Story 5

- [ ] T062 [US5] Create `packages/mcp/src/util/order.ts` (`byCountThenKey`) and `packages/mcp/src/util/json.ts` (`isObject`, `pad`); replace the copies in `packages/mcp/src/trace/values.ts`, `packages/mcp/src/logbook/encode-standard.ts`, `packages/mcp/src/trace/encode-standard.ts`, `packages/mcp/src/logbook/local-time.ts`, `packages/mcp/src/ha/instance.ts` and `packages/mcp/src/ha/retrieve.ts`. `trace/values.ts` keeps its narrower `JsonObject` type through a generic (R19)
- [ ] T063 [US5] Export `refOf` from `packages/mcp/src/ha/trace.ts` next to `TraceRef` and use it in `packages/mcp/src/trace/select.ts` and `packages/mcp/src/tools/ha-trace.ts`, removing both local copies
- [ ] T064 [US5] In `packages/mcp/src/server.ts`, add one `asToolResult(tool, run)` helper that holds the `ToolError`-or-`protocolError` mapping, and use it in the three tool registrations in place of the three copied `try`/`catch` blocks
- [ ] T065 [US5] In `packages/mcp/src/trace/select.ts`, remove the unreachable `created === null` check; in `packages/mcp/src/trace/context-id.ts`, keep only `/^[\x20-\x7e]{1,64}$/` in `parseContextId`, with the same error message (R20, FR-024)
- [ ] T066 [US5] In `packages/mcp/src/errors.ts`, give `ToolError` a `readonly haCode: string | null` that `toToolText` ignores; set it in `packages/mcp/src/ha/client.ts` from `error.code` of a failed command answer; make `packages/mcp/src/ha/logbook.ts` test `haCode === "unknown_command"` instead of searching `causeText`
- [ ] T067 [US5] In `packages/mcp/src/ha/client.ts`, replace `ALLOWED_COMMANDS`, `PARAM_KEYS` and the `logbook` special cases in `command` with the single `COMMANDS` table of data-model §6, deriving `ALLOWED_COMMANDS` from it and keeping it exported
- [ ] T068 [US5] In `packages/mcp/src/logbook/selectors.ts`, memoise the selector verdict per `entity_id` in `selectRows` with a `Map<string, boolean>` (FR-026)
- [ ] T069 [P] [US5] Add a comment on `isEscapeShaped` in `packages/mcp/src/logbook/encode-standard.ts` and on `isEscape` in `packages/schema/src/logbook/expand.ts` pointing at each other. Do not export anything from the schema (R19, FR-032). Because the schema file gains only a comment, no changeset is added
- [ ] T070 [US5] Run `git diff main --stat -- packages/mcp/test` and confirm only additions, run the gate, and confirm the compression-floor tests pass with unchanged floors; `grep -rn "const refOf" packages/mcp/src` prints one line (quickstart US5). Then follow the per-story closing steps in the header

**Checkpoint**: US5 is mergeable.

---

## Phase 7: User Story 6 — Project instructions that match the project (Priority: P3)

**Branch**: `007-us6-housekeeping` | **Files**: `CLAUDE.md` | **Changeset**: none

- [ ] T071 [US6] In `CLAUDE.md`, rewrite "Current focus" to say that the four packages are published at 0.1.x, that the current feature is this debt paydown (`specs/007-debt-paydown/`), and that the next feature is the scenario and assertion DSL (006); remove "Nothing else lands until the harness works end to end" (R21, FR-028)
- [ ] T072 [US6] Run `node_modules/.bin/prettier --check CLAUDE.md packages/sandbox/package.json`; both pass already on `main`, so this verifies FR-029 and needs no edit. Run the gate, then follow the per-story closing steps in the header

---

## Phase 8: Polish

- [ ] T073 After US1–US6 are merged, check each `FR-001..FR-033` and `SC-001..SC-013` against the merged pull requests and note any gap in `specs/007-debt-paydown/checklists/requirements.md` Notes
- [ ] T074 Tell the maintainer the SEED §7 articles for backlog items 3, 4 and 5 remain outside this repository, and that the hass-virtual per-kind device-name question stays open in research R15

---

## Dependencies & Execution Order

- **Phase 1** first; the spec pull request (T002) merges before any story branch.
- **US1 → US2 → US3 → US4 → US5 → US6** in that order of merging (plan.md). Each branch starts from the `main` that already has the previous merge.
- Real code dependencies: US5 after US1; US2's maintainer steps T025–T028 need US2 merged and US1's changeset pending.
- US3 and US4 touch different packages and could be built in parallel, but they are merged one after the other to keep branches short.

## Parallel Opportunities

- **US1**: T003–T007 are all different tests and can be written together; T008, T009 and T012 touch different files.
- **US2**: T018, T019 and T022 are independent of each other.
- **US3**: T029–T034 are different test files; T036, T039 and T040 touch different files; T046 and T047 are independent.
- **US4**: T050–T052 are different test files.
- **US5**: T059–T061 and T069 are independent.

## Implementation Strategy

- **MVP**: US1 and US2 together, the two P1 stories. After the maintainer steps T025–T028, the project publishes without a stored secret, and the first OIDC release carries US1's fixes.
- **Incremental**: each later story is one pull request that merges green on its own, with a patch changeset where users see a change (US3, US4) and none where they do not (US5, US6).
