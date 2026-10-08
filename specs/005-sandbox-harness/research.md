# Research: sandbox harness

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-06

Each entry records a decision, why it was taken, and what else was considered. Facts marked
"verify in T-contract" are confirmed against the real image by a container test before any code
depends on them (see plan, "Verification before building").

## R1 — How the instance runs

**Decision**: One container per instance, from the official image
`ghcr.io/home-assistant/home-assistant:<release>` (the same prefix `@domusops/bootstrap` uses).
Started as `docker create --rm --init --entrypoint python … -m homeassistant --config /config`,
filled with `docker cp - <container>:/` from a tar stream, then `docker start`. The instance
process is the container's main process (behind `--init` for signal forwarding and zombie
reaping), so when the instance stops, the container exits and `--rm` removes it together with its
writable layer, where `/config` lives (the image declares no volume there). No `--user` is passed:
the instance runs as the image's default user and nothing on the host is written. The HTTP port is published on `127.0.0.1` only, on a host port the
runtime picks (`-p 127.0.0.1::8123`), read back with `docker port`.

**Rationale**: Bypassing the image's service supervisor makes "the instance stopped" and "the
container is gone" the same event, which is what makes self-teardown (R6) reliable. No bind
mount means no host directory and no root-owned files to clean up (the problem `bootstrap
validate` hit, commit `52b2fbc`). Loopback-only ports keep the instance off the network. A
runtime-chosen port avoids collisions between concurrent instances (FR-020, edge case "port in
use").

**Verified** (T025 and T026, release 2026.9.3): the container is ready in about 13 s with the image
present; the published port is bound to `127.0.0.1` only; when the instance is stopped through its
own `homeassistant.stop` service the container exits and is removed within the test's 90 s window.

**Alternatives considered**: Keeping the image's default entrypoint: its supervisor's behaviour
when the instance exits is not a contract and may restart it. Bind-mounting a temporary copy:
leaves host files after a kill. Docker Compose: an extra tool, against FR-021.

## R2 — Talking to the container runtime

**Decision**: Spawn the `docker` command-line program (or `podman`, via the same
`DOMUSOPS_CONTAINER` override `bootstrap` honours). No Engine API client library.

**Rationale**: Works with every Docker context (Desktop, remote, rootless) without socket
discovery, matches `packages/bootstrap/src/env/container.ts`, and adds no dependency. The handful
of commands needed (`create`, `cp`, `start`, `port`, `exec`, `logs`, `ps`, `rm`, `pull`,
`image inspect`) all have stable output with `--format`.

**Alternatives considered**: `dockerode`: a dependency and socket-path handling per platform, for
no capability we need.

## R3 — Resolving release channels

**Decision**: Read the list of published releases from the package index
(`https://pypi.org/pypi/homeassistant/json`, key `releases`, ignoring yanked files). Parse
versions as `YYYY.M.P` with an optional `bN` suffix and order them as the package index does
(`2026.10.0b3 < 2026.10.0`).

- current stable: newest version without a suffix;
- previous stable: newest version without a suffix whose `YYYY.M` is lower than current stable's;
- current beta: newest `bN` version; if it is not newer than current stable, the channel resolves
  to "no beta in progress" (FR-023).

An exact release (`--release 2026.9.3`) bypasses resolution. A resolved release whose image
cannot be pulled is "could not run" (FR-023).

**Rationale**: One unauthenticated JSON document holds every release including betas, so all three
channels come from one source with no hard-coded list (FR-002). The container registry tags
`stable` and `beta` are not usable for "previous stable" and the `beta` tag points at a stable
release when no beta is in progress, which would silently duplicate the stable row.

**Alternatives considered**: `version.home-assistant.io/{stable,beta}.json`: current values only,
no previous stable. GitHub releases API: rate-limited without a token in CI. Registry tag
listing: needs registry authentication flow and returns thousands of tags.

## R4 — Onboarding and the administrator token

**Decision**: Use the instance's own onboarding HTTP API, the one its web frontend uses:

1. `POST /api/onboarding/users` with a generated username and a random password, discarded after
   use, and a fixed `client_id` (`http://domusops-sandbox/`), which returns an `auth_code`;
2. `POST /auth/token` (`grant_type=authorization_code`) for a short-lived access token;
3. `POST /api/onboarding/core_config`, `/api/onboarding/analytics`,
   `/api/onboarding/integration` to finish onboarding;
4. over the WebSocket API, `auth/long_lived_access_token` (client name `domusops-sandbox`,
   lifespan 1 day) for the token handed to the caller.

The token is stored only inside the container (`/config/.domusops-sandbox/token`, mode 0600) and
in the memory of the process holding the handle; it is read back with `docker exec` when a
background instance's details are requested. It dies with the container (FR-005).

**Rationale**: Public, versioned behaviour that every new installation goes through, so it is the
least likely to change between releases. A long-lived token is what `@domusops/mcp` expects
(`DOMUSOPS_HA_TOKEN`).

**Alternatives considered**: Pre-seeding `.storage/auth` and `.storage/onboarding`: internal
storage formats with per-release version numbers. Creating the user from inside the instance
(R6's companion): uses internal Python APIs that change more often than the HTTP API.

**Verified** (T025, release 2026.9.3): every step answers as described above, the long-lived token
authenticates `/api/config` (state `RUNNING`, version equal to the release) and the WebSocket API
(`auth/current_user` reports an administrator), and an unauthenticated request gets 401. Still to
confirm in CI: previous stable and beta.

## R5 — Loading a configuration directory

**Decision**: Stream a tar archive built in memory from the source directory straight into
`docker cp` (no temporary directory on the host). The packer:

- reads only; never writes to the source (FR-006, SC-003);
- excludes runtime and private files by default: `.storage/`, `.cloud/`, `deps/`, `tts/`,
  `backups/`, `media/`, `__pycache__/`, `.git/`, `node_modules/`, `.venv/`, `.cache/` and the
  mypy, ruff and pytest caches, `home-assistant_v2.db*`, `*.log*` (rotated logs included),
  `.HA_VERSION`, `secrets.yaml`, `secrets.sops.yaml`, and the age key file names (FR-007,
  FR-008);
- stores symbolic links as links when their target resolves inside the source and is itself
  carried over, and skips (and reports) any that resolve outside it or into something left out;
  never follows them (FR-007). A `configuration.yaml` that is such a link is stored as a regular
  file;
- refuses a source that holds more than 256 MiB of files: a configuration directory is text;
- appends the sandbox's own files: `custom_components/virtual/` (R7),
  `custom_components/domusops_sandbox/` (R6), the virtual device file, and the generated
  `secrets.yaml` (R8). It appends a `domusops_sandbox:` line to the copied
  `configuration.yaml` so the companion loads.

The source itself may be a repository's working tree; untracked or ignored files are treated like
any other file and filtered by the same rules.

**Rationale**: No host files means nothing to leak after a kill. The exclusion list matches the
`.gitignore` block `ha-bootstrap` writes, so a bootstrapped repository and its working tree load
the same way.

**Alternatives considered**: `git archive` of HEAD: ignores uncommitted edits, which is exactly
what a developer wants to test. Copy to a temporary directory and bind-mount it: R1.

New dependency: `tar` (node-tar 7.x), for a filtered, portable, streaming archive.

## R6 — Teardown, crash safety, and time control: a companion integration

**Decision**: A small custom integration shipped inside the package,
`custom_components/domusops_sandbox`, installed only into sandbox instances. Its manifest depends
on `http`, `api`, `websocket_api`, `onboarding`, `auth`, and `config`, so the APIs the sandbox
needs load even when the user's configuration does not include `default_config`. It does three
things:

1. **Lifetime** (FR-029, FR-030, FR-017). It reads `DOMUSOPS_SANDBOX_MODE` and
   `DOMUSOPS_SANDBOX_DEADLINE` from the container's environment. At the deadline it stops the
   instance, which exits the container (R1). In `tied` mode the owning process opens one
   WebSocket connection and sends `domusops_sandbox/attach`; when that connection closes without
   `domusops_sandbox/detach` (the kernel closes it when the process is killed, even by `SIGKILL`),
   it stops the instance after a 15-second grace period. Tied instances also carry a deadline
   (default 2 hours) as a backstop.
2. **Time control** (FR-013). WebSocket commands `domusops_sandbox/time/freeze`, `…/advance`,
   `…/resume`, `…/now`. Freezing replaces the instance's time source (`homeassistant.util.dt`
   `utcnow`/`now`, and the event helper's time-tracker functions) with a controlled clock;
   advancing moves that clock and runs every scheduled timer that is now due, in order, the same
   way the instance's own test helper `async_fire_time_changed` does. Resuming restores real time.
3. **Ownership marker**. It answers `domusops_sandbox/info` with the sandbox id, so the library can
   confirm it is talking to an instance it created before sending anything (FR-019).

Outside the companion, every invocation of the library (and the `cleanup` command) also reaps:
it lists containers labelled `io.domusops.sandbox=1` and removes those whose deadline has passed
or (tied mode, same host) whose owning process no longer exists (FR-017, FR-018). It never
touches containers without the label, and never a tied instance whose owner is alive.

**Rationale**: Self-teardown inside the container is the only way to honour "torn down even if
nobody stops it" (FR-030) without a resident daemon on the host. Socket closure catches `SIGKILL`
immediately, which a polling reaper cannot. For time, the image's Alpine base rules out
`libfaketime` (musl, and shifting the wall clock does not fire timers scheduled on the monotonic
clock); patching the instance's own time source is what its test suite does and fires due timers
deterministically.

**Risk**: time control depends on internals (`homeassistant.util.dt`, the event loop's scheduled
handles, the event helper's time-tracker aliases). It is exactly what the CI matrix exists to
catch: the smoke check's time step fails on the release that changes them, and the failing step is
named in the result (FR-028). Recorder timestamps keep real time; only what automations, triggers,
conditions, and templates see is controlled. This limitation is documented.

**Alternatives considered**: A host-side reaper daemon: a resident process for a test tool.
A watchdog sidecar container: a second container per instance and shared PID namespaces.
Reaping only on the next invocation: misses FR-030 when nobody runs the sandbox again.
`libfaketime` with acceleration: not deterministic, and broken on musl.

## R7 — Virtual devices

**Decision**: Reuse `twrecked/hass-virtual` (domain `virtual`), pinned to `v0.9.3` by tarball
SHA-256, downloaded once into the user cache (`$XDG_CACHE_HOME/domusops/sandbox/`, or
`~/.cache/…`) and copied into each instance as `custom_components/virtual/`. Supported kinds:
`switch`, `binary_sensor`, `sensor`, `light`, `lock`, `fan`, `cover`, `valve`, `device_tracker`.
Devices are written to `/config/domusops-virtual.yaml` in its documented format
(`version: 1`, `devices:` mapping device names to entity lists), and one config entry is created
through the instance's config-flow HTTP API (`POST /api/config/config_entries/flow` with handler
`virtual`, then the user step with the group name and that file name). Adding devices later
rewrites the file inside the container and reloads that config entry. Commands to virtual entities
use the integration's own services (`virtual.turn_on`, `virtual.set`, and so on).

If the user's configuration already ships `custom_components/virtual/`, theirs is used and the
summary says so. A kind outside the list above is refused with a message naming the integration
(FR-011).

`jercoates/ha-virtual-test-devices` ("Virtual Test Devices") creates a fixed set of twelve
devices and can clone a real device's capabilities. Cloning needs a real device, which the sandbox
never reaches, and its fixed set duplicates what `hass-virtual` already covers, so it is not used
in this feature. `pytest-homeassistant-custom-component` runs the instance in-process inside
`pytest`, not in a container; and `presence_simulation` replays recorded history, which belongs
with feature 006's scenarios. Neither is needed here.

**Rationale**: SEED §2.3 forbids rebuilding the device layer (FR-010). `hass-virtual` covers the
kinds the smoke check and feature 006 need and is configurable by file, which is scriptable.

**Risk**: its latest release (2025-08-13) predates the 2026 releases in the matrix. The matrix
proves compatibility per release; a failure names the integration and release (FR-011).

Verify in T-contract: the config-flow field names (`group_name`, `file_name`) and the reload path.

## R8 — Secrets in a sandbox

**Decision**: The sandbox never reads `secrets.yaml` or `secrets.sops.yaml` from the source
(R5 excludes both). It scans the copied YAML for `!secret <key>` references and generates a
`secrets.yaml` inside the instance with a placeholder per key: `domusops-placeholder-<key>`, or,
when `secrets.sops.yaml` declares a value type for that key in its `ENC[…,type:int|float|bool]`
marker (readable without the key), a placeholder of that type (`0`, `0.0`, `false`). Reading the
key names and types from `secrets.sops.yaml` never decrypts anything. The caller may instead name
a plaintext secrets file explicitly (`secretsFile`), which is copied as is. The summary states
which of the two was used (FR-008, US3 scenario 3).

**Rationale**: Mirrors `bootstrap validate`'s typed placeholders (its research R9), so a
configuration that validates there starts here. The ENC type parsing is a few lines and is
duplicated rather than turning `@domusops/bootstrap`, a CLI, into a library with a public API.

## R9 — Configuration validation and readiness

**Decision**: Ready means: the HTTP API answers, onboarding is finished, and WebSocket
`get_config` reports `state: "RUNNING"`. Then `POST /api/config/core/check_config` runs; a result
of `invalid`, or `recovery_mode`/`safe_mode` true in `get_config`, fails the start with the
reported errors and the instance is torn down (FR-009). The readiness limit is 150 seconds by
default, configurable; on timeout the last 50 log lines are returned with the failure (edge case).

## R10 — Interfaces: library first, thin CLI

**Decision**: `@domusops/sandbox` exports an async library API (`contracts/library-api.md`). The
CLI `domusops-sandbox` (`contracts/cli.md`) parses arguments, calls the library, and formats
output; it has no logic of its own (FR-031, FR-032). The library never accepts a URL: every
operation takes a `Sandbox` handle or a sandbox id, which is resolved to a labelled container and
its loopback port, and the companion's `info` reply must match the id before anything is sent
(FR-019, SC-007).

## R11 — WebSocket and HTTP clients

**Decision**: Node 22's global `fetch` and `WebSocket`. A minimal WebSocket client inside the
sandbox package (auth, id-correlated commands, the companion commands, `get_config`, `get_states`,
`call_service`), separate from `@domusops/mcp`'s client, which deliberately allows read-only
commands only (its FR-018) and must stay that way.

## R12 — The smoke check (FR-028)

**Decision**: A fixed sequence, run by the library's `runSmoke()` and the CLI's `smoke` command
against a reference configuration shipped in the package (`fixtures/reference-config/`):

1. `start`: instance ready, token accepted for an admin-only command (`auth/current_user` is
   admin);
2. `load-config`: reference configuration loaded and `check_config` valid;
3. `virtual-device`: add a virtual `binary_sensor` (motion) and a virtual `light`;
4. `set-state`: set the motion sensor to `on` with an attribute and read both back;
5. `time`: freeze at 02:59:50 local time, advance 20 seconds; the reference automation (time
   trigger 03:00:00, turns the virtual light on) must have fired exactly once (light `on`,
   automation `last_triggered` set, one trace);
6. `mcp-snapshot`: spawn the `@domusops/mcp` server with an environment built from scratch
   (only `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN` of the sandbox, never inherited) and call
   `ha_snapshot` through the MCP client SDK over stdio; the snapshot must contain the virtual
   light;
7. `websocket`: a fresh WebSocket client authenticates and runs `get_states`;
8. `teardown`: the instance is stopped and no labelled container or volume remains.

The first failing step is recorded and later steps are skipped, except teardown, which always
runs.

**Rationale**: Exercises every capability of this feature once, on every release, and proves
SC-005 (existing tools work unchanged). Building the MCP environment from scratch is what keeps a
developer's real `DOMUSOPS_HA_URL` from ever being used (FR-019).

New dependencies: `@domusops/mcp` (workspace, for its binary) and `@modelcontextprotocol/sdk`
(already in the workspace through `@domusops/mcp`).

## R13 — CI: matrix, gate, and the README table

**Decision**:

- `sandbox-matrix` (existing job, replaced): runs on every pull request, on pushes to `main`, and
  weekly (to catch new releases). Matrix `channel: [stable, previous-stable, beta]`. Each leg runs
  `domusops-sandbox smoke --channel <c> --result result-<c>.json` and uploads the result,
  whatever the outcome. The beta leg has `continue-on-error: true`.
- `sandbox-gate` (new): `needs: sandbox-matrix`, `if: always()`; downloads the results, fails if
  either stable result is not `passed`, and writes the table to the job summary. This is the
  check to mark as required (FR-025); beta never fails it.
- The README table is rendered from `docs/supported-versions.json` between
  `<!-- domusops:supported-versions:start -->` and `…:end -->` markers. The JSON is written by
  `pnpm sandbox:table --run <id>`, which downloads the three results of a `sandbox-matrix` run on
  `main` with `gh run download`, checks the run succeeded on `main`, and records the run URL per
  row. A test in the default suite fails when the README block differs from what the JSON renders
  (FR-024), so a hand edit fails `verify`.

**Rationale**: A pull request created by the workflow's own token does not trigger other
workflows, so a bot pull request would never get its required checks; a personal or app token
would be a new secret to manage. Pulling a specific run's results keeps every row traceable to
the run that produced it.

**Consequence for SC-006**: the README reflects the run it was last regenerated from, linked per
row, not necessarily the latest run. See plan, "Decisions to confirm".

**Alternatives considered**: A bot pull request with a personal access token: works, at the cost
of a long-lived secret. Committing from CI to `main`: blocked by branch protection, rightly.

## R14 — Results format

**Decision**: One JSON document per run, `format: "domusops.sandbox-result/0.1"`, validated by a
JSON Schema shipped in the package (`contracts/run-result.md`). Fields: channel, release (absent
when no beta is in progress), outcome (`passed | failed | could-not-run | no-beta-in-progress`),
failed step (when failed), per-step durations, started and finished timestamps, runner OS,
sandbox package version, CI run URL when present. Never the token, never instance content beyond
step names and counts.

## R15 — Tests

**Decision**:

- Unit tests (default `pnpm test`, no Docker): version parsing and channel resolution against a
  recorded index document; the tar filter (exclusions, symlinks outside, source byte-identity);
  placeholder generation; label construction and reaper decisions with a fake runtime; CLI
  argument parsing and output shapes; result schema; table rendering; the README block test.
- Container tests (`*.container.test.ts`, excluded by default as `bootstrap`'s are, run by the
  matrix jobs with `DOMUSOPS_CONTAINER_TESTS=1`): onboarding and token, config-flow fields,
  teardown after normal exit, after `SIGKILL` (tied: gone within grace plus 10 s), after deadline,
  two concurrent instances, refusal of a foreign id.
- The companion's Python is exercised only through container tests; it has no separate Python
  toolchain.

## R16 — Package shape and versioning

**Decision**: `packages/sandbox` keeps its name and becomes `0.1.0` through a changeset (§9).
`bin: domusops-sandbox`. `files`: `dist`, `companion`, `fixtures`. Dependencies: `tar`,
`@domusops/mcp` (workspace), `@modelcontextprotocol/sdk`. The stub's dependency on
`@domusops/schema` is removed: the harness does not use it; feature 006 adds it back with the
assertion DSL. Description changed to "Ephemeral test harness for Home Assistant: throwaway
instances, virtual devices, time control" (§6: nominative use only).
