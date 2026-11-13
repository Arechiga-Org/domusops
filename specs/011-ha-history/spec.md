# Feature Specification: ha_history — Following How an Entity Changed Over Time

**Feature Branch**: `011-ha-history`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: the third tool of the `@domusops/mcp` 0.2.0 phase, the read tools
that keep an agent from falling back to the raw instance API (`ha_ping`, 009, and `ha_state`, 010,
are merged; `ha_system_log`, 012, follows; all four are released together as one minor release).
`ha_history` returns the recorded state changes of selected entities over a time window, with the
attributes of each change, so an agent can answer "when did this attribute change, and to what"
(a camera's motion attribute, a phone's battery level and location, the exact time a light's
color changed) without falling back to the raw API. It complements the two tools next to it:
`ha_logbook_query` gives human-readable events with their causes but no attributes, and
`ha_state` gives only the current state; `ha_history` is the attribute timeline.

## Clarifications

### Session 2026-11-11

- Q: Is `entities` required, or may a call read the history of every entity of the home? → A:
  Optional, as in the other tools. Without it, every entity the instance has at the time of the
  call is selected; the size limit refuses a `standard` result that does not fit, and the
  `summary` of the whole home shows which entities were busy (FR-002, FR-013).
- Q: What are the default and the maximum window? → A: The default is the 24 hours before `end`,
  as in `ha_logbook_query`; the maximum is 10 days, the instance's default history retention, and
  a longer window is a validation error before the history is read (FR-004).
- Q: Does each change carry every attribute by default, or only the attributes a caller lists? →
  A: Every attribute by default, as in `ha_state`; `attributes` keeps only the ones named, and
  unchanged attributes are not repeated from one change to the next (FR-006, FR-017).
- The feature request's other two open questions have defaults recorded in the Assumptions: the
  state at the start of the window is included, and every change is listed unless
  `significant_only` is given (FR-005).

### Session 2026-11-12

- Q: Is an entity that did not change in the window included with the state it had at the start
  of the window, or left out? → A: Included with its starting state only when it was named by
  exact ID in `entities`; an entity selected by a pattern, or by omitting `entities`, appears
  only if it changed in the window (FR-005, FR-012).
- Q: Without `entities`, may the `summary` be refused for its size, or is it always answered? →
  A: Always answered: the summary gives totals per domain, and rows per entity only when the call
  has `entities`; without `entities` it is never refused and stays small (FR-013).
- Q: With `attributes`, is a change still listed when neither its state nor any listed attribute
  changed? → A: No. With `attributes`, a change is listed only when its state or a listed
  attribute changed; the others are left out, and the document gives how many were left out
  (FR-006).
- Q: Are change times given to the second, as in the other documents, or to the millisecond? → A:
  To the second, as in the logbook, trace and state documents; changes within the same second
  keep their recorded order (FR-007, FR-008).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Following an entity's changes through a window (Priority: P1)

An agent is diagnosing something that already happened: when a sensor's battery started to
drop, when a camera last reported motion, at what time a light's color changed. It names the
entities, by exact ID or by pattern, and a time window, and gets, in one call, every recorded
change of each entity in that window with its state, its attributes and its change times, in
order.

**Why this priority**: This is the gap the tool exists to close. The logbook says that something
changed but not the attributes, and the live view says only what is true now; without this tool
the agent leaves for the raw API.

**Independent Test**: Against a simulated instance with a known recorded history, one call naming
a few entities and a window returns exactly the changes of those entities in that window, with
their states, attributes and times, and reads nothing else about the home.

**Acceptance Scenarios**:

1. **Given** a light whose brightness and color changed several times in the last hour, **When**
   the agent asks for that light over that hour, **Then** the response lists every recorded
   change in time order, each with its state, its attributes and its change times.
2. **Given** an entity whose attributes changed while its state stayed the same (a phone's
   battery level while it stays `home`), **When** the agent reads its history, **Then** those
   attribute-only changes are listed too.
3. **Given** the same window entirely in the past, **When** the agent makes the same call twice,
   **Then** both responses are identical.
4. **Given** attributes that hold a secret, an e-mail address or coordinates, **When** the agent
   reads those entities' history, **Then** every such value is replaced by the redaction marker in
   every change, as in the other tools, and the attribute is still listed.
5. **Given** an instance whose time zone is not UTC, **When** the agent passes a window without
   an offset, **Then** it is read in the instance's time zone, and every time in the response is
   in that zone, as in the logbook, trace and state documents.
6. **Given** a change the agent wants the cause of, **When** it reads the history, **Then** the
   response carries no context, since the instance's history records none, and the README says
   to read `ha_logbook_query` over the same window for causes (FR-010).

---

### User Story 2 - Keeping a long or broad history within bounds (Priority: P1)

History is the largest data the server can return: a sensor that reports every few seconds
records thousands of changes a day. The agent narrows by entity, pattern, exclusion, attribute
list and window, and when the answer would still be too big for its context, it is refused, told
how many entities and changes matched, and told how to narrow the query.

**Why this priority**: Without bounds the tool is unusable on a real home, and the size bound is a
constitutional contract (§4); compressing the repetition between consecutive changes is what makes
a useful window fit.

**Independent Test**: On a simulated instance with a noisy sensor and a quiet one, each filter,
alone and combined, returns exactly the expected changes, unchanged attributes are not repeated
from one change to the next, and a query over the limit is refused with the counts and a hint.

**Acceptance Scenarios**:

1. **Given** `entities` and `exclude`, **When** both are given, **Then** `exclude` is applied
   after `entities`, with the same patterns and rules as `ha_logbook_query`, `ha_trace` and
   `ha_state`, and a note after the document lists what was excluded.
2. **Given** an `attributes` list, **When** the agent passes it, **Then** each change carries
   only those attributes, a change in which neither the state nor a listed attribute changed is
   left out, and the document gives how many changes were left out per entity.
3. **Given** a query that matches more changes than fit in the limit, **When** the agent calls
   the tool, **Then** it gets an error result, as from the other tools, that gives the number of
   entities and changes matched and says how to narrow the query (a shorter window, fewer
   entities, `exclude`, `attributes`, `detail=summary`) or raise the limit, and no partial list.
4. **Given** an entity named by exact ID that did not change in the window, **When** the agent
   asks for it, **Then** the response gives the state it had at the start of the window and no
   changes; an entity selected only by a pattern that did not change is left out.
5. **Given** an exact entity ID with no recorded history, or that does not exist, **When** the
   agent asks for it, **Then** the response is not an error: a note names the IDs without
   history.
6. **Given** a window larger than the maximum, or a start after its end, **When** the agent calls
   the tool, **Then** it gets a validation error that states the rule, before the history is read.

---

### User Story 3 - Seeing which entities were busy before reading their history (Priority: P2)

Before reading a window in detail, the agent wants to know which of the selected entities
changed and how often, to pick the ones worth reading or to see why a query is too large. One
small call answers it.

**Why this priority**: It turns a refused query into a narrower one in a single step. The detailed
read of stories 1 and 2 is the core.

**Independent Test**: On a simulated instance, the summary gives the counts per domain and, when
entities are named, per entity that changed; the counts match the recorded history, and without
`entities` the result stays under 4,000 bytes.

**Acceptance Scenarios**:

1. **Given** a window and a set of entities, **When** the agent asks for the summary, **Then** the
   response lists, per entity that changed, how many changes were recorded, how many of them
   changed the state and how many changed only attributes, plus the same counts per domain and
   the totals, and carries no attributes.
2. **Given** the same filters as in story 2, **When** they are combined with the summary,
   **Then** the counts cover only the selected entities.
3. **Given** no `entities`, **When** the agent asks for the summary of a window, **Then** it gives
   the counts per domain for the whole home, with no rows per entity, and is never refused;
   the agent then names a busy domain with a pattern to see its entities.

---

### Edge Cases

- A selector is empty, too long, too many or has characters that cannot be in an entity ID: the
  same validation error, with the same wording, as in the other tools.
- `start` or `end` is malformed, `start` is after `end`, or `end` is in the future: the same
  handling as `ha_logbook_query` (a validation error, and a future `end` clamped to now).
- The window is longer than 10 days: a validation error that states the maximum, before the history
  is read. An instance that keeps more history is read in windows of at most 10 days.
- No `entities` on a large home: the `standard` result is usually refused by the size limit, with
  the counts and the hint to use `detail=summary` or name entities.
- `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` is missing or malformed, the instance is unreachable,
  the token is refused, the instance times out, or its version is below the supported minimum:
  the same error results as in the other tools.
- The history integration is not loaded: an error result that says so and what to change, as
  `ha_logbook_query` does for the logbook integration.
- A pattern is expanded against the entities the instance has now: an entity removed since the
  window is not matched by a pattern, but its exact ID still reads its recorded history.
- The window reaches back beyond what the instance keeps: the response holds what is recorded,
  and nothing says more existed; the README states that the instance's retention bounds history.
- An entity changes so often that one entity alone exceeds the limit: refused like any other
  oversize result, with the hint to shorten the window or list attributes.
- An entity's state is `unavailable` or `unknown` in the window: reported as a change like any
  other.
- A change carries no attributes, or very long or nested attribute values: reported completely,
  apart from redaction.
- Attribute keys that look like credentials or coordinates, at any depth, are redacted in every
  change, whatever the entity.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The server MUST offer a tool named `ha_history` that returns the recorded state
  changes of the instance's entities over a time window.
- **FR-002**: The tool MUST accept `entities`, a list of exact entity IDs and `*` patterns, with
  the same grammar, limits, validation errors and matcher as `ha_logbook_query`, `ha_trace` and
  `ha_state`. Patterns are expanded against the entities the instance has at the time of the
  call; exact IDs are used as given. `entities` is optional: without it, every entity the
  instance has at the time of the call is selected (an entity removed since then is not), and the
  size limit of FR-011 bounds the result.
- **FR-003**: The tool MUST accept `exclude`, in the same form, applied after `entities`, and MUST
  list in a note what it excluded, as the other tools do.
- **FR-004**: The tool MUST accept `start` and `end`, parsed exactly as `ha_logbook_query` parses
  them (a time without an offset is read in the instance's time zone, a future `end` is clamped
  to now). `end` defaults to now and `start` to 24 hours before `end`. A window longer than 10
  days, the instance's default history retention, MUST be refused with a validation error that
  states the maximum, before the history is read.
- **FR-005**: For each selected entity, the response MUST carry, in time order, every recorded
  change in the window: its state, its attributes (after FR-009) and its change times
  (`last_changed`, `last_updated`). By default every change is listed, including those that changed
  only attributes; an optional `significant_only` input keeps only the changes the instance
  considers significant. The state each listed entity had at the start of the window MUST be given
  as its first entry, so that the first change in the window has a known starting point; which
  entities are listed is set by FR-012. The instance does not give the start state's own change
  times; its `last_changed` is given when a later entry reveals it, and is otherwise unknown.
- **FR-006**: Each change MUST carry every attribute by default, as in `ha_state`. An optional
  `attributes` input, a list of attribute names, keeps only those; a named attribute an entity
  does not have is simply absent. With `attributes`, a change MUST be listed only when its state
  or one of the listed attributes differs from the entity's previous listed entry; the other
  changes are left out, and the document MUST give, per entity, how many were left out. The
  starting state of FR-005 is always listed.
- **FR-007**: Entities MUST appear in entity-ID order and changes in time order, so that two calls
  over the same past window give byte-identical responses.
- **FR-008**: Every timestamp MUST be in the instance's local time zone, to the second, in the
  form the logbook, trace and state documents use. Changes of one entity within the same second
  keep the order the instance recorded them in.
- **FR-009**: Secrets, credentials, tokens (including the configured one), e-mail addresses,
  coordinates (the instance's own and any in an attribute) and URL credentials MUST be redacted
  in every change, under the same rules `ha_snapshot` and `ha_state` apply to attribute values,
  and the redacted field MUST still be listed. Names of people and users stay visible, as in
  `ha_state` (its FR-011).
- **FR-010**: The instance's history records no context for a change (measured on the supported
  releases, research R1), so the response MUST carry none and the tool MUST read no other source for
  it; the README says how to find a change's cause with `ha_logbook_query` over the same window.
  Should a future release add context to the history, carrying it is a new format version.
- **FR-011**: The response MUST be bounded: a result larger than a documented limit, with the same
  default as the other tools (100,000 bytes) and an environment variable of its own to raise it,
  MUST be refused with an error result, never returned in part, and the message MUST say how many
  entities and changes matched and how to narrow the query or raise the limit.
- **FR-012**: An entity selected by a pattern, or by omitting `entities`, that did not change in the
  window MUST be left out. An entity named by exact ID that did not change MUST appear with its
  starting state and no changes. An exact ID with no recorded history, or with no entity, MUST NOT
  be an error: a note names those IDs, at most 10, with the count of the rest. A query that selects
  nothing MUST return a valid empty document and a note.
- **FR-013**: The tool MUST accept `detail`, with `summary` and `standard` (the default, FR-005).
  The summary carries no attributes. It always gives, per domain, the number of entities that
  changed, of changes, of state changes and of attribute-only changes, plus the totals. When the
  call has `entities`, it also gives the same counts per selected entity that changed. Without
  `entities` the summary MUST NOT be refused and MUST stay under 4,000 bytes whatever the size of
  the home; with `entities`, its rows per entity are subject to the limit of FR-011, and a refusal
  suggests the summary without `entities`. `attributes` is not combinable with `summary`.
- **FR-014**: The tool MUST check that the history integration is loaded and, when it is not,
  return an error result that names it and says what to change, as `ha_logbook_query` does for
  the logbook integration.
- **FR-015**: The tool MUST read only the current user (to check for an administrator, as the other
  tools do), the instance's core configuration (time zone, loaded integrations and the instance's
  own coordinates), the current entity IDs when a pattern needs expanding or `entities` is absent,
  and the recorded history of the selected entities in the window. The history read is a new
  read-only command on the server's allowlist, justified in the plan with its exact parameters; any
  other new command MUST also be a read and be justified. It MUST NOT read registries, the logbook,
  traces or the system log, and MUST make one connection per call.
- **FR-016**: The tool MUST NOT change anything on the instance, and MUST declare itself
  read-only and idempotent to the client.
- **FR-017**: The response MUST be a compact JSON document in a new published, versioned format
  in `@domusops/schema`, with its types, its JSON Schema, a reference decoder that restores every
  change with its full attributes (apart from redaction, and times to the second), and a row in
  the package README. Attributes unchanged from one change to the next of the same entity MUST
  NOT be repeated, and repeated shapes MUST NOT be repeated per change.
- **FR-018**: The response MUST carry a `compression_ratio`, measured as for the other tools
  against the raw instance answers it read, and CI MUST assert a floor for the `standard` detail
  on the reference instance (constitution §4).
- **FR-019**: The tool's entry in the `ha_ping` requirements table MUST state that it needs an
  administrator and the history integration, so `ha_ping` reports its readiness without a new
  format version (feature 009, FR-019).
- **FR-020**: The tool MUST work against the current stable, previous stable and current beta
  releases, proven by the sandbox in CI (constitution §8).
- **FR-021**: The outputs of `ha_snapshot`, `ha_logbook_query`, `ha_trace`, `ha_state` and
  `ha_ping` MUST NOT change for the same inputs, and every existing output test MUST pass with
  unchanged expectations. The one exception is FR-019: `ha_ping` lists `ha_history` among its
  tools, and the `ha_ping` tests that list every tool gain that entry.
- **FR-022**: The feature MUST carry a minor changeset for `@domusops/mcp` and one for
  `@domusops/schema`.
- **FR-023**: Tests MUST use simulated instances or the sandbox, never a real instance, and no
  specification, fixture or test may contain data taken from a real home.

### Key Entities

- **Change**: one recorded state of an entity in the window: its state, its attributes after
  redaction and its change times.
- **Entity history**: the starting state and the changes of one entity in the window, in time
  order; for an entity named by exact ID that did not change, the starting state alone.
- **Listed entity**: a selected entity that appears in the `standard` result: one that changed in
  the window, or one named by exact ID that has a start state (FR-012). The plan calls the
  selected entities before the history is read "candidates".
- **History overview**: the `summary` result: per domain, and per entity when `entities` is
  given, the number of changes, of state changes and of attribute-only changes, and the totals.
- **History document**: the result of the tool in the new published format, with its notes and
  its compression ratio.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a simulated instance, a call for named entities and a window returns every
  recorded change of those entities in the window, with states, attributes and times, in a single
  call; 100% of the recorded changes in the window are returned.
- **SC-002**: On the reference instance, a `standard` result for a noisy entity over a day is at
  least as many times smaller than the raw history as the floor the plan sets (asserted in CI),
  and the same result decodes back to every change with its full attributes, apart from
  redaction.
- **SC-003**: A query that exceeds the limit never returns changes: 100% of such queries are
  refused, with the number of entities and changes matched and a hint that names the inputs that
  narrow it.
- **SC-004**: On a synthetic fixture that seeds every redaction rule into attributes across many
  changes, 100% of the seeded secrets, e-mail addresses and coordinates are absent from the
  response.
- **SC-005**: Two calls over the same past window give byte-identical responses.
- **SC-006**: On the stable, previous stable and beta releases of the sandbox CI matrix, the same
  query returns the same changes and findings.
- **SC-007**: Every existing output test of the other tools passes with zero edited expectations,
  apart from the new `ha_history` entry in `ha_ping`'s tool list (FR-019), and every compression
  floor is unchanged.

## Assumptions

- `ha_history` is the third of the four 0.2.0 tools and ships with them in one minor release; the
  Version Packages pull request, already open, stays unmerged until 012 merges (roadmap of
  2026-11-04, phase 2).
- The history is read over the same WebSocket connection as every other read, not over the REST
  API, as the roadmap decided.
- Every existing tool requires an administrator token, so `ha_history` does too.
- The state each entity had at the start of the window is included (FR-005): without it, the
  first change in the window has no starting point and the delta encoding has no base. This
  answers the feature request's open question 3.
- By default every change is listed, including attribute-only ones (FR-005): the tool exists for
  attribute timelines, and the instance's notion of significance drops most attribute-only
  changes. `significant_only` is opt-in. This answers the feature request's open question 4.
- The instance's recorded history carries no context for a change (research R1); causes come from
  `ha_logbook_query` (FR-010).
- The patterns of FR-002 follow the matcher the other tools share: anchored, case-sensitive, `*`
  matching any run of characters.
- The 10-day maximum window matches the instance's default history retention; a home that keeps
  more reads it in several windows.
- The default limit equals the one of the other tools (100,000 bytes); the plan names the
  environment variable that raises it.
- Constitution §4 applies without exemption: the tool carries `compression_ratio` and a floor in
  CI; the plan sets the floor from the reference instance.
- The redaction rules are the ones `ha_snapshot` and `ha_state` already apply to attribute values;
  this feature adds no new rule.

### Out of scope

- `ha_system_log` (feature 012).
- Long-term statistics (hourly or daily aggregates of sensors).
- Changes to `ha_logbook_query` (its timeline detail level, user names in causes).
- Registries, devices, integrations, config entries and areas (`ha_snapshot`).
- Subscribing to changes or watching live (`ha_watch`) and templates (`ha_template`).
- Any tool that changes the instance.
