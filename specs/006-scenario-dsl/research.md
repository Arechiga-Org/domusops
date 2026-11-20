# Research: Scenarios — Declaring and Proving What an Automation Does

**Feature**: `006-scenario-dsl` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

Every decision below builds on the harness of `specs/005-sandbox-harness` as published in
`@domusops/sandbox` 0.1.3: one container per instance, a filtered copy of the configuration,
`hass-virtual` for virtual devices, and the `domusops_sandbox` companion integration for the clock
and self-teardown.

## R1 — Isolation: a fresh instance per scenario

**Decision**: Every scenario gets its own throwaway instance, started for it and removed after it,
on every outcome. A run can start up to `parallel` instances at once (default 1).

**Rationale**: FR-019 asks that nothing a scenario changed, started or scheduled reaches the next
one. A fresh instance is the only way that needs no proof beyond the harness's own. Measured on
the project's CI runners (run 44577094005, 2026-11-19), an instance is ready in 10–14 s once the
image is present (`onboarding on stable`: 13.3 s; `previous-stable`: 9.5 s). A 10-scenario suite
then costs about 10 × (15 s start + scenario time + 2 s teardown); with scenarios of under 20 s of
real time, under 7 minutes sequentially, within SC-005's 10 minutes. The image is pulled once per
release. `parallel` exists so a larger suite can trade memory for time; CI keeps 1 until the
numbers say otherwise.

**Alternatives considered**:

- _One instance per suite, restored between scenarios_ (reload automations, scripts and helpers,
  reset states, cancel timers): reloads do not reset restored states, template entities, running
  `timer` helpers or the recorder, and each gap would be a cross-scenario leak SC-004 could not
  rule out. Rejected.
- _A snapshot of the container after start, restored per scenario_ (`docker commit` or a volume
  copy): the instance would restart from a copied `.storage` with a token and a companion state
  bound to the old container, so it saves little over a fresh start (onboarding is a few HTTP
  calls) and adds a second lifecycle. Rejected.

## R2 — File syntax: YAML 1.2 with positions

**Decision**: Scenario files are YAML, parsed with `yaml` 2.x (already in the workspace through
`@domusops/bootstrap`) using its YAML 1.2 core schema, `uniqueKeys: true` and a `LineCounter`, so
every problem points at `file:line:column`. Files are `*.yaml` and `*.yml` under the scenarios
directory, recursively, read in path order. Custom tags (`!secret`, `!include`, `!input`) are
refused: a scenario file names no secrets and includes nothing. Anchors and aliases are allowed;
merge keys (`<<`) are not.

**Rationale**: The people and agents who write scenarios already write the configuration in YAML,
and SEED §2.3 shows YAML. Under YAML 1.2 `on` and `off` are strings, so the SEED example parses as
written (`binary_sensor.hallway_motion: on` is the state `"on"`); under YAML 1.1 they would become
booleans. Positions are what FR-005 and SC-003 need.

**Alternatives considered**: JSON (no comments, unlike the configuration it sits next to); TOML
(foreign to the ecosystem); a TypeScript DSL (excludes non-developers and agents writing plain
files). Rejected.

## R3 — Where the format lives and how it is checked

**Decision**: `@domusops/schema` gets `src/scenario/`: the format identifier
`domusops.scenario/0.1`, the types of the document as written and of its normalised form, a JSON
Schema (for editors: `# yaml-language-server: $schema=...`, shipped as
`schema/scenario.schema.json`), and a dependency-free checker,
`checkScenarioDocument(value)`, that returns every issue with a JSON Pointer path and a code, and a
normaliser, `normalizeScenarioDocument(value)`, that turns a valid document into the one canonical
shape the runner executes. The sandbox parses YAML, calls the checker, and maps each path back to
a line and column through the parsed document's nodes. The report format,
`domusops.scenario-report/0.1`, lives beside it with its own types and JSON Schema.

**Rationale**: FR-002 and constitution §5: the format is public and stable, and the schema package
stays free of dependencies (it has none today). A hand-written checker gives readable messages
("`then[1]`: `brightness_pct` needs a number for `at_least`") where a generic JSON Schema
validator gives schema paths. A test keeps the checker and the JSON Schema in agreement over every
valid and invalid fixture (with `ajv`, a dev dependency of the sandbox already).

**Alternatives considered**: Only a JSON Schema, validated with `ajv` in the sandbox (generic
messages, and the schema package could not check a document by itself); the format in the sandbox
package (contradicts SEED §2.3 and FR-002). Rejected.

## R4 — Document shapes

**Decision**: A file declares `format: domusops.scenario/0.1` and holds either one scenario at the
top level (the SEED shape: `scenario`, `given`, `when`, `then`) or a `scenarios` list, and in
either case an optional `starting_points` map. In `given` and in an entity expectation, keys
containing a dot are entity IDs and keys without one are keywords, so the SEED example is valid
once it names the format. The full grammar is in
[contracts/scenario-format.md](./contracts/scenario-format.md).

**Rationale**: Entity IDs always contain a dot, keywords never do, so the two never collide and
the common case reads as SEED wrote it. Two top-level shapes cost one `oneOf` and keep a
one-scenario file as short as the example people will copy.

**Alternatives considered**: Entities only under `states:` (longer, unlike SEED); one scenario per
file (FR-004 allows several, and named starting points want to sit near the scenarios using them).

## R5 — Stand-ins

**Decision**: A stand-in is declared by entity ID: `stand_ins: { light.hallway: {} }`. Its kind is
the entity ID's domain, which must be one of the harness's `DEVICE_KINDS`; its `hass-virtual`
device name is the object ID (`hallway`), whose slug is itself, so the entity comes out as
`light.hallway`. Optional `class` and `initial` map to the integration's own fields. The runner
starts the instance with `devices: []`, checks that no declared entity exists yet (`getState` is
null), then calls `addDevices` and checks that each created device's `entityId` is the declared
one. An existing entity, or an ID the integration suffixed (`light.hallway_2`), stops the scenario
as could not run with `stand_in_exists`; an unoffered domain stops it with
`stand_in_kind_unsupported` and the offered kinds.

**Rationale**: FR-008 and the three acceptance scenarios of User Story 2, with no device layer of
DomusOps' own. Checked against the pinned `hass-virtual` source: a light supports brightness by
default (`DEFAULT_SUPPORT_BRIGHTNESS = True`), so the SEED expectation on brightness can hold
without new device options.

**Alternatives considered**: Renaming the entity in the registry after creation (works for any
name, but writes to the registry of an instance whose configuration may also own that ID, hiding
the conflict FR-008 must report). Rejected.

## R6 — Absent actions

**Decision**: The companion gets one WebSocket command, `domusops_sandbox/actions/absent`, taking
the declared patterns (`notify.mobile_app_phone`, or `notify.*` for a whole domain). It answers
`action_offered` with the names of declared exact actions the instance already offers; the runner
turns that into could not run. Otherwise it wraps `ServiceRegistry.async_call` once: the original
call runs, and only when it raises `ServiceNotFound` for an action that matches a pattern does the
wrapper fire the instance's own `call_service` event for it, with an added `domusops_absent: true`,
and return as a successful call (`None`, or an empty response when one was asked for). A domain
pattern covers only the actions that domain does not offer. The wrapper is installed only by that
command, so scenarios that declare nothing run on the untouched registry. Like the clock, the
internals it needs are probed on first use and a release that lacks them answers
`actions_unavailable`; the runner reports could not run, naming it.

**Rationale**: FR-008a. A domain pattern cannot be served by registering services, because the
names an automation calls under it are not known in advance (they can be templated). Catching
only `ServiceNotFound` for declared patterns leaves every real action untouched, so a typo in an
undeclared action still fails as it does in Home Assistant. Firing the regular event keeps one
recording path for real and absent calls (R7).

**Alternatives considered**: Registering a service per declared exact name (public API, but no
domain patterns, and `has_service` would turn true, which changes what templates see); scanning
automations and scripts for action names (misses templated names). Rejected.

## R7 — Recording what happens

**Decision**: Right before the first step of `when`, the runner opens one WebSocket and subscribes
to `state_changed`, `call_service` and `automation_triggered`. Every event is kept in memory, in
order, with its `time_fired`, until the scenario ends; a scenario that records more than 20 000
events fails with `recording_limit`. `call_service` events carry the action's data with its target
already merged in (the registry merges `target` into the data before firing), so `called`
expectations match on `entity_id`, `device_id` and `area_id` in that data.

**Rationale**: FR-013a, FR-013b and FR-014 all read the same record; failed `called` expectations
list the matching calls (FR-025). These are public events available on every supported release.
`time_fired` is instance time because the companion's clock replaces the timestamp source of
`homeassistant.core` while frozen.

**Alternatives considered**: Polling states only (cannot see a change that came and went within a
span, nor calls); reading the logbook or traces (indirect, and only for automations). Rejected.

## R8 — Time

**Decision**: Every scenario freezes the instance's clock before its starting point is applied,
and keeps it frozen until it ends. The start moment is `given.date` and `given.time`; without a
date, the default date is **2026-04-15, a Wednesday**; without a time, 12:00:00. Both are read in
the instance's time zone: the configuration's `homeassistant: time_zone`, otherwise the one
onboarding leaves (UTC); the report states the moment with its offset and weekday. `advance` uses
`time.advance`; `advance_to` computes the seconds to the next occurrence of a time of day, or to a
full date and time, and refuses a moment in the past. Durations are written as Home Assistant
writes them: seconds as a number, `"HH:MM:SS"` or `"HH:MM"`, or `{ hours, minutes, seconds }`.

**Rationale**: FR-006, FR-012 and SC-004: a frozen clock makes results independent of when and how
fast a run happens. A fixed default date keeps weekday conditions stable. The duration forms match
`delay` in automations, so nobody learns a second syntax. A release whose time control answers
`time_unavailable` cannot give deterministic results, so its scenarios could not run, with that
reason.

**Alternatives considered**: Freezing only when a scenario names a time (results would depend on
the real clock for the others, against SC-004); a default date of "today" (weekday-dependent
results). Rejected.

## R9 — When an expectation is checked

**Decision**: After each step, the runner gives the instance time to react before it reads
anything:

- A positive expectation (a state or attribute, `triggered`, `called`) is checked at once and,
  while it does not hold, again every 100 ms for up to `settle` of real time (default 5 s,
  settable per scenario and per expectation). With `within: <duration>`, the runner advances the
  clock in steps of one second (or one sixtieth of the duration, whichever is longer) and checks
  after each step until it holds or the duration has passed, so a delayed automation is seen as
  soon as it acts.
- A negative expectation (`not_called`, `triggered` with `times: 0`, `times` exact counts) and a
  span (`for:`) are checked once the instance is quiet: no new recorded event for 500 ms of real
  time, at most `settle`. A span then advances the clock by its duration and fails on the first
  recorded change to the entity, or the attribute, within it, naming its instance time and value.

**Rationale**: FR-014, FR-015 and acceptance scenario 4 of User Story 1. Real-time polling covers
the asynchronous hand-offs inside the instance; instance-time `within` covers delays without
waiting for them. Negative checks need quiet, or they pass before the action they rule out.

**Alternatives considered**: A fixed sleep after each step (slow and still racy); waiting for the
automation's trace to finish (only for automations, and absent for actions called by scripts or
integrations). Rejected.

## R10 — Comparing values

**Decision**: One rule for states and attributes (FR-017). `null` matches an attribute that is
absent or null. When both the expected and the actual value are numbers or text that reads as a
finite decimal number, they are compared as numbers (`15` matches `"15"` and `15.0`). Otherwise
both are compared as text, booleans as `true`/`false`, so `on` (text) does not match `true`. Lists
and objects are compared as JSON, in order. `at_least`, `at_most` and `between` need numbers on
both sides; an actual value that is not one fails with `not_a_number`, showing it. For a light,
`brightness_pct` is derived from `brightness` as `round(brightness × 100 / 255)` when the entity
does not carry it, since the attribute is a service field Home Assistant does not keep.

**Rationale**: States are always text in Home Assistant and attributes keep their own types, so a
rule that ignores the number-versus-text difference and nothing else matches how people read
them. The derived attribute keeps the SEED example readable.

## R11 — Release targets, time limits and outcomes

**Decision**: A run takes channels and releases as the harness does, resolving each channel once;
each scenario runs on each release in turn, and each result carries the concrete release. A
channel with no beta in progress produces a `not_run` row, not a failure. Each scenario has a
total time limit of 300 s by default (`--scenario-timeout`, `timeout` in the file), counted from
the start of its instance; reaching it fails the scenario with `time_limit` and the instance is
removed. Outcomes and their causes are fixed in
[data-model.md](./data-model.md) §5.

**Rationale**: FR-020, FR-022, FR-024; the `not-run` row follows the smoke check's
`no-beta-in-progress`.

## R12 — Interfaces

**Decision**: Library first: `loadScenarios` (find, parse, check, normalise, resolve starting
points; no instance), `runScenarios` (run a loaded suite, returning the report object), and the
report renderers, all exported from `@domusops/sandbox`. The CLI gains one subcommand,
`domusops-sandbox test`, which only parses options, calls them and prints
([contracts/cli.md](./contracts/cli.md)). Exit codes reuse the harness's: 0 all passed, 1 some
scenario failed, 3 none failed but some could not run, 2 usage or invalid files. The `Sandbox`
handle gains `fireEvent(eventType, data)`, additively; nothing existing changes (FR-031).

**Rationale**: FR-021 and the harness's "the command adds no logic of its own". A failure ranks
above could not run in the exit status because it is a definite finding; the report gives both
counts.

## R13 — The reference suite, the gate and the example workflow

**Decision**:

- A new fixture, `packages/sandbox/fixtures/scenario-config/`, written for this repository: a few
  automations on synthetic entities (night motion with a stand-in light and an absent media
  player action, a five-minute off delay, a weekday-only routine, an automation that must not
  fire) and its `scenarios/` directory: the reference suite. The smoke check's fixture is not
  touched (FR-029).
- Each `sandbox-matrix` leg runs `domusops-sandbox test --config <fixture> --channel <leg>
--report scenario-report-<leg>.json` after the smoke check and uploads the report. `sandbox-gate`,
  already a required check, also reads the reports, downloaded into their own directory
  (`scenario-reports`; the smoke results' directory is read file by file and must hold nothing
  else): a failure or could-not-run on stable or previous stable fails it; on beta it is listed
  and does not (FR-030).
- The documentation, `packages/sandbox/docs/scenarios.md`, carries the example workflow between
  markers. A CI job, `scenario-example`, builds a throwaway repository from the fixture, installs
  the packed packages as a user would install them from npm, and runs the commands of the
  example; a unit test keeps the job's commands identical to the documented block (FR-021a).

**Rationale**: The gate already decides merges (§9) and already distinguishes stable from beta, so
extending it beats a second required check that branch protection would need to learn about.

## R14 — Reports, secrets and size

**Decision**: The report object is `domusops.scenario-report/0.1`
([contracts/report-format.md](./contracts/report-format.md)). Passed expectations are counts;
failed ones carry subject, check, expected, actual, instance time and, for actions, up to 10
matching calls. The readable report lists every expectation with its outcome. Before anything is
written, every string in a report or an error goes through the harness's secret scrubbing: the
instance token and the values of a named secrets file are replaced (FR-028). A test asserts
SC-009 (machine report at least 5 times smaller than the readable one for 10 scenarios with one
failure) and SC-007 (seeded token and secret values never appear).

**Rationale**: Constitution §4 applies in spirit: the report is what an agent reads to act.

## R15 — Package versions

**Decision**: `@domusops/schema` 0.2.0 → 0.3.0 (new exported format); `@domusops/sandbox` 0.1.3 →
0.2.0 (new command and library functions). `@domusops/mcp` and `@domusops/bootstrap` unchanged.
The sandbox gains the `yaml` dependency and a dependency on `@domusops/schema` (workspace), which
it dropped in 005 because it was unused.

## R16 — Applying the starting point without firing automations

**Decision**: Before writing the `given` states, the runner lists the automations that are on and
turns them off with `automation.turn_off` (`stop_actions: true`); it writes the states, reads them
back, then turns the same automations on again. Recording starts after that. State triggers fire
on changes only, so turning an automation on does not fire it for the states written while it was
off; a `for:` trigger arms on the next change. An automation that was off stays off.

**Rationale**: FR-007 and SC-004. Writing `presence.house: away` is a state change; without this,
any automation of the configuration that reacts to it would run during the scenario, adding calls
and changes no step caused.

**Alternatives considered**: Applying states before the automations load (the harness has no hook
between loading the configuration and starting the automations); ignoring what happens before the
first step (its actions keep running into the scenario). Rejected.

## Verification before building

Five facts are checked against the real image on stable, previous stable and beta by the first
container tests, before the code that depends on them:

1. `ServiceRegistry.async_call` raises `ServiceNotFound` for an unknown action, and wrapping it at
   class level is seen by the script engine (R6).
2. `call_service` events carry the target merged into `service_data`, and `automation_triggered`
   events carry `entity_id` (R7).
3. `time_fired` of recorded events is the frozen instance time (R7, R8).
4. `homeassistant: time_zone` set in the configuration is the instance's time zone after
   onboarding, although onboarding sends an empty `core_config` (R8).
5. Turning an automation off with `stop_actions: true`, writing a state its trigger watches, and
   turning it on again fires nothing (R16).

If one fails, this document is updated before continuing.
