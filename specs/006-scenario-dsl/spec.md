# Feature Specification: Scenarios — Declaring and Proving What an Automation Does

**Feature Branch**: `006-scenario-dsl`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: part 2 of 2 of `docs/SEED.md` backlog item 3 ("`@domusops/sandbox` —
ephemeral HA plus the assertion DSL"), reserved as feature 006 since `specs/005-sandbox-harness`.
A declarative, versioned scenario format, public in `@domusops/schema` as an open contract, and a
runner in `@domusops/sandbox` that drives the existing harness (throwaway instance, virtual
devices, entity states, time control) from it. A scenario has a name, `given` (the starting point:
time of day and entity states, for example a weekday morning, an empty house or a power outage),
`when` (what happens) and `then` (declarative assertions on entity states and attributes), as in
SEED §2.3: scenario `hallway_night_motion`, given the time 03:00 and `presence.house` away, when
`binary_sensor.hallway_motion` turns on, then `light.hallway` is on with `brightness_pct` 15 and
`media_player.living_room` is off. Scenarios live in the user's configuration repository next to
the automations they test, and run against that configuration copied into a throwaway instance,
never against a real one. Results are reported per scenario and per assertion, with the expected
and actual values, so a person or an agent can tell what failed and why. Open decisions for
clarification: the scope of assertions, whether `when` supports sequences with waits, reusable
starting points, how scenarios are run, and whether they extend or replace the fixed smoke check.
Out of scope: `ha_diff` and `ha-migrate` (later backlog items; `ha-migrate` depends on this
feature to prove parity), rebuilding virtual devices, and any real instance.

## Clarifications

### Session 2026-11-19

- Q: Besides entity states and attributes, what else must an expectation be able to check? → A:
  That an automation triggered or did not (optionally how many times), and that an action was
  called or not, with its target and data.
- Q: When an automation calls an action the throwaway instance does not offer, what happens? →
  A: Only actions the scenario declares in `given` (one by one or by domain) are answered by the
  runner: recorded as called, no state changed, the automation continues. Any other missing
  action fails as in Home Assistant.
- Q: What does the first version of the format include? → A: Everything: a single event,
  sequences with time and expectations between steps, spans that must hold, and named starting
  points.
- Q: How does a user's configuration repository run scenarios in its CI? → A: With the command
  alone, plus an example workflow in the documentation that the project's CI proves works; no
  reusable CI action is published.
- Q: In the project's CI, does a reference-suite failure on stable or previous stable block a
  pull request's merge? → A: Yes: the suite runs in a required check on stable and previous
  stable; on beta it is visible without blocking.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Proving one automation with one scenario (Priority: P1)

A person maintaining a home configuration, or an agent changing it for them, writes a scenario
next to the automation it tests: the starting point, the one thing that happens, and what must be
true afterwards. They run it. The configuration is loaded into a throwaway instance, the starting
point is applied, the event happens, and each expected outcome is checked. The result says, for
the scenario and for each expectation, whether it passed, and for each failure what was expected
and what the instance actually showed.

**Why this priority**: This is the capability SEED names as the one that does not exist anywhere:
a declarative statement of what an automation must do, checked against the real configuration
without touching the real home. Every other story builds on it.

**Independent Test**: With a reference configuration that has one automation acting on helper
entities, a scenario whose expectations hold passes; the same scenario with one expectation
changed fails on exactly that expectation, naming the expected and the actual value; and the real
source directory is unchanged afterwards.

**Acceptance Scenarios**:

1. **Given** a configuration with an automation that turns a light on at 15% brightness when
   motion is detected at night while the house is away, and a scenario stating that starting
   point, that event and that outcome, **When** the person runs the scenario, **Then** it passes,
   and the result lists each expectation as passed.
2. **Given** the same scenario with an expected brightness of 30%, **When** it runs, **Then** the
   scenario fails, the brightness expectation fails with expected 30 and actual 15, and every
   other expectation is still reported with its own outcome.
3. **Given** an expectation on an entity that does not exist in the instance, **When** the
   scenario runs, **Then** that expectation fails with a reason that says the entity does not
   exist, distinct from a wrong value.
4. **Given** an automation that runs a few moments after its trigger, **When** the scenario runs,
   **Then** each expectation is checked until it holds or a bounded wait runs out, so an outcome
   that takes a moment is not reported as a failure.
5. **Given** a scenario file with a mistake (an unknown key, a malformed entity ID, a missing
   section), **When** the person runs it, **Then** it is refused before any instance starts, with
   the file, the place in it and what is wrong.
6. **Given** any run, **When** it ends, passed or failed, **Then** the throwaway instance is gone
   and the source configuration directory is unchanged.

---

### User Story 2 - Standing in for devices the sandbox cannot run (Priority: P1)

A real configuration controls devices through integrations that cannot run in a throwaway
instance: a radio stick, a vendor cloud, a local hub. Their entities do not exist there, so an
automation's action on `light.hallway` would land nowhere and every expectation on it would fail.
The scenario declares stand-ins: virtual devices that take the real entity IDs, so the
automation's actions land on them and can be checked.

**Why this priority**: Without stand-ins only automations that act on helpers can be tested, which
excludes almost every automation in a real home. The SEED example itself needs one.

**Independent Test**: With a configuration whose automation turns on `light.hallway`, provided by
an integration that does not load in the sandbox, a scenario that declares a stand-in light with
that entity ID passes, and the same scenario without the stand-in fails with a reason that names
the missing entity.

**Acceptance Scenarios**:

1. **Given** a scenario that declares a stand-in light, sensor or switch with a real entity ID,
   **When** it runs, **Then** the entity exists in the instance under that ID before the starting
   point is applied, and the automation's actions on it change its state and attributes.
2. **Given** a stand-in of a kind the reused virtual-device integrations do not offer, **When**
   the scenario runs, **Then** it does not run, and the result names the kind and lists the kinds
   that are offered.
3. **Given** a stand-in whose entity ID the configuration itself already provides, **When** the
   scenario runs, **Then** it does not run, and the result says that the entity already exists,
   so a test never silently replaces a real entity of the configuration.
4. **Given** an automation that turns on a stand-in light, then sends a notification through an
   integration that does not load in the sandbox, and a scenario that declares that notification
   action as absent, **When** it runs, **Then** the call is recorded, the automation continues to
   its next action, and an expectation that the notification was sent passes; without the
   declaration, the call fails as it would in Home Assistant and the result says which action was
   missing.

---

### User Story 3 - Time and sequences (Priority: P2)

Many automations depend on the clock or on something lasting: lights off five minutes after the
last motion, a heater that stops after an hour, a routine on weekday mornings only. The scenario
states the date and time it starts at, and `when` can be a sequence: an event, then time passing,
then another event. Expectations can be checked at a point in the sequence, and can state that
something must not happen.

**Why this priority**: Time-based automations are the ones people break most and can least test
by hand; the harness already controls the instance's clock, so the scenario only has to say it.
A single event already gives value without it.

**Independent Test**: With an automation that turns a light off five minutes after motion stops,
a scenario that turns motion off, advances four minutes, expects the light still on, advances two
more minutes and expects it off, passes in seconds of real time; changing the automation's delay
to ten minutes makes the second expectation fail.

**Acceptance Scenarios**:

1. **Given** a scenario starting on a stated date and time, **When** it runs, **Then** the
   instance's clock shows that date and time when the starting point is applied, in the
   configuration's time zone.
2. **Given** a starting time of day without a date, **When** the scenario runs, **Then** a
   documented default date is used, and its weekday is stated in the result.
3. **Given** a sequence of steps with time passing between them, **When** it runs, **Then** each
   step happens at its instance time, and an automation's delays and time triggers fire as they
   would in real time, without waiting that long.
4. **Given** an expectation that an entity must stay in a state for a span of time, **When** the
   entity changes during that span, **Then** the expectation fails and reports when, in instance
   time, and to what it changed.

---

### User Story 4 - Running a suite of scenarios in CI and for an agent (Priority: P2)

The configuration repository keeps all its scenarios in one place. One command runs them all,
against one or more releases, and ends with an exit status a CI job can use and a report a person
can read and an agent can parse.

**Why this priority**: Scenarios are worth most when they run on every change; and an agent that
edits automations needs a compact, structured result to act on. It needs User Story 1 first.

**Independent Test**: In a repository with several scenario files, one passing and one failing,
one command runs every scenario, exits with a failure status, and produces a report in which each
scenario and each failed expectation can be found without reading the instance's logs.

**Acceptance Scenarios**:

1. **Given** a repository with scenario files in its scenarios directory, **When** the person
   runs the command with no argument, **Then** every scenario is found and run, and the report
   lists them in a stable order.
2. **Given** a name or a file, **When** the person passes it, **Then** only the matching scenarios
   run.
3. **Given** a run in which every scenario passed, failed, or could not run, **When** it ends,
   **Then** the exit status distinguishes "all passed", "some failed" and "could not run", and
   the report gives the counts.
4. **Given** a request for the machine-readable report, **When** the run ends, **Then** the report
   follows a documented, versioned format, sized for an agent: only the failed expectations carry
   their details, and passed ones are counted.
5. **Given** a release channel or a list of them, **When** the run uses them, **Then** each
   scenario runs on each release, and the report says on which release each result was obtained.

---

### User Story 5 - Reusable starting points (Priority: P3)

Several scenarios share a starting point: a weekday morning with everyone home, an empty house at
night, a power outage. The repository defines each once, by name, and scenarios refer to it and
add or override what is specific to them.

**Why this priority**: It removes repetition once a repository has many scenarios; a single
scenario works without it.

**Independent Test**: Two scenarios that refer to the same named starting point both apply it,
one of them overriding one entity's state, and each sees its own value.

**Acceptance Scenarios**:

1. **Given** a named starting point and a scenario that refers to it, **When** the scenario runs,
   **Then** the named starting point is applied, then the scenario's own starting states on top.
2. **Given** a reference to a starting point that does not exist, or two that refer to each other,
   **When** the scenario is checked, **Then** it is refused before any instance starts, naming
   the reference.

---

### Edge Cases

- The configuration fails the instance's own validation: no scenario runs; the result says the
  configuration is invalid and gives the instance's errors, as the harness already does.
- The configuration references secrets whose plaintext is absent: the harness's placeholder rule
  applies (it uses a file the person names, or marked placeholders), and the result says which.
- A starting state is overwritten by the instance before the event happens (a template entity
  recomputes, an integration reports its own value): the scenario does not run, and the result
  names the entity, the state that was set and the state found, instead of reporting the
  expectations against a starting point that did not hold.
- An automation is disabled in the configuration, or its conditions are not met by the starting
  point: nothing fires, the expectations fail on their values, and the result can say that no
  automation triggered and which actions, if any, were called.
- An action of the automation fails in the instance (a bad template, or a missing action the
  scenario did not declare as absent): the expectations report their values; the result names a
  missing action; the instance's own record of the failure is available to the
  person through the existing tools, and the result says where to look.
- An expectation compares a number to an attribute that holds a string, or the other way round:
  the comparison follows a documented rule, and a mismatch reports both values as they are.
- The instance does not become ready, or stops during a scenario: that scenario "could not run",
  with the reason; the others still run.
- Two scenarios run in the same suite: each starts from the configuration's own starting state; a
  state, a running timer or a pending delay of one never leaks into the next.
- A scenario never ends because an expectation's wait or a sequence's steps are very long: every
  wait is bounded, and a scenario has a total time limit after which it fails with that reason.
- A scenario file holds several scenarios with the same name, or two files do: the suite is
  refused before running, naming both.
- The person runs the command with no container runtime: it stops before anything else, as the
  harness does.

## Requirements _(mandatory)_

### Functional Requirements

**Format**

- **FR-001**: A scenario MUST be written as a declarative document, in a human-editable text
  format, that names its format and version, so that a reader can tell which rules apply and an
  older reader can refuse a newer document instead of misreading it.
- **FR-002**: The format MUST be public in `@domusops/schema`, with its types, a machine-readable
  schema and documentation, as the other formats are, and MUST NOT depend on any paid package
  (constitution §5).
- **FR-003**: A scenario MUST have a name unique in its repository, an optional description, a
  starting point (`given`), what happens (`when`) and the expectations (`then`).
- **FR-004**: A scenario file MAY hold several scenarios; scenario files MUST be found in a
  documented scenarios directory of the configuration repository by default, and in any directory
  the person names.
- **FR-005**: Every scenario file MUST be checked against the format before any instance starts;
  a file that does not conform MUST be refused with the file, the place in it and the problem,
  and nothing runs.

**Starting point (`given`)**

- **FR-006**: The starting point MUST be able to state the instance's date and time, or a time of
  day alone, which uses a documented default date; times are read in the configuration's own time
  zone.
- **FR-007**: The starting point MUST be able to state the state, and attributes, of any entity.
  Before the event happens, every stated entity MUST show the stated state; if one does not, the
  scenario does not run and the result names the entity, the state set and the state found.
- **FR-008**: The starting point MUST be able to declare stand-ins: virtual devices of the kinds
  the reused virtual-device integrations offer, each with a chosen entity ID. A stand-in whose
  entity ID the configuration already provides, or of a kind not offered, MUST stop the scenario
  before it runs, with the reason. No virtual-device layer of DomusOps' own is built.
- **FR-008a**: The starting point MUST be able to declare absent actions, one by one or as a whole
  domain, for integrations that cannot run in the sandbox. A call to a declared absent action is
  recorded (FR-013b), changes no state and lets the automation continue. A call to a missing
  action that was not declared MUST fail as it does in Home Assistant. Declaring an action the
  instance does offer MUST stop the scenario before it runs, with the reason, so a test never
  silently replaces a real action.
- **FR-009**: The starting point MUST be able to refer to named starting points defined once in the
  repository; the named ones are applied first, in order, then the scenario's own statements,
  which take precedence. Unknown or circular references are refused when the files are checked.

**What happens (`when`)**

- **FR-010**: `when` MUST support at least: an entity changing state (with attributes), an action
  (service) being called, an event being fired, and the instance's time advancing, by a duration
  or to a moment.
- **FR-011**: `when` MUST accept either a single step or a sequence of steps, and expectations
  MUST be placeable between steps, each checked at that point of the sequence.
- **FR-012**: Advancing time MUST make time triggers, delays and waits of the configuration fire
  as they would in real time, without the run waiting that long.

**Expectations (`then`)**

- **FR-013**: An expectation MUST be able to check an entity's state and any of its attributes,
  with at least these comparisons: equal, not equal, one of a list, and, for numbers, at least,
  at most and between.
- **FR-013a**: An expectation MUST be able to check that an automation of the configuration
  triggered, or did not, during the scenario, optionally a stated number of times.
- **FR-013b**: An expectation MUST be able to check that an action (service) was called, or was
  not, during the scenario, optionally restricted to a target (entity IDs) and to data fields,
  compared with the rules of FR-013 and FR-017. The runner MUST record every action called in the
  instance from the moment the event happens, so that a failed expectation can list the calls that
  did happen.
- **FR-014**: An expectation MUST be able to state that an entity keeps a state, or an attribute
  keeps a value, for a span of instance time, and MUST fail with the time and the new value if it
  changes.
- **FR-015**: An expectation that something should become true MUST be checked until it holds or
  a bounded wait runs out; the default bound MUST be documented and MAY be set per scenario or per
  expectation.
- **FR-016**: An expectation on an entity that does not exist MUST fail with a reason distinct
  from a wrong value.
- **FR-017**: Comparisons between numbers and text MUST follow one documented rule, the same for
  states and attributes.

**Running**

- **FR-018**: Scenarios MUST run only in throwaway instances that the harness created, loaded with
  a copy of the configuration; the runner MUST accept no address or token of an existing instance
  and MUST NOT modify the source directory (the harness's FR-006 and FR-019 apply).
- **FR-019**: Every scenario MUST start from the configuration's own starting state; nothing a
  scenario changed, started or scheduled may affect another.
- **FR-020**: Each scenario MUST have a total time limit, documented and adjustable; a scenario
  that reaches it fails with that reason, and the run continues with the next.
- **FR-021**: Scenarios MUST be runnable from a library call and from a command; the command adds
  no logic of its own, as in the harness.
- **FR-021a**: The documentation MUST include an example CI workflow that runs a configuration
  repository's scenarios with the command and fails the job when a scenario fails or could not
  run; the project's CI MUST run that example against the reference configuration, so it never
  goes stale. No reusable CI action or workflow is published.
- **FR-022**: A run MUST be able to target one release or a list of releases, by channel (current
  stable, previous stable, current beta) or by number, as the harness does; each result names the
  concrete release it ran on.
- **FR-023**: A run MUST be able to select scenarios by name or by file.

**Results**

- **FR-024**: Each scenario MUST end with exactly one outcome: passed, failed, or could not run;
  "could not run" covers a starting point that did not hold, an invalid configuration, a missing
  runtime, an instance that did not start, an invalid stand-in and an invalid absent action. A
  scenario that targets current beta while no beta is in progress is reported as not run: it is
  not an outcome of the scenario and does not change the exit status.
- **FR-025**: Each expectation MUST report its outcome, its subject (an entity, an automation or
  an action), what it checked, the expected value and, when it failed, the actual value (for an
  action, the matching calls that were recorded) and the instance time it was read at.
- **FR-026**: The command MUST print a readable report and end with an exit status that tells
  "all passed", "some failed" and "could not run" apart.
- **FR-027**: A machine-readable report MUST be available in a documented, versioned format in
  `@domusops/schema`, sized for an agent's context: a passed expectation is counted, a failed one
  carries its details (constitution §4).
- **FR-028**: Reports, logs and errors MUST NOT contain the instance's token or a secret of the
  configuration.

**Continuity**

- **FR-029**: The harness's fixed smoke check MUST stay the release gate for the supported-versions
  table (005 FR-028); scenarios are an addition, not its replacement.
- **FR-030**: The project's CI MUST run a reference scenario suite on the reference configuration
  against current stable, previous stable and current beta (constitution §8). A scenario that
  fails or could not run on current stable or previous stable MUST fail a required check and
  block the merge (constitution §9); a failure on beta MUST be visible without blocking, as for
  the smoke check.
- **FR-031**: The harness's existing library and command MUST keep working as they do; existing
  callers need no change.
- **FR-032**: Every artifact of this feature MUST be in English (constitution §1); scenario
  examples in documentation and tests MUST use synthetic entities, never a real home's.

### Key Entities

- **Scenario**: a named, declarative test of a configuration: a starting point, what happens and
  the expectations. Belongs to a scenario file.
- **Scenario file**: a document in the repository's scenarios directory, in the versioned format,
  holding one or more scenarios, and optionally named starting points.
- **Starting point (`given`)**: the instance's date and time, entity states and attributes,
  stand-ins, absent actions, and references to named starting points.
- **Named starting point**: a starting point defined once and referred to by name.
- **Stand-in**: a virtual device of an offered kind that takes an entity ID the configuration's
  automations act on, because the real device's integration cannot run in the sandbox.
- **Absent action**: an action, or a whole domain of actions, declared as not offered by the
  sandbox; its calls are recorded instead of failing.
- **Step (`when`)**: one thing that happens: a state change, an action, an event, or time
  advancing. A sequence is an ordered list of steps with optional expectations between them.
- **Expectation (`then`)**: a check on an entity's state or attribute, on an automation having
  triggered, or on an action having been called: a comparison, an optional wait bound, or a span
  during which it must hold.
- **Recorded call**: an action called in the instance during the scenario, with its instance
  time, target and data; what action expectations are checked against.
- **Scenario result**: passed, failed or could not run (or not run, when its release is a beta
  that is not in progress), with the release, the instance time span, and its expectation results
  or the reason it could not run.
- **Expectation result**: passed or failed, the subject (entity, automation or action), the
  check, expected value, actual value and the instance time it was read at.
- **Run report**: every scenario result of a run, with counts per outcome, readable and
  machine-readable.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The SEED example scenario, written against a reference configuration with one
  stand-in, runs and passes in under 2 minutes from a cold start on a developer machine with the
  release image already present.
- **SC-002**: In every failing scenario of the test suite, the report alone lets a reader name
  the entity, the expected value and the actual value of each failure, without opening the
  instance's logs.
- **SC-003**: Every malformed scenario file in the test suite is refused before any instance
  starts, with its file and the place in it.
- **SC-004**: The same scenario run 20 times on the same release gives the same outcome every
  time.
- **SC-005**: A suite of 10 scenarios on one release completes in under 10 minutes on the
  project's CI runners.
- **SC-006**: A time-based scenario covering an hour of instance time completes in under 30
  seconds of real time once the instance is ready.
- **SC-007**: Across every run in the test suite, no report or log contains the instance's token
  or a secret of the configuration, and no run reaches an instance the harness did not create.
- **SC-008**: Every example scenario in the documentation is valid against the published schema,
  the reference scenario suite passes on current stable and previous stable in CI, and the
  documented example CI workflow runs green against the reference configuration.
- **SC-009**: The machine-readable report of a 10-scenario run with one failure is at least 5
  times smaller than the readable report of the same run.

## Assumptions

- The person running scenarios has a container runtime, as the harness requires; it remains the
  only hard dependency.
- Scenarios are written by people and by agents; a later skill may help write them, but it is not
  part of this feature, and running scenarios is not an MCP tool, since running a suite is a
  procedure, not a read (constitution §3).
- Expectations cover entity states and attributes, automations triggered and actions called.
  Recorded calls carry the action's data as called; secrets in them are subject to FR-028.
- Each scenario starts from the configuration's own starting state; whether that is achieved with
  one instance per scenario or by restoring an instance between scenarios is a planning decision,
  bounded by SC-004 and SC-005.
- The default date for a time of day alone is a fixed, documented weekday, so a scenario's result
  does not depend on the day it runs.
- The scenario format is a text format people already edit in configuration repositories; the
  exact syntax is a planning decision, constrained by FR-001 and FR-005.
- The scenarios directory lives in the configuration repository and is not part of what the
  instance reads; copying it into the instance is harmless.
- The supported virtual-device kinds are those of the harness (`switch`, `binary_sensor`,
  `sensor`, `light`, `lock`, `fan`, `cover`, `valve`, `device_tracker`); other entities can only be
  set as plain states, which an automation's actions cannot change.

### Out of scope

- `ha_diff` and `ha-migrate`; `ha-migrate` will use this feature to prove parity.
- Building or forking a virtual-device integration.
- Any run against a real instance, including read-only.
- An MCP tool that runs scenarios; a skill that writes them.
- A published, reusable CI action or workflow; users copy the documented example.
- Recording scenarios from a real home's history.
- Coverage measurement of automations by scenarios.
- Changes to the supported-versions table or to the meaning of the smoke check.
