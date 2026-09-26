# Feature Specification: ha_logbook_query — Compressed Activity History

**Feature Branch**: `002-ha-logbook-query`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: `docs/SEED.md` §6, backlog item 1 (first half): "`ha_logbook_query` —
the same compression thesis applied to history", with the §2.1 contract "Filtered, compacted history
over a time window and entity set." `ha_trace` is a separate, later feature.

## Clarifications

### Session 2026-09-26

- Q: Does "history" cover only logbook events, or also the recorded state history of entities the
  logbook omits (continuous sensors such as temperature and power)? → A: Logbook events only.
  Continuous-sensor history is a separate, later feature; compressing it is a different problem
  (sampling rather than templating).
- Q: What happens when the complete result would exceed the size limit? → A: The tool fails with a
  distinct error that reports the event count and suggests `summary` or a narrower query. No
  events are returned; a truncated result is never produced (FR-017, FR-019).
- Q: May the agent select entities with patterns such as `light.*`, or only exact entity IDs? → A:
  Both. Exact entity IDs and `*` patterns, matched against the entity IDs of the events in the
  window, so entities that no longer exist still match (FR-005).
- Q: Who can change the size limit: nobody, the user in the server configuration, or the agent per
  call? → A: The user, in the server configuration. The limit has a fixed default set during
  planning; the agent cannot change it (FR-019).
- Q: Are events not tied to any entity (instance start and stop, logbook messages without an
  entity) included? → A: Only when no entity selector is given; with selectors they are excluded,
  because they cannot match an entity ID (FR-005).
- Q: (Planning) Lossless millisecond deltas measured 5.99x on the live 24-hour logbook, but an
  agent cannot read absolute times from deltas. How are event times shown? → A: As readable local
  times to the second, grouped by day and hour (5.37x live). Sub-second precision is dropped; the
  order of events within a second is preserved (FR-007).
- Q: (Planning) The logbook does not filter events by user, so the original reason for requiring
  an administrator token does not hold. Is the requirement kept? → A: Yes, for one shared
  configuration and error set with `ha_snapshot`, and so that a future per-user filter cannot
  silently shrink results (Assumptions).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - What happened, and why (Priority: P1)

A Home Assistant user asks their coding agent a question about past behaviour: "why did the hallway
light turn on at 3 a.m.?", "did the garage door open while we were away?". The agent invokes
`ha_logbook_query` with a time window and the entities involved, and receives every recorded event
for those entities in that window, in order, each with what caused it (the automation, script,
service call, user, or other entity behind the change), compressed so the answer fits in the
agent's context.

**Why this priority**: This is the whole value of the feature. Without it, the agent can see the
installation (`ha_snapshot`) but not its behaviour, and diagnosing an automation starts with the
user copying logbook screens by hand.

**Independent Test**: Run the tool against the reference logbook fixture with a window and an
entity set. Confirm that every event the instance returns for that window and set appears in the
output, in order, with its cause, and that the reported compression ratio meets the floor.

**Acceptance Scenarios**:

1. **Given** a reachable instance, a valid token, a time window, and a set of entity IDs, **When**
   the agent invokes `ha_logbook_query`, **Then** it receives every recorded event for those
   entities in that window, in chronological order, with a `compression_ratio`.
2. **Given** an event caused by an automation, script, service call, user action, or another
   entity's change, **When** the event is returned, **Then** its cause is attached to it, so the
   agent can follow the chain without another call.
3. **Given** several events that share one cause (for example, one automation run that changed
   five lights), **When** they are returned, **Then** that cause is stated once and referenced by
   each event.
4. **Given** the entity set is omitted, **When** the tool is invoked, **Then** events for every
   entity in the window are returned, together with events not tied to any entity (such as the
   instance starting or stopping).
5. **Given** the time window is omitted, **When** the tool is invoked, **Then** the window is the
   24 hours ending at the time of the call.
6. **Given** a requested entity ID that produced no events in the window, or a pattern that
   matched no events, **When** the tool is invoked, **Then** the response lists it explicitly as
   having no events, so the agent can tell "no activity" from "not queried".
7. **Given** a pattern such as `binary_sensor.*_motion`, **When** the tool is invoked, **Then** the
   response contains the events of every entity whose ID matches it in the window, including
   entities that no longer exist.
8. **Given** the reference logbook fixture, **When** a `standard` response is produced, **Then**
   `compression_ratio` is at least the floor set for this tool (FR-018).

---

### User Story 2 - Secrets never reach the agent (Priority: P1)

Logbook output flows into an agent's context exactly like a snapshot. Free-text logbook messages
(for example, entries written by automations) and entity states can carry anything a user or
integration put there, including tokens, passwords, and coordinates. The user must be able to
invoke the tool without any risk that those leave their machine inside the output.

**Why this priority**: A leaked credential or home location is a severe, irreversible harm. This
story is release-blocking: User Story 1 cannot ship without it.

**Independent Test**: Run every detail level against a redaction fixture that plants a known token
in a logbook message, embeds another inside a URL-like state value, and includes coordinates and
an e-mail address. Search each output for any fragment of the planted values.

**Acceptance Scenarios**:

1. **Given** a fixture event whose message contains a token, **When** the tool is invoked at any
   detail level, **Then** the output contains no fragment of that token.
2. **Given** a secret embedded inside a larger value (for example, a URL query string in a state),
   **When** the tool is invoked, **Then** the secret does not appear in the output.
3. **Given** latitude and longitude values or an e-mail address in any event field, **When** the
   tool is invoked, **Then** those values do not appear in the output.
4. **Given** a value that was redacted, **When** the agent reads the output, **Then** the field is
   still present and explicitly marked as redacted.

---

### User Story 3 - Loud, actionable failure (Priority: P2)

When the tool cannot return the complete history requested, the user and the agent learn exactly
why and what to do next. The tool never returns a subset of the events that looks like the whole.

**Why this priority**: An agent that reasons from a silently incomplete history reaches confident,
wrong conclusions ("the door never opened"). Clear errors also make narrowing a query obvious.

**Independent Test**: Invoke the tool with each failure condition shared with `ha_snapshot`, an
invalid window, an instance without history recording, and a query whose result exceeds the size
limit. Confirm each produces a distinct, actionable error and no events.

**Acceptance Scenarios**:

1. **Given** any failure condition shared with `ha_snapshot` (missing configuration, rejected
   token, unreachable host, unsupported version, non-administrator token, failed retrieval),
   **When** the tool is invoked, **Then** it returns the same error kind and guidance as
   `ha_snapshot` and no events.
2. **Given** a window whose end is before its start, or whose start is in the future, or a
   timestamp that cannot be parsed, or an invalid entity selector, **When** the tool is invoked,
   **Then** it returns an error stating the problem and the accepted form, and no events.
3. **Given** an instance that is not recording history (the logbook or its storage is
   unavailable), **When** the tool is invoked, **Then** it returns an error saying so and what to
   enable, and no events.
4. **Given** a query whose complete result would exceed the size limit, **When** the tool is
   invoked, **Then** it returns an error that states the number of events in the window, the size
   limit, and how to narrow the query (use `summary`, a shorter window, or fewer entities), and no
   events.
5. **Given** the user has set a different size limit in the server configuration, **When** the
   tool is invoked, **Then** that limit applies instead of the default, and the error in
   scenario 4 reports it.

---

### User Story 4 - Size up the window first (Priority: P2)

Before pulling a busy day of events, the agent wants orientation: how many events, which entities
were active, when activity started and stopped. `detail=summary` answers that cheaply and tells
the agent how to narrow a `standard` query.

**Why this priority**: It keeps exploratory questions cheap and makes the oversized-result case
(User Story 3) recoverable. The default (`standard`) already delivers the core value, so this story
extends it.

**Independent Test**: Invoke the tool against the reference fixture with each detail value and an
invalid value. Confirm the shape of each response and the rejection of the invalid value.

**Acceptance Scenarios**:

1. **Given** `detail` set to `summary`, **When** the tool is invoked, **Then** the response
   contains counts only: the window, the total event count, event counts per entity and per
   domain, each entity's first and last event time, event counts per cause, and the count of
   events not tied to any entity; and no individual events.
2. **Given** `detail` is omitted, **When** the tool is invoked, **Then** the response is a
   `standard` response.
3. **Given** an unrecognised `detail` value, **When** the tool is invoked, **Then** it is rejected
   with an error listing the accepted values, and no events are returned.

---

### Edge Cases

- **Entities that no longer exist** (removed or renamed since the events were recorded) can still
  be queried; their past events are returned like any other.
- **Entities the logbook does not record** (for example, sensors that report continuous
  measurements) produce no events; they are listed as having no events (User Story 1, scenario 6),
  and the tool's description says which kinds of entities the logbook omits.
- **A window reaching further back than the instance retains history** returns the events that
  still exist; the response states the requested window and the time of the earliest event it
  contains, and the tool's description states that older history may have been purged.
- **Events at the same instant** keep the order in which the instance recorded them.
- **An empty result** (no events in the window) is a valid response with zero counts and a
  well-defined `compression_ratio`, not an error.
- **Duplicate entity IDs, or patterns that overlap** (for example `light.*` and
  `light.hallway`), select each matching entity once.
- **Selectors are lowercase**, like entity IDs. A selector with an uppercase letter is invalid
  (FR-015), so a pattern can never match only because of case.
- **Non-ASCII names, states, and messages** are preserved exactly.
- **A cause that refers to something outside the result** (an automation or entity not in the
  requested set) is still reported with its identifier and name; it is never dropped.
- **Events recorded while the query runs** (after the window's end) are excluded; the window's end
  is fixed at the start of the call.
- **A timestamp without a time-zone offset** in the request is interpreted in the instance's time
  zone.
- **Events not tied to any entity** appear only in queries without selectors, and are counted
  separately from entity events at `summary` detail.
- **An invalid configured size limit** (not a positive number) is a configuration error, reported
  like a missing configuration value; the tool does not fall back silently to the default.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST expose a tool named `ha_logbook_query` (read-only; see FR-016) in the
  same MCP server as `ha_snapshot`, which MUST continue to be advertised unchanged.
- **FR-002**: The tool MUST use the same instance configuration, authentication, and token handling
  as `ha_snapshot`: one instance, a long-lived access token read from the environment, never
  accepted as a tool parameter, never present in any output, log line, or error message.
- **FR-003**: The tool MUST retrieve the logbook events the instance recorded within the requested
  time window for the requested entities, together with each event's cause as the instance records
  it. Only logbook events are in scope; the recorded state history of entities the logbook omits
  (continuous sensors) is not retrieved.
- **FR-004**: The tool MUST accept an optional time window (start and end, as ISO 8601 timestamps).
  When the start is omitted, it MUST be 24 hours before the end; when the end is omitted, it MUST
  be the time of the call. A timestamp without an offset MUST be interpreted in the instance's time
  zone.
- **FR-005**: The tool MUST accept an optional set of entity selectors. Each selector MUST be
  either an exact entity ID or a pattern in which `*` matches any sequence of characters (for
  example `light.*` or `*_motion`). Patterns MUST be matched against the entity IDs of the events
  in the window, not against the entities that currently exist. When the set is omitted, events for
  every entity MUST be returned, together with events not tied to any entity (such as the instance
  starting or stopping, or a logbook message that names no entity); when selectors are given,
  events not tied to any entity MUST be excluded. Each selector that matched no events MUST be
  listed as such in the response.
- **FR-006**: The tool MUST accept an optional `detail` parameter with the values `summary` and
  `standard`. When omitted, the value MUST be `standard`. Any other value MUST be rejected with an
  error listing the accepted values.
- **FR-007**: At `standard` detail, the response MUST contain every retrieved event in
  chronological order, preserving each event's entity, time (to the second, as the instance's
  local time), state or message, and cause. It MUST be lossless relative to the retrieved events
  except for sub-second precision, whose only role, the order of events within a second, is kept by
  their order in the response. Any field it does not repeat per event MUST be recoverable from the
  same response.
- **FR-008**: At `standard` detail, repeated values (entity identities and names, causes shared by
  several events, repeated text, and the date and hour of events, which group them) MUST be stated
  once and referenced, not repeated per event.
- **FR-009**: At `summary` detail, the response MUST contain the counts defined in User Story 4 and
  MUST NOT list individual events.
- **FR-010**: Every successful response MUST state the requested window, the instance's time zone,
  and the time of the earliest and latest event it contains, so that every event time can be read
  as the instance's local time.
- **FR-011**: Every successful response MUST include a `compression_ratio` field, defined exactly as
  for `ha_snapshot`: the serialised size of the raw retrieved payload divided by the serialised
  size of the emitted payload.
- **FR-012**: The system MUST apply the `ha_snapshot` redaction rules to every event field: secrets
  detected by field name and by value content (including secrets embedded in larger values),
  geographic coordinates, and e-mail addresses. Redaction MUST happen before serialisation, and
  every redacted value MUST be replaced by the same explicit redaction marker, with the field kept.
- **FR-013**: Identifiers (entity IDs, device IDs, config entry IDs, user IDs, and cause
  identifiers) MUST NOT be redacted.
- **FR-014**: The tool MUST fail with a distinct, actionable error, and return no events, for every
  failure condition shared with `ha_snapshot` (missing configuration, rejected token, unreachable
  or unresponsive host, unsupported version, non-administrator token, failed retrieval), using the
  same error kinds.
- **FR-015**: The tool MUST additionally fail with a distinct, actionable error, and return no
  events, when: the window is invalid (unparseable timestamp, end before start, or start in the
  future); a selector is invalid (empty, or containing characters that cannot appear in an entity
  ID other than `*`); or the instance is not recording history.
- **FR-016**: The tool MUST NOT change the instance's state or configuration under any parameter
  combination.
- **FR-017**: The tool MUST NOT return a subset of the requested events presented as complete. A
  response either contains every event in the window for the requested entities, or is an
  error.
- **FR-018**: The project MUST maintain a representative reference logbook fixture, and automated
  checks MUST fail if the `standard` compression ratio on that fixture falls below a floor. The
  floor is fixed during planning from measurement on that fixture and MUST be at least 5, the
  `ha_snapshot` floor. The tool's description MUST state its expected compression ratio
  (constitution §4).
- **FR-019**: When the complete `standard` result would exceed the size limit, the tool MUST fail
  with a distinct error that states the event count in the window, the limit, and how to narrow
  the query, and MUST return no events. The limit applies to the emitted (compressed) response;
  `summary` responses are not subject to it. It has a default, fixed during planning and stated in
  the tool's description, which the user MAY override in the server configuration alongside the
  instance address. The limit MUST NOT be accepted as a tool parameter.
- **FR-020**: The logbook response format MUST be a versioned, publicly documented contract in the
  public schema package, and every response MUST declare the format version it conforms to.

### Key Entities _(include if feature involves data)_

- **Logbook event**: One recorded occurrence at a point in time: a state change or a logged
  message. Has a time, a state or message, usually an entity, and optionally a cause. Events not
  tied to any entity (such as the instance starting) have no entity.
- **Cause**: What triggered an event, as the instance records it: an automation or script run, a
  service call, a user action, or another entity's change. One cause can be shared by many events.
- **Time window**: The start and end of the query, fixed at the start of the call and expressed
  with the instance's time zone.
- **Logbook response**: The result of one `ha_logbook_query` invocation. Has a detail level, a
  format version, the window, a `compression_ratio`, and the events or counts appropriate to its
  detail level.
- **Redaction marker**: The same explicit placeholder `ha_snapshot` uses for a secret, coordinate,
  or e-mail value.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the reference logbook fixture, the default response is at least as many times
  smaller than the raw data as the floor fixed in planning, and never less than 5 times.
- **SC-002**: 100% of the events the instance returns for a query appear in the `standard`
  response, in the same order and with the same cause, verified by an automated round-trip check.
- **SC-003**: Zero fragments of any planted secret, coordinate, or e-mail address appear in the
  output of any detail level across the redaction fixture set.
- **SC-004**: A 24-hour query over an instance with 1,000 entities returns a complete response in
  under five seconds.
- **SC-005**: Each failure condition in FR-014, FR-015, and FR-019 produces an error that names its
  cause and a next step, and zero of them return events.
- **SC-006**: Invoking the tool with every combination of parameters causes zero changes to the
  instance's state or configuration.
- **SC-007**: Against the maintainer's live instance, a 24-hour query for all entities and one for
  a single automation's entities complete, and the resulting compression ratios are recorded.

## Assumptions

- Configuration, authentication, the minimum supported version, and the administrator requirement
  are exactly those of `ha_snapshot`. A non-administrator token is a handled failure, not a
  supported mode. The logbook does not currently filter events by user (verified during planning);
  the requirement keeps one configuration and one error set for both tools, and guards against a
  future per-user filter silently shrinking results.
- `summary` and `standard` are the only detail levels. `standard` already keeps every field
  (FR-007), so a `full` level would add nothing; unlike `ha_snapshot`, there is no omission list.
- The default window is the last 24 hours, well inside the instance's default history retention
  and matching the most common diagnostic question ("what happened last night").
- The maintainer's instance retains history for its configured retention period; queries beyond it
  return what remains (see Edge Cases). The tool does not read or change retention settings.
- The five-second target assumes the instance is on the local network and not under abnormal load.
- `compression_ratio` compares byte lengths of UTF-8 serialisations, as in `ha_snapshot`.
- "No fragment of a planted value" means, as in `ha_snapshot`, no contiguous fragment of six or
  more characters.
- The live-instance check (SC-007) is performed manually by the maintainer; automated checks run
  against fixtures and a fake instance only.
- Redaction scope matches `ha_snapshot` exactly (credentials, coordinates, e-mail addresses).
  Hardware identifiers such as MAC addresses are not redacted, consistent with that feature. The
  two coordinate rules this feature adds for free text are shared, so `ha_snapshot` applies them
  too; its redaction only becomes stricter, and its tool definition does not change (FR-001).

### Out of Scope

Automation traces (`ha_trace`, a separate feature), the state history of continuous sensors
(a separate feature), truncated or paginated results, filtering by device, area, or integration,
live streaming of new events, writing to the logbook, diffing, service calls, the sandbox, and
anything in `domusops-pro`.
