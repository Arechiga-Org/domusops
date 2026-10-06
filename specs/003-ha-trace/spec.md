# Feature Specification: ha_trace — Compressed Automation and Script Traces

**Feature Branch**: `003-ha-trace`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: `docs/SEED.md` §6, backlog item 1 (second half): "`ha_trace` — the
same compression thesis applied to automation traces", with the §2.1 contract "Automation trace
retrieval, compacted." `ha_logbook_query` (the first half) is specified in
`specs/002-ha-logbook-query/`.

## Clarifications

### Session 2026-09-26

- Q: Are scripts in scope, or only automations? The instance records script runs the same way,
  and an automation often hands its work to a script. → A: Both. Automations and scripts are
  "traced items"; one tool covers both, so the agent can follow an automation into the scripts it
  starts (FR-003).
- Q: What does a call without `detail` return: full runs (`standard`) or the run list
  (`summary`)? → A: `standard`, as in `ha_snapshot` and `ha_logbook_query`. A focused call answers
  in one round trip; an unfocused call that exceeds the size limit fails with the `too_large`
  error, which suggests `summary` (FR-007, FR-020).
- Q: When the agent has a context identifier from `ha_logbook_query` (the cause of an event), can
  it ask `ha_trace` directly for the run with that context? → A: Yes. A context identifier, in the
  form `ha_logbook_query` shows it, is accepted as an alternative to a run identifier and returns
  every stored run that ran in that context (FR-006).
- Q: Does the size limit also apply to `summary` responses, which here list one line per run and
  grow with the number of stored runs? → A: Yes. The same limit applies to both detail levels; a
  `summary` above it fails with `too_large` and suggests selectors or a window (FR-020).
- Q: Is the size limit a setting of its own, or the one `ha_logbook_query` already uses? → A: Its
  own setting, with its own default fixed by measurement during planning. Changing one tool's
  limit never changes the other's, and `ha_logbook_query` is untouched (FR-020).
- Q: (Planning) A lossless `standard` measured 3.51x on the maintainer's 92 live traces (3.26x per
  item); 5x is not reached reliably even after dropping the configuration, `this`, and trigger
  attributes. Is `standard` kept lossless with a lower floor, or made lossy to approach 5x? → A:
  Lossless, with the floor fixed at 3 on the reference fixture (FR-019, SC-001).
- Q: (Planning) From 2026.7 the instance also stores traces of triggers that evaluated a change
  but did not fire. Are they in scope? → A: Yes. They are stored traces, marked with the outcome
  `not_triggered` and counted separately from runs; they answer why an automation did not run
  (FR-003).
- Q: (Planning) The compact context ID of `ha_logbook_query` is relative to the event's second, so
  the same context has different offsets in the two tools. When do two context identifiers match?
  → A: When their last 16 characters (the random part of the ID) are equal; the offset only
  locates the ID in time. The tool accepts either tool's form and the full ID (FR-006, FR-011).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Why did this automation do that (Priority: P1)

A Home Assistant user asks their coding agent why an automation behaved as it did: "why did the
hallway light turn on at full brightness?", "why did the alarm automation stop halfway?", "why
did the heating automation run but change nothing?". The agent invokes `ha_trace` for that
automation and receives its recorded runs, each step by step: what triggered the run, which
conditions passed or failed, which branches were taken, which actions ran with which data, how
long each step took, and where and why the run stopped. When the automation hands its work to a
script, the agent asks for that script's runs the same way. The trace is compressed so that
several runs fit in the agent's context.

**Why this priority**: This is the whole value of the feature. The logbook (`ha_logbook_query`)
shows what changed and which automation caused it; only the trace shows the automation's own
reasoning. Without it, diagnosing an automation means the user reading trace screens and
describing them by hand.

**Independent Test**: Run the tool against the reference trace fixture for one automation.
Confirm that every stored run appears, that every recorded step of each run appears in order with
its result, and that the reported compression ratio meets the floor.

**Acceptance Scenarios**:

1. **Given** a reachable instance, a valid token, and an automation with stored runs, **When** the
   agent invokes `ha_trace` for that automation, **Then** it receives every stored run of that
   automation, newest first, and a `compression_ratio`.
2. **Given** a run, **When** it is returned in full, **Then** it states what triggered it, and
   every step the run executed, in execution order, with the step's position in the automation,
   its time, and its result (a condition's outcome, a chosen branch, the action performed and the
   data it was given, a wait's outcome, an error).
3. **Given** a run that stopped early (a condition failed, an error occurred, it was stopped,
   cancelled, or timed out), **When** it is returned, **Then** its outcome and the step at which
   it stopped are stated explicitly, together with the reason the instance recorded.
4. **Given** a run, **When** it is returned in full, **Then** the configuration the run executed
   (and, for an automation created from a blueprint, the inputs given to the blueprint) is
   available in the same response, so each step's position can be read against the action it
   refers to.
5. **Given** a run, **When** it is returned, **Then** it carries an identifier that also appears
   as the cause of the events it produced in `ha_logbook_query`, so the agent can move between
   the two tools without guessing.
6. **Given** a run identifier taken from an earlier response, **When** the agent invokes the tool
   with it, **Then** exactly that run is returned.
7. **Given** a context identifier taken from the cause of an event in `ha_logbook_query`, **When**
   the agent invokes the tool with it, **Then** every stored run that ran in that context is
   returned, in one call.
8. **Given** a script with stored runs, **When** the agent invokes `ha_trace` for that script,
   **Then** its runs are returned exactly as an automation's are.
9. **Given** an automation run that started a script, **When** both runs are returned, **Then**
   the step that started the script names the script run, and the context identifiers the instance
   recorded for them match (FR-011).
10. **Given** an automation whose trigger evaluated a change but did not fire, on an instance that
    records such traces, **When** the agent invokes `ha_trace` for it, **Then** that trace is
    returned with the outcome `not_triggered` and the trigger's recorded reason, counted apart from
    runs.
11. **Given** the reference trace fixture, **When** a `standard` response is produced, **Then**
    `compression_ratio` is at least the floor set for this tool (FR-019).

---

### User Story 2 - Secrets never reach the agent (Priority: P1)

Traces are richer than logbook events: they carry the full states of the entities that triggered a
run, the variables the run computed, the data sent to every action (notification texts, request
payloads, URLs), error messages, and the configuration of the automation or script, which, when
written in YAML, can hold secret values already substituted in. All of that flows into the agent's
context. The user must be able to invoke the tool without any risk that credentials, coordinates, or
e-mail addresses leave their machine inside the output.

**Why this priority**: A leaked credential or home location is a severe, irreversible harm. This
story is release-blocking: User Story 1 cannot ship without it.

**Independent Test**: Run every detail level against a redaction fixture that plants a token in
an action's data, another inside a URL in the automation's configuration, coordinates in a
triggering entity's attributes, and an e-mail address in an error message. Search each output for
any fragment of the planted values.

**Acceptance Scenarios**:

1. **Given** a planted token in an action's data, a variable, an error message, or the
   configuration, **When** the tool is invoked at any detail level, **Then** the output contains
   no fragment of that token.
2. **Given** a secret embedded inside a larger value (for example, a URL query string), **When**
   the tool is invoked, **Then** the secret does not appear in the output.
3. **Given** latitude and longitude values or an e-mail address anywhere in a run, **When** the
   tool is invoked, **Then** those values do not appear in the output.
4. **Given** a value that was redacted, **When** the agent reads the output, **Then** the field is
   still present and explicitly marked as redacted.

---

### User Story 3 - Loud, actionable failure (Priority: P2)

When the tool cannot return what was asked, the user and the agent learn exactly why and what to
do next. The tool never returns a subset of the runs or steps that looks like the whole, and it
never lets the agent confuse "this automation did not run" with "this automation cannot be
traced" or "this automation does not exist".

**Why this priority**: The most common diagnostic question is "why did it not run?". An agent that
cannot tell an absent trace from an untraceable automation or a mistyped name reaches confident,
wrong conclusions.

**Independent Test**: Invoke the tool with each failure condition shared with the other tools, an
invalid selection, an unknown run identifier, an instance without trace support, and a query
whose result exceeds the size limit. Confirm each produces a distinct, actionable error and no
runs. Invoke it for an automation with no stored runs, one that cannot be traced, and a name that
matches nothing, and confirm each is reported distinctly.

**Acceptance Scenarios**:

1. **Given** any failure condition shared with `ha_snapshot` and `ha_logbook_query` (missing
   configuration, rejected token, unreachable host, unsupported version, non-administrator token,
   failed retrieval), **When** the tool is invoked, **Then** it returns the same error kind and
   guidance and no runs.
2. **Given** an invalid selector, an invalid time window, or an unrecognised `detail` value,
   **When** the tool is invoked, **Then** it returns an error stating the problem and the accepted
   form, and no runs.
3. **Given** a run identifier the instance no longer stores (or never stored), or a context
   identifier in which no stored run ran, **When** the tool is invoked with it, **Then** it returns
   an error saying no run was found, that the instance keeps only a limited number of recent runs,
   and, for a context identifier, that the cause may not be an automation or script, and no runs.
4. **Given** a selected automation or script that exists but has no stored runs, an automation the
   instance cannot trace (one without a unique identifier), and a selector that matches no
   automation or script, **When** the tool is invoked, **Then** the response lists each one
   separately with its reason, so the agent can tell them apart.
5. **Given** a query whose complete result, at either detail level, would exceed the size limit,
   **When** the tool is invoked, **Then** it returns an error that states the number of selected
   runs, the size limit, and how to narrow the query (for `standard`: use `summary`, a run or
   context identifier, fewer traced items, or a shorter window; for `summary`: fewer traced items
   or a shorter window), and no runs.

---

### User Story 4 - Find the right run first (Priority: P2)

Before reading a run step by step, the agent needs to find the run that matters: the one around 3
a.m., the one that ended in an error, the one the logbook points to. `detail=summary` lists runs as
one line each: which automation or script, when it started and ended, what triggered it, and how it
ended. The agent then asks for the one run it needs in full.

**Why this priority**: It keeps exploratory questions cheap and makes the oversized-result case
(User Story 3) recoverable. User Story 1 already delivers the core value when the agent knows
which automation or script to look at.

**Independent Test**: Invoke the tool against the reference fixture with each detail value, with
and without a selection, and with an invalid value. Confirm the shape of each response and the
rejection of the invalid value.

**Acceptance Scenarios**:

1. **Given** `detail` set to `summary`, **When** the tool is invoked, **Then** each selected run
   appears once, with its traced item, run identifier, start and end time, what triggered it, its
   outcome, and the step it stopped at, and no steps, variables, or configuration.
2. **Given** no selectors, **When** the tool is invoked, **Then** the runs of every automation and
   script are considered.
3. **Given** a time window, **When** the tool is invoked, **Then** only the runs that started
   within it are returned.
4. **Given** `detail` is omitted, **When** the tool is invoked, **Then** the response is at the
   `standard` response, as in the other two tools. If that response would exceed the size limit,
   the `too_large` error of User Story 3, scenario 5 applies, and it suggests `summary`.

---

### Edge Cases

- **An automation or script that never ran**, or whose runs were all replaced by newer ones, has no
  stored runs; it is listed as such (User Story 3, scenario 4), not as an error.
- **An automation that cannot be traced** (the instance only records runs for automations with a
  unique identifier) is listed as untraceable, with that reason. Scripts are always traceable.
- **A script started by an automation** has its own runs; they are returned when the script is
  selected, not embedded in the automation's run. The automation's step that started it shows the
  call, and the context identifiers link the two (User Story 1, scenario 9).
- **Instances before 2026.7** record no not-triggered traces. There, a missing run does not show
  that the trigger was never evaluated; the tool's description says from which version they exist.
- **A run still in progress** (for example, waiting in a delay) is returned as it stands, marked as
  running, with the steps recorded so far. This is a complete answer about an unfinished run, not
  a partial answer.
- **Runs of an automation or script that has since been removed or renamed** are returned if the
  instance still stores them, identified as the instance recorded them.
- **A run that repeats steps** (for example, `repeat` loops) keeps every
  iteration in order; repeated steps are not merged.
- **A run whose configuration was changed after it ran** is shown with the configuration it
  executed, not the current one.
- **Several runs that executed the same configuration** state it once in the response.
- **The instance keeps a limited number of runs per traced item** (a setting of the instance). The
  tool's description says so; the tool does not read or change that setting.
- **Runs lost by the instance** (for example, on an unclean shutdown) cannot be returned; the
  tool's description says that stored runs are not a complete history, and points to
  `ha_logbook_query` for what happened.
- **Duplicate or overlapping selectors** select each traced item once.
- **A context identifier shared by several runs** (for example, an automation run and a script run
  it started, when the instance records them in one context) returns all of them, newest first.
- **Selectors are lowercase**, like entity IDs; a selector with an uppercase letter is invalid.
- **Non-ASCII names, states, messages, and configuration** are preserved exactly.
- **A query that selects no runs** (for example, none in the window) gives an empty, valid
  response with a well-defined `compression_ratio`, not an error.
- **A timestamp without a time-zone offset** is interpreted in the instance's time zone, as in
  `ha_logbook_query`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST expose a tool named `ha_trace` (read-only; see FR-017) in the same
  MCP server as `ha_snapshot` and `ha_logbook_query`, which MUST continue to be advertised
  unchanged.
- **FR-002**: The tool MUST use the same instance configuration, authentication, and token handling
  as `ha_snapshot`: one instance, a long-lived access token read from the environment, never
  accepted as a tool parameter, never present in any output, log line, or error message.
- **FR-003**: The tool MUST retrieve the runs the instance has stored for the selected traced
  items, with every recorded detail of each run. Traced items are automations and scripts; both
  MUST be supported, and their runs MUST be presented in the same form. Stored runs include the
  instance's not-triggered traces (a trigger evaluated a change but did not fire), which MUST be
  marked as such and counted separately. Only runs the instance stores are in scope.
- **FR-004**: The tool MUST accept an optional set of selectors identifying traced items by entity
  ID (`automation.*` or `script.*`) or by `*` pattern, with the same form and limits as
  `ha_logbook_query` selectors. When the set is omitted, every automation and script MUST be
  considered. Each selector MUST be reported in the response when it matched no traced item, and
  each matched item MUST be reported when it has no stored runs, has stored runs but none in the
  window, or cannot be traced, with the reason (User Story 3, scenario 4).
- **FR-005**: The tool MUST accept an optional time window (start and end, as ISO 8601 timestamps,
  with the same form and rules as `ha_logbook_query`) and return only the runs that started within
  it. The window applies only when `start` or `end` is given; the missing side defaults as in
  `ha_logbook_query`. When the window is omitted, every stored run of the selected traced items
  MUST be returned.
- **FR-006**: The tool MUST accept either an optional run identifier, as it appears in the tool's
  own responses, or an optional context identifier, in the form `ha_logbook_query` uses for
  causes. With a run identifier, exactly that run MUST be returned; with a context identifier,
  every stored run that ran in that context MUST be returned. Either MUST produce an error if no
  stored run matches. Each may be combined with `detail` only; combining one with the other, with
  selectors, or with a window MUST be rejected as an invalid selection.
- **FR-007**: The tool MUST accept an optional `detail` parameter with the values `summary` and
  `standard`. When omitted, the value MUST be `standard`. Any other value MUST be rejected with an
  error listing the accepted values.
- **FR-008**: At `summary` detail, each selected run MUST appear once with its traced item, run
  identifier, start time, end time (as a duration from the start, or that it is still running),
  trigger description, outcome,
  the step at which it stopped, and its error message if any; and no steps, variables, or
  configuration.
- **FR-009**: At `standard` detail, each selected run MUST additionally contain every recorded step
  in execution order, with the step's position in the traced item, its time precise enough to
  measure each step's duration to the millisecond, its result, the variables it changed, and any
  error; and the configuration and blueprint inputs the run executed. It MUST be lossless relative
  to the retrieved runs: any field it does not repeat per run or per step MUST be recoverable from
  the same response.
- **FR-010**: At `standard` detail, repeated values (entity states repeated across steps and runs,
  configurations shared by several runs, step positions, and repeated text) MUST be stated once and
  referenced, not repeated.
- **FR-011**: Every run MUST carry the identifier of the context it ran in, in the same form
  `ha_logbook_query` uses for causes, and the identifier of the context that started it when the
  instance records one, so that the logbook events a run produced, and the automation run that
  started a script run, can be matched to it. Two context identifiers match when their last 16
  characters are equal; the tool's description MUST state this.
- **FR-012**: Every successful response MUST state the instance's time zone and the selection it
  answers (selectors, window, run or context identifier, detail), so that every time can be read as
  the instance's local time.
- **FR-013**: Every successful response MUST include a `compression_ratio` field, defined exactly
  as for `ha_snapshot`: the serialised size of the raw retrieved payload divided by the serialised
  size of the emitted payload.
- **FR-014**: The system MUST apply the redaction rules of `ha_snapshot` and `ha_logbook_query` to
  every field of every run, including variables, action data, error messages, the configuration,
  and blueprint inputs: secrets detected by field name and by value content (including secrets
  embedded in larger values), geographic coordinates, and e-mail addresses. Redaction MUST happen
  before serialisation, and every redacted value MUST be replaced by the same explicit redaction
  marker, with the field kept.
- **FR-015**: Identifiers (entity IDs, device IDs, config entry IDs, user IDs, traced item and run
  identifiers, and context identifiers) MUST NOT be redacted.
- **FR-016**: The tool MUST fail with a distinct, actionable error, and return no runs, for every
  failure condition shared with `ha_snapshot` (missing configuration, rejected token, unreachable
  or unresponsive host, unsupported version, non-administrator token, failed retrieval), using the
  same error kinds; and additionally when a selector, the window, `detail`, or the combination of
  parameters is invalid, when no stored run matches a requested run or context identifier, and
  when the instance does not provide traces.
- **FR-017**: The tool MUST NOT change the instance's state or configuration under any parameter
  combination. In particular, it MUST NOT trigger, enable, disable, or reload any automation or
  script, and MUST NOT change how many runs the instance keeps.
- **FR-018**: The tool MUST NOT return a subset of the selected runs, or a subset of a run's steps,
  presented as complete. A response either contains every selected run with every recorded step,
  or is an error. A run in progress is returned with the steps recorded so far and marked as
  running.
- **FR-019**: The project MUST maintain a representative reference trace fixture, and automated
  checks MUST fail if the `standard` compression ratio on that fixture falls below a floor. The
  floor is 3, fixed during planning from measurement (Clarifications). The tool's description
  MUST state its expected compression ratio (constitution §4).
- **FR-020**: When the complete result, at either detail level, would exceed the size limit, the
  tool MUST fail with a distinct error that states the number of selected runs, the limit, and how
  to narrow the query, and MUST return no runs. The limit applies to the emitted (compressed)
  response, and to `summary` and `standard` responses alike. It has a default, fixed during
  planning and stated in the tool's description, which the user MAY override in the server
  configuration through a setting of this tool's own, separate from the `ha_logbook_query` limit.
  The limit MUST NOT be accepted as a tool parameter.
- **FR-021**: The trace response format MUST be a versioned, publicly documented contract in the
  public schema package, and every response MUST declare the format version it conforms to.

### Key Entities _(include if feature involves data)_

- **Traced item**: An automation or a script on the instance, identified by its entity ID, with a
  limited number of stored runs. An automation without a unique identifier is untraceable.
- **Run**: One execution of a traced item. Has an identifier, a start and end time (or running),
  a trigger description, an outcome (finished, stopped by a failed condition, stopped, cancelled,
  timed out, error, still running, or not triggered for a not-triggered trace), the step it stopped at, a context identifier, the
  configuration it executed, and an ordered list of steps.
- **Step**: One recorded point in a run: its position in the traced item's configuration, its
  time, its result, the variables it changed, and any error. A position can appear several times
  in a run (loops).
- **Configuration**: The traced item's definition as the run executed it, with its blueprint
  inputs if it came from a blueprint. Several runs can share one.
- **Trace response**: The result of one `ha_trace` invocation. Has a detail level, a format
  version, the selection it answers, the time zone, a `compression_ratio`, the runs at that detail
  level, and the selectors and traced items that produced no runs, with reasons.
- **Redaction marker**: The same explicit placeholder the other two tools use.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the reference trace fixture, the `standard` response is at least as many times
  smaller than the raw data as the floor fixed in planning: at least 3 times.
- **SC-002**: 100% of the runs and steps the instance returns for a query appear in the `standard`
  response, with the same results, runs newest first and steps in execution order, and the
  instance's records can be rebuilt from it exactly, verified by an automated round-trip check.
- **SC-003**: Zero fragments of any planted secret, coordinate, or e-mail address appear in the
  output of any detail level across the redaction fixture set.
- **SC-004**: A `summary` of 500 stored runs over 100 traced items, and a
  `standard` response for one traced item's stored runs, each complete in under five seconds.
- **SC-005**: Each failure condition in FR-016 and FR-020 produces an error that names its cause
  and a next step, and zero of them return runs.
- **SC-006**: Invoking the tool with every combination of parameters causes zero changes to the
  instance's state or configuration.
- **SC-007**: For 100% of the runs in the reference fixture, the run's context identifier matches
  the cause of the logbook events it produced, as `ha_logbook_query` reports them (same last 16
  characters), and every script run started by an automation in the fixture is named by the step
  that started it.
- **SC-008**: Against the maintainer's live instance, a `summary` of every stored run and a
  `standard` response for one automation complete, and the resulting compression ratios are
  recorded.

## Assumptions

- Configuration, authentication, the minimum supported version, and the administrator requirement
  are exactly those of `ha_snapshot` and `ha_logbook_query`. A non-administrator token is a handled
  failure, not a supported mode. The instance itself restricts trace retrieval to administrators
  (verified during planning).
- The instance keeps a limited number of recent runs per traced item (a user setting of the
  instance) and only records runs for automations that have a unique identifier. The stored runs
  survive a normal restart but are not a complete history; `ha_logbook_query` is the history.
- A stored run holds everything this tool returns, including the configuration it executed; no
  other source is consulted. The logbook events a run produced are not embedded in the trace
  response; FR-011 links them.
- The instance records, on the step that started a script, the script run it started, and runs a
  script started directly by an automation in the automation's context (both verified during
  planning).
- `summary` and `standard` are the only detail levels. `standard` already keeps every field
  (FR-009), so a `full` level would add nothing.
- The five-second target assumes the instance is on the local network and not under abnormal load.
- `compression_ratio` compares byte lengths of UTF-8 serialisations, as in the other tools.
- "No fragment of a planted value" means, as in the other tools, no contiguous fragment of six or
  more characters.
- The live-instance check (SC-008) is performed manually by the maintainer; automated checks run
  against fixtures and a fake instance only.
- Redaction scope matches the other two tools exactly (credentials, coordinates, e-mail addresses).
  Hardware identifiers such as MAC addresses, and street addresses, are not redacted, consistent
  with those features.

### Out of Scope

Triggering, enabling, disabling, reloading, or editing automations or scripts; changing how many
runs the instance keeps; the logbook events a run produced (returned by `ha_logbook_query`, linked
by FR-011); evaluating or testing templates; traces of anything other than automations and scripts;
truncated or paginated results; live streaming of new runs; diffing, service calls, the sandbox, and
anything in `domusops-pro`.
