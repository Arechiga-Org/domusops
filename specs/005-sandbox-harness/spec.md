# Feature Specification: sandbox harness — A Throwaway Home Assistant for Safe Testing

**Feature Branch**: `005-sandbox-harness`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: `docs/SEED.md` §2.3 and §6, backlog item 3: "`@domusops/sandbox`",
part 1 of 2. This feature is the ephemeral harness only. The scenario and assertion DSL and its
runner are a separate, later feature (006). Constitution §8 requires CI to run the sandbox
against the current stable, the previous stable, and the current beta release, and the README's
supported-versions table to be generated from those results.

## Clarifications

### Session 2026-10-06

- Q: Without the assertion DSL (feature 006), what must a CI run check for a release to count as
  "passed" in the README table? → A: A fixed end-to-end smoke check: start and token, load a
  reference configuration, add a virtual device, set a state, advance time so an automation
  fires, call `ha_snapshot` and one WebSocket command, and tear down cleanly (FR-022, FR-028).
- Q: Is an instance's lifetime tied to the process that creates it, or can it keep running in the
  background until explicitly stopped? → A: Both. Tied to the process by default; a background
  mode with an explicit stop and a maximum lifetime after which the instance destroys itself
  (FR-029, FR-030).
- Q: Is the sandbox used as a command-line program, as a library other code imports, or both?
  → A: Both. The library is the primary interface (the one feature 006 builds on); a thin
  command-line program over it offers start, stop, list, cleanup, and the smoke check (FR-031,
  FR-032).
- Q: What exactly is "previous stable": the latest patch of the previous monthly release, or the
  previous patch within the current monthly release? → A: The latest patch of the previous
  monthly release (for example the newest 2026.9.x when the current stable is 2026.10.x)
  (FR-002).
- Q: When no beta is in progress (the last beta has already shipped as stable), what does the
  beta row show? → A: A "no beta in progress" status; the beta is not run and this does not count
  as a failure (FR-023).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Start a throwaway instance that is ready to use (Priority: P1)

A developer, or a CI job, asks the sandbox for a Home Assistant instance at a chosen release:
the current stable, the previous stable, or the current beta. The sandbox starts a fresh,
isolated instance, waits until it is genuinely ready, and hands back what the caller needs to
talk to it: the address and an administrator access token. Nobody has to click through the
first-run onboarding, create a user, or generate a token by hand.

**Why this priority**: Everything else in the sandbox, and every later check in the toolkit,
needs a running instance that can be created on demand and trusted to be in a known state. With
this alone, a developer already has a disposable instance they can point tools at.

**Independent Test**: Request an instance for each of the three release channels in turn.
For each, confirm the sandbox reports the exact release it resolved, that the instance accepts
the returned token as an administrator, and that no manual step was needed.

**Acceptance Scenarios**:

1. **Given** a machine with the container runtime installed and no instance running, **When** the
   caller requests the current stable release, **Then** within the readiness time limit the
   sandbox returns the instance address, an administrator token, and the concrete release number
   it started.
2. **Given** the same machine, **When** the caller requests the previous stable release, **Then**
   an instance of that older release starts and reports its own concrete release number.
3. **Given** the same machine, **When** the caller requests the current beta, **Then** an
   instance of the beta release starts and the sandbox's result states it is a beta.
4. **Given** an instance has just been started, **When** the caller uses the returned token for
   an administrator-only request, **Then** the request succeeds without any onboarding step
   having been performed by a person.
5. **Given** a release channel that cannot be resolved (for example, no beta in progress),
   **When** the caller requests it, **Then** the sandbox stops with a clear message
   naming the channel and starts nothing.

---

### User Story 2 - Clean teardown, even after a crash, and never a real instance (Priority: P1)

When a sandbox run ends, by finishing, by failing, or because the controlling process was killed,
everything it created is removed: containers, networks, volumes, and temporary files. Running
the sandbox again afterwards finds no leftovers and no conflicts. The sandbox only ever talks to
instances it created itself; it can never be pointed at the user's real instance.

**Why this priority**: A test harness that leaks containers, or can mutate a real home, is worse
than no harness. Safety and cleanliness are what make it acceptable to run on a laptop and on a
shared CI runner, so they ship with the first slice.

**Independent Test**: Start an instance, kill the controlling process abruptly, then run the
sandbox's cleanup and list what remains on the machine. Separately, try to point the sandbox at
an address it did not create.

**Acceptance Scenarios**:

1. **Given** a running sandbox instance, **When** the controlling process exits normally, **Then**
   every container, network, volume, and temporary file the sandbox created is gone.
2. **Given** a running sandbox instance, **When** the controlling process is killed abruptly,
   **Then** a subsequent sandbox invocation, or an explicit cleanup command, removes the orphaned
   resources and reports what it removed.
3. **Given** leftovers from an earlier crashed run, **When** a new run starts, **Then** it does
   not collide with them and does not remove resources that belong to a different, still-running
   sandbox.
4. **Given** an address of an instance the sandbox did not create, **When** the caller asks the
   sandbox to operate on it (start against it, load configuration into it, set states on it),
   **Then** the sandbox refuses and changes nothing.
5. **Given** two sandbox instances requested at the same time, **When** both run, **Then** they
   are isolated from each other and from the caller's real configuration, and each is torn down
   independently.
6. **Given** an instance started in background mode, **When** the developer runs the stop
   command, **Then** it is torn down as in scenario 1; **When** nobody stops it, **Then** it is
   torn down once its maximum lifetime has passed.

---

### User Story 3 - Load my repository's configuration into the instance (Priority: P2)

The user's configuration lives in a repository, laid out the way `ha-bootstrap` produces
(`packages/`, secrets encrypted). The developer points the sandbox at that configuration
directory and gets an instance running that configuration. The original directory is never
modified. If the configuration cannot load, the sandbox says why instead of silently leaving the
instance in a half-configured state.

**Why this priority**: A throwaway instance with the default configuration proves little. The
value of the sandbox is testing the user's own configuration, so this is the first thing that
makes the harness useful for real work; it is P2 only because User Stories 1 and 2 must exist
first.

**Independent Test**: Point the sandbox at a sample configuration directory containing a package
with an automation, start an instance, and confirm that automation exists in the running
instance, while the source directory is byte-for-byte unchanged afterwards.

**Acceptance Scenarios**:

1. **Given** a configuration directory in a repository, **When** the caller starts an instance
   with it, **Then** the instance runs that configuration and the source directory is unchanged
   after the run.
2. **Given** a configuration that fails the instance's own validation, **When** the caller starts
   an instance with it, **Then** the sandbox reports the validation errors and the instance is
   torn down; it is not handed back as ready.
3. **Given** a configuration that references secrets whose plaintext is not present, **When** the
   caller starts an instance with it, **Then** the sandbox does not read any encrypted or real
   secrets on its own: it either uses a plaintext secrets file the caller explicitly names, or
   substitutes clearly marked placeholder values, and tells the caller which it did.
4. **Given** a configuration directory that also contains runtime files (database, logs, internal
   storage), **When** the instance starts, **Then** those files are not carried into the instance.

---

### User Story 4 - Virtual devices, entity states, and time control (Priority: P2)

To exercise automations, the developer needs devices that do not exist physically. The sandbox
adds virtual devices by installing and configuring the existing community virtual-device
integrations, rather than providing its own device layer. Once devices exist, the developer can
set the state of any entity directly and control the instance's notion of time: set it to a given
moment, freeze it, and advance it, so that time-based automations can be exercised in seconds.

**Why this priority**: This is what turns an empty instance into a test bed. It depends on the
instance (US1) and on loading configuration (US3), but it delivers the core promise of the
sandbox: reproducible scenarios without real hardware.

**Independent Test**: Start an instance, add a virtual light and a virtual motion sensor, set the
sensor to "on", and confirm the instance reports that state. Set the time to just before an
automation's scheduled time, advance past it, and confirm the automation fired.

**Acceptance Scenarios**:

1. **Given** a running sandbox instance, **When** the caller requests a virtual device of a
   supported kind (for example a light, a switch, a sensor), **Then** the entity appears in the
   instance and responds to commands like a real one.
2. **Given** a running sandbox instance, **When** the caller sets an entity's state and
   attributes, **Then** reading that entity back returns exactly what was set.
3. **Given** a running sandbox instance, **When** the caller freezes time at a chosen moment and
   advances it past an automation's time trigger, **Then** the automation fires exactly once.
4. **Given** the virtual-device integrations are not available (for example, a release they do
   not yet support), **When** the caller requests a virtual device, **Then** the sandbox says
   which integration and which release are the problem instead of failing generically.
5. **Given** a request for a device kind the reused integrations do not support, **When** the
   caller asks for it, **Then** the sandbox says it is unsupported and does not fabricate its
   own substitute.

---

### User Story 5 - Reach the instance with existing tools (Priority: P2)

The developer wants to use what DomusOps already ships against the sandbox instance: the MCP
tools (`ha_snapshot`, `ha_logbook_query`, `ha_trace`) and anything that speaks the instance's
WebSocket API. The sandbox exposes the instance in exactly the form those tools already expect
(an address and an administrator token), so no tool needs sandbox-specific code.

**Why this priority**: The sandbox exists so that checks can run against it. The connection
details are a small slice of work that makes the harness usable by everything already built.

**Independent Test**: Start an instance, configure the MCP server with the values the sandbox
returned, and call `ha_snapshot`; then open a WebSocket connection with the same values and run a
read-only command.

**Acceptance Scenarios**:

1. **Given** a running sandbox instance, **When** the caller reads the sandbox's connection
   output, **Then** it contains the address and the token in the form the MCP server's
   configuration uses.
2. **Given** an MCP server configured with those values, **When** it calls `ha_snapshot`,
   **Then** it returns a snapshot of the sandbox instance.
3. **Given** the same values, **When** a client opens a WebSocket connection and authenticates,
   **Then** authentication succeeds and commands work.
4. **Given** the sandbox has torn the instance down, **When** a client reuses the old address
   and token, **Then** the connection fails; the token is not valid for anything else.

---

### User Story 6 - CI proves which Home Assistant versions are supported (Priority: P3)

A continuous-integration job runs the harness against each release in the matrix (current stable,
previous stable, current beta) and records one machine-readable result per release. The README's
"Supported Home Assistant versions" table is generated from those results, never written by hand.
A maintainer reading the README can trust that every row reflects an actual recent run.

**Why this priority**: Constitution §8 requires it, and it is what the user-facing support claim
rests on. It builds on the harness being able to start, load, and tear down, so it comes last.

**Independent Test**: Run the CI job locally or in CI, then regenerate the README table from its
results; confirm every matrix release has a row, and that editing the table by hand is detected.

**Acceptance Scenarios**:

1. **Given** the CI workflow, **When** it runs, **Then** it runs the fixed smoke check (FR-028)
   once per release in the matrix and uploads one result per release, whether the run passed or
   failed.
2. **Given** results for all matrix releases, **When** the table generator runs, **Then** the
   README table lists each release with its concrete release number, outcome, and the date of the
   run.
3. **Given** a hand-edited table in the README, **When** the repository's checks run, **Then**
   the difference from the generated table is reported and the check fails.
4. **Given** the beta release fails while the stable releases pass, **When** the table is
   generated, **Then** the beta row shows the failure and the stable rows are unaffected.
5. **Given** a release in the matrix cannot be started at all (for example, the image is not
   published), **When** the CI job runs, **Then** that release is reported as "could not run",
   which is distinguishable from "ran and failed".
6. **Given** no beta is in progress, **When** the CI job runs, **Then** the beta row shows "no
   beta in progress", no beta instance is started, and the job does not fail because of it.

---

### Edge Cases

- The container runtime is not installed or not running: the sandbox stops before doing anything
  and says what is missing.
- The instance does not become ready within the time limit: the sandbox tears it down, reports
  the last log lines, and returns a failure; it never returns a half-started instance.
- A required network port is already in use on the host: the sandbox picks a free one instead of
  failing, and reports the chosen address.
- The configuration directory is large or contains symbolic links that point outside it: the
  sandbox must not copy or follow anything outside the directory the caller named.
- The machine has no network access or the image registry is unreachable: the sandbox reports
  that the image could not be fetched; if the image is already present locally, it is used.
- Concurrent runs on one CI runner: each run gets its own isolated instance and does not tear
  down another run's resources.
- The sandbox is interrupted during startup, before the instance exists: nothing is left behind.
- The caller loses the token: it can be read again for as long as the instance runs, and is
  never written to the repository or to CI logs.
- Time control is requested before the instance is ready: the sandbox waits, or refuses with a
  clear message, rather than applying it to an unready instance.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The sandbox MUST start a fresh, isolated Home Assistant instance at a release chosen
  from three channels: current stable, previous stable, and current beta.
- **FR-002**: The sandbox MUST resolve each channel to a concrete release number at run time and
  report that number to the caller; it MUST NOT rely on a hard-coded release list that goes
  stale. "Current stable" is the newest stable release; "previous stable" is the newest patch of
  the monthly release before it (for example the newest 2026.9.x when current stable is
  2026.10.x); "current beta" is the newest beta release.
- **FR-003**: The sandbox MUST return the instance only when it is ready to serve requests, and
  MUST fail, with teardown, if readiness is not reached within a documented time limit.
- **FR-004**: The sandbox MUST provision the instance so that no manual onboarding is needed, and
  MUST provide a known administrator token with it.
- **FR-005**: The administrator token MUST be unique to each instance, MUST be valid only for
  that instance's lifetime, and MUST NOT be written to the repository or to CI logs.
- **FR-006**: The sandbox MUST be able to run the user's configuration directory in the instance,
  and MUST NOT modify the source directory in any way.
- **FR-007**: The sandbox MUST NOT carry runtime files (databases, logs, internal storage,
  caches) from the source directory into the instance, and MUST NOT copy or follow anything
  outside the directory the caller named.
- **FR-008**: The sandbox MUST NOT read encrypted secrets, or any file containing real secrets,
  unless the caller names it explicitly; when secrets are absent it MUST say whether it used a
  caller-provided file or placeholder values.
- **FR-009**: If the loaded configuration fails the instance's own validation, the sandbox MUST
  report the validation errors and tear the instance down rather than return it as ready.
- **FR-010**: The sandbox MUST add virtual devices by installing and configuring the existing
  community virtual-device integrations; it MUST NOT implement its own virtual-device layer.
- **FR-011**: When a requested device kind is not supported by the reused integrations, or an
  integration is not compatible with the chosen release, the sandbox MUST say which one and
  MUST NOT substitute its own.
- **FR-012**: The sandbox MUST let the caller set the state and attributes of an entity directly
  and read them back unchanged.
- **FR-013**: The sandbox MUST let the caller set, freeze, and advance the time seen by the
  instance, so time-based automations can be exercised without waiting in real time.
- **FR-014**: The sandbox MUST expose the instance's address and administrator token in the form
  the existing `@domusops/mcp` server is configured with, so the existing tools work against it
  without sandbox-specific code.
- **FR-015**: The sandbox MUST expose the same connection details for clients of the instance's
  WebSocket API.
- **FR-016**: The sandbox MUST remove every resource it created (containers, networks, volumes,
  temporary files) when a run ends normally or fails.
- **FR-017**: After an abrupt termination of the controlling process, the sandbox MUST be able to
  find and remove orphaned resources on the next run or through an explicit cleanup command, and
  MUST report what it removed.
- **FR-018**: The sandbox MUST identify the resources it creates, and MUST only ever remove
  resources it created itself; it MUST NOT affect a different, still-running sandbox.
- **FR-019**: The sandbox MUST only operate on instances it created itself; it MUST refuse any
  operation aimed at an address it did not create, and MUST NOT contact the user's real instance
  under any circumstance.
- **FR-020**: Several sandbox instances MUST be able to run at the same time without sharing
  state, ports, or storage.
- **FR-021**: The only hard runtime dependency of the sandbox MUST be a container runtime; any
  other tool the sandbox needs MUST either run inside a container or be reported as missing
  before anything is started.
- **FR-022**: The CI workflow MUST run the sandbox against every release in the matrix (current
  stable, previous stable, current beta) and MUST publish one machine-readable result per release
  containing: the channel, the concrete release number, the outcome, and the date.
- **FR-023**: Each result MUST distinguish four outcomes: passed, failed, could not run, and (for
  the beta channel only) no beta in progress. "No beta in progress" applies when the newest beta
  is not newer than the current stable; the beta is then not run, and the outcome is not a
  failure.
- **FR-028**: A release MUST count as "passed" only when the fixed smoke check completes in
  order: the instance starts and accepts its token; a reference configuration shipped with the
  sandbox loads; a virtual device is added; an entity state is set and read back; time is
  advanced so an automation in the reference configuration fires; `ha_snapshot` returns a
  snapshot; one WebSocket command succeeds; and teardown leaves nothing behind. The result MUST
  name the first step that failed.
- **FR-029**: By default, an instance's lifetime MUST be tied to the invocation that created it:
  it is torn down when that invocation ends, however it ends.
- **FR-030**: The sandbox MUST also offer a background mode in which the instance outlives the
  invocation that started it, can be listed, and is torn down by an explicit stop command. Every
  background instance MUST have a maximum lifetime (default 2 hours, configurable at start),
  after which it is torn down even if nobody stops it.
- **FR-031**: Every capability of the sandbox (start, configuration loading, virtual devices,
  states, time control, connection details, teardown, cleanup) MUST be available through a
  library interface that other code, including feature 006, can import.
- **FR-032**: A command-line program MUST expose, on top of that library and without logic of its
  own, the commands start (tied or background), stop, list, cleanup, and the smoke check; the CI
  job MUST use this program.
- **FR-024**: The README's supported-versions table MUST be generated from those results by a
  script, MUST NOT be edited by hand, and a repository check MUST fail when the committed table
  differs from what the script generates.
- **FR-025**: A failure on the beta release MUST be visible in the table but MUST NOT, by
  itself, block merging a change; a failure on either stable release MUST.
- **FR-026**: The sandbox package MUST be versioned independently of the other packages, and every
  user-visible change to it MUST carry a changeset.
- **FR-027**: Every artifact of this feature (code, documentation, messages, results) MUST be in
  English.

### Key Entities

- **Release channel**: One of current stable, previous stable (newest patch of the previous
  monthly release), current beta. Resolved to a concrete release number each time it is used.
- **Sandbox instance**: A throwaway Home Assistant instance with an address, an administrator
  token, a resolved release number, a mode (tied to its invocation, or background with a maximum
  lifetime), and a lifetime that ends at teardown. Owns every resource created for it.
- **Configuration source**: The directory from a repository that is run in an instance. Read-only
  from the sandbox's point of view.
- **Virtual device**: A device that exists only in the instance, provided by a reused community
  integration, with a kind (light, switch, sensor, and so on) and the entities it exposes.
- **Run result**: The machine-readable record of one sandbox run against one release channel:
  channel, concrete release, outcome (passed, failed, could not run, or no beta in progress), the
  first failed smoke-check step when it failed, and date.
- **Supported-versions table**: The README table derived only from run results.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From a cold start, a developer obtains a ready instance with a working
  administrator token in under 3 minutes with the image already downloaded, with no manual step.
- **SC-002**: In 100% of runs, including runs ended by killing the controlling process, no
  sandbox containers, networks, volumes, or temporary files remain after the next run or the
  explicit cleanup command.
- **SC-003**: Across 20 consecutive runs of the same configuration, the source directory is
  byte-for-byte identical afterwards in every run.
- **SC-004**: A developer can have an automation with a time trigger fire, and observe the result,
  in under 10 seconds of real time.
- **SC-005**: The existing MCP tools and a WebSocket client both work against the instance using
  only the connection details the sandbox returns, with zero changes to those tools.
- **SC-006**: Every row of the README supported-versions table links to the recorded CI run
  result that produced it; no row exists that no run produced.
- **SC-007**: Every attempt to point the sandbox at an instance it did not create is refused,
  and the target is unchanged in 100% of attempts.
- **SC-008**: Two sandbox instances started together run to completion without interfering, in
  100% of 10 paired runs.

## Assumptions

- Developers and CI runners have a container runtime installed; it is the only hard requirement.
  Installing it is out of scope.
- "Current stable", "previous stable", and "current beta" are determined from the publicly
  published Home Assistant container releases at run time.
- The README table lives in the existing "Supported Home Assistant versions" section and is
  produced by a repository script from CI results, and replaces the "Not yet published" text.
- The existing `sandbox-matrix` CI job is the starting point. It is not yet a required check on
  the protected branch; how the stable-versus-beta merge-blocking rule in FR-025 is enforced
  (for example, a required summary check over the stable results) is decided during planning.
- The virtual-device integrations to reuse are the ones named in `docs/SEED.md` §2.3; which of
  them covers which device kind is decided during planning.
- The administrator token is generated per instance; no long-lived credential is ever stored in
  the repository.
- The `ha-bootstrap` repository layout (`packages/`, `secrets.sops.yaml`) is the expected shape
  of a configuration source, but any valid configuration directory works.

## Out of Scope

- The declarative scenario and assertion DSL, its runner, and assertion results: feature 006.
- `ha_diff` and `ha-migrate`, and any use of the sandbox as a migration check.
- Rebuilding or forking any virtual-device integration.
- Running against a real instance, in any mode, including read-only.
- Hosted or remote sandboxes; the sandbox runs where the container runtime runs.
- Container runtime installation and management.
