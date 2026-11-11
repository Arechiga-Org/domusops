# Feature Specification: ha_state — Seeing What an Entity Is Doing Right Now

**Feature Branch**: `010-ha-state`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: the second tool of the `@domusops/mcp` 0.2.0 phase, the read tools
that keep an agent from falling back to the raw instance API (`ha_ping`, 009, is merged;
`ha_history`, 011, and `ha_system_log`, 012, follow; all four are released together as one minor
release). `ha_state` returns the current state of the entities of the connected instance,
filtered by patterns, with each entity's attributes, `last_changed`, `last_updated` and context,
so an agent can answer "what is this entity doing right now, and what changed it" without
downloading the whole `ha_snapshot` inventory. It replaces the entity-with-attributes filter that
was proposed for `ha_snapshot`: the snapshot stays the full inventory (registries, devices,
integrations, config entries) and `ha_state` is the filtered live view. Today the only way to see
one entity's current state and attributes is to download the whole snapshot or fall back to the
raw API, which is what users of 0.1.1 did.

## Clarifications

### Session 2026-11-11

_None yet. Three open questions are marked below for `/speckit-clarify`._

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Reading the current state of chosen entities (Priority: P1)

An agent is diagnosing something in a home: why a light is still on, what a thermostat is set to,
whether a sensor reports a value. It names the entities, by exact ID or by pattern, and gets, in
one call, each entity's state, its attributes, when it last changed and was last updated, and the
context that produced the change, without reading anything else about the home.

**Why this priority**: This is the gap the tool exists to close. Without it the agent downloads
the full inventory or leaves for the raw API to learn one entity's value.

**Independent Test**: Against a simulated instance with a known set of entities, one call naming
a few of them returns exactly those entities with the instance's state, attributes, change times
and contexts, and reads no registry, history or trace.

**Acceptance Scenarios**:

1. **Given** an instance with several lights, **When** the agent asks for `light.*`, **Then** the
   response lists every light with its state, attributes, last change, last update and context,
   in a stable order.
2. **Given** the same instance and no change in between, **When** the agent makes the same call
   twice, **Then** both responses are identical.
3. **Given** an entity whose last change was caused by an automation, **When** the agent reads
   it, **Then** the response carries the context identifiers, in the form `ha_trace` and
   `ha_logbook_query` accept for their `context` input, so the agent can follow the cause.
4. **Given** attributes that hold a secret, an e-mail address or coordinates, **When** the agent
   reads those entities, **Then** every such value is replaced by the redaction marker, as in the
   other tools, and the attribute is still listed so the agent can see that a value existed.
5. **Given** an instance whose time zone is not UTC, **When** the agent reads an entity, **Then**
   `last_changed` and `last_updated` are in the instance's local time, as in the logbook and
   trace documents.

---

### User Story 2 - Narrowing a large home to what matters (Priority: P1)

A home has hundreds or thousands of entities. The agent wants "every light that is on",
"everything that is unavailable", or "every sensor except the firmware ones". It combines
patterns, domains, a state value and an exclusion list, and when the answer would still be too
big for an agent's context, it is told so and told how to narrow the query.

**Why this priority**: A live view of every entity is useless at the size of a real home, and the
size bound is a constitutional contract (§4); filtering is what makes the tool usable.

**Independent Test**: On a simulated instance with a mix of domains and states, each filter,
alone and combined, returns exactly the expected entities, and a query that exceeds the limit is
refused with the number of entities it matched and a hint for narrowing.

**Acceptance Scenarios**:

1. **Given** lights in the states `on` and `off`, **When** the agent asks for `light.*` with the
   state `on`, **Then** only the lights that are on are returned.
2. **Given** entities across several domains, **When** the agent asks for the state
   `unavailable` without naming entities, **Then** every unavailable entity of every domain is
   returned.
3. **Given** `entities` and `exclude`, **When** both are given, **Then** `exclude` is applied
   after `entities`, with the same patterns and the same rules as `ha_logbook_query`, and a note
   after the document lists what was excluded.
4. **Given** a query that matches more entities than fit in the limit, **When** the agent
   calls the tool, **Then** [NEEDS CLARIFICATION: what happens when a query matches more
   entities than fit the limit: refuse with the count and a narrowing hint, as `ha_logbook_query`
   and `ha_trace` do, or return the first entities that fit with the count of the rest?].
5. **Given** an exact entity ID that does not exist on the instance, **When** the agent asks for
   it, **Then** the response is not an error: it lists no entity for that ID and a note names
   the IDs that were not found.
6. **Given** a pattern that matches nothing, **When** the agent asks for it, **Then** the
   response is an empty, valid document with a note saying nothing matched.

---

### User Story 3 - Taking the temperature of the whole home (Priority: P2)

Before reading anything in detail, the agent wants to know where to look: how many entities each
domain has and how many of them are unavailable or unknown. One cheap call answers it for the
whole home, whatever its size, without the attributes.

**Why this priority**: It turns "what is broken?" into a single small call, and it is the
fallback for a home too large to list. The detailed reads of stories 1 and 2 are the core.

**Independent Test**: On a simulated instance, the summary lists every domain with its counts,
the counts match the instance, and the result stays small however many entities there are.

**Acceptance Scenarios**:

1. **Given** an instance with entities in many domains, **When** the agent asks for the summary,
   **Then** the response lists, per domain, how many entities there are and how many are
   unavailable and unknown, plus the total, and carries no attributes.
2. **Given** the same filters as in story 2, **When** they are combined with the summary,
   **Then** the counts cover only the entities those filters select.

---

### Edge Cases

- A selector is empty, too long, too many or has characters that cannot be in an entity ID: the
  same validation error, with the same wording, as in the other tools.
- `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` is missing or malformed, the instance is unreachable,
  the token is refused, or the instance times out: the same error results as in the other tools.
- The instance's version is below the supported minimum: the same refusal as in the other tools.
- An entity's state is `unavailable` or `unknown`: reported as it is, and selectable by state.
- A state value is not a string on the wire (a malformed answer): reported as a protocol problem,
  as in the other tools.
- An entity with no attributes, or with deeply nested or very long attribute values: reported
  completely (apart from redaction); a single entity that alone exceeds the limit is refused like
  any other oversize result.
- Attribute keys that look like credentials or coordinates, at any depth, are redacted whatever
  the entity.
- Entities that exist in the registry but have no state (disabled ones) are not part of the live
  view and are not returned.
- A `domain` and a pattern that cannot match together (`light` with `switch.*`): an empty
  document with a note, not an error.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The server MUST offer a tool named `ha_state` that returns the current state of
  the instance's entities. Every input is optional.
- **FR-002**: The tool MUST accept `entities`, a list of exact entity IDs and `*` patterns, with
  the same grammar, limits and validation errors as `ha_logbook_query` and `ha_trace`, and the same
  matcher. Without it, every entity is a candidate.
- **FR-003**: The tool MUST accept `exclude`, in the same form, applied after `entities` and the
  filters of FR-004 and FR-005, and MUST list in a note what it excluded, as `ha_logbook_query`
  does.
- **FR-004**: The tool MUST accept a `domain` filter, one or more domains, which keeps only the
  entities of those domains and combines with `entities` by intersection.
- **FR-005**: The tool MUST accept a `state` filter, one or more state values, which keeps only
  the entities whose state equals one of them exactly (`on`, `unavailable`).
- **FR-006**: For each selected entity, the response MUST carry its ID, its state, its attributes
  (after FR-010), `last_changed`, `last_updated`, and its context identifiers as the instance
  gives them. [NEEDS CLARIFICATION: does the document carry every attribute of each entity by
  default, or only those a caller lists in an opt-in `attributes` input?]
- **FR-007**: Entities MUST appear in a deterministic order, by entity ID, so that two calls
  against unchanged states give byte-identical responses.
- **FR-008**: Every timestamp MUST be in the instance's local time zone, in the form the logbook
  and trace documents use.
- **FR-009**: The context identifiers MUST be given in a form that `ha_trace` and
  `ha_logbook_query` accept in their `context` input.
- **FR-010**: Secrets, credentials, tokens (including the configured one), e-mail addresses,
  coordinates (the instance's own and any in an attribute) and URL credentials MUST be redacted
  wherever they occur, under the same rules `ha_snapshot` applies to attribute values, and the
  redacted field MUST still be listed. Entity IDs and the closed list of identifier keys the
  other tools exempt are never touched.
- **FR-011**: The names of people and users MUST be handled as follows:
  [NEEDS CLARIFICATION: do person and user names that appear in attributes (the `friendly_name`
  of a person entity, a `user_id`-style field) stay visible, or are they redacted like e-mail
  addresses? This is open decision 2 of the roadmap and also governs the logbook's cause and any
  future user listing].
- **FR-012**: The response MUST be bounded: a result larger than a documented limit, with the
  same default as `ha_logbook_query` and `ha_trace` and an environment variable to raise it, MUST
  NOT be returned whole, and the message MUST say how many entities matched and how to narrow
  the query (`entities`, `domain`, `state`, `exclude`, `detail=summary`).
- **FR-013**: An exact ID with no entity on the instance MUST NOT be an error: a note names the
  IDs not found, at most 10, with the count of the rest. A query that selects nothing MUST return
  a valid empty document and a note.
- **FR-014**: The tool MUST accept `detail`, with `summary` (counts per domain of entities, of
  unavailable ones and of unknown ones, plus the total, with no attributes) and `standard` (the
  default, FR-006). The summary MUST stay under 4,000 bytes whatever the size of the home.
- **FR-015**: The filters of FR-002 to FR-005 MUST apply to the summary as well, so its counts
  cover only the selected entities.
- **FR-016**: The tool MUST read only the instance's current states and its core configuration
  (for the time zone and the instance's own coordinates). It MUST NOT read registries, history,
  the logbook, traces or the system log, MUST use only commands already on the server's
  allowlist, and MUST make one connection per call.
- **FR-017**: The tool MUST NOT change anything on the instance, and MUST declare itself
  read-only and idempotent to the client.
- **FR-018**: The response MUST be a compact JSON document in a new published, versioned format
  in `@domusops/schema`, with its types, its JSON Schema and a row in the package README, as the
  other formats have. Repeated attribute sets MUST NOT be repeated per entity. Every entity's
  state and attributes MUST be recoverable from the document, apart from redaction, and when the
  document is templated or compressed `@domusops/schema` MUST publish a reference decoder, as for
  the other formats.
- **FR-019**: The response MUST carry a `compression_ratio`, measured as for the other tools
  against the raw instance answers it read, and CI MUST assert a floor for the `standard` detail
  on the reference instance (constitution §4).
- **FR-020**: The tool's entry in the `ha_ping` requirements table MUST state that it needs an
  administrator and no integration, so `ha_ping` reports its readiness without a new format
  version (feature 009, FR-019).
- **FR-021**: The tool MUST work against the current stable, previous stable and current beta
  releases, proven by the sandbox in CI (constitution §8).
- **FR-022**: The outputs of `ha_snapshot`, `ha_logbook_query`, `ha_trace` and `ha_ping` MUST
  NOT change for the same inputs, and every existing output test MUST pass with unchanged
  expectations.
- **FR-023**: The feature MUST carry a minor changeset for `@domusops/mcp` and one for
  `@domusops/schema`.
- **FR-024**: Tests MUST use simulated instances or the sandbox, never a real instance, and no
  specification, fixture or test may contain data taken from a real home.

### Key Entities

- **State record**: one entity's current state as the document gives it: ID, state, attributes
  after redaction, last change, last update and context.
- **Context**: the identifiers of what produced a change (its own ID, its parent's and the
  user's ID), as the instance gives them; never a user's name.
- **State overview**: the `summary` result: per domain, how many entities, how many unavailable
  and how many unknown, and the total.
- **State document**: the result of the tool in the new published format, with its notes and
  its compression ratio.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a simulated instance, a call for named entities returns each one's state,
  attributes, change times and context in a single call that reads no registry, history or trace;
  100% of the entities asked for that exist are returned.
- **SC-002**: On the reference instance, a `standard` result for a domain with many entities is
  at least as many times smaller than the raw states as the floor the plan sets (asserted in CI),
  and the same result decodes back to every entity's state and attributes, apart from
  redaction.
- **SC-003**: A `summary` result is under 4,000 bytes whatever the number of entities and
  domains of the home.
- **SC-004**: A query that exceeds the limit is never returned whole: 100% of such queries are
  refused or bounded as the clarification decides, with the number of entities matched and a
  hint that names the inputs that narrow it.
- **SC-005**: On a synthetic fixture that seeds every redaction rule into entity attributes,
  100% of the seeded secrets, e-mail addresses and coordinates are absent from the response.
- **SC-006**: Two calls against unchanged states give byte-identical responses.
- **SC-007**: On the stable, previous stable and beta releases of the sandbox CI matrix, the same
  query returns the same entities and findings.
- **SC-008**: Every existing output test of the other tools passes with zero edited
  expectations, and every compression floor is unchanged.

## Assumptions

- `ha_state` is the second of the four 0.2.0 tools and ships with them in one minor release; the
  Version Packages pull request, already open, stays unmerged until 011 and 012 merge (roadmap of
  2026-11-04, phase 2).
- The instance can serve the states of all its entities in one answer, as `ha_snapshot` already
  relies on; the tool keeps that read in memory only for the call and never stores it.
- Every existing tool requires an administrator token, so `ha_state` does too, for consistency,
  even though reading states does not strictly need one.
- The patterns of FR-002 follow the matcher `ha_logbook_query` and `ha_trace` share: anchored,
  case-sensitive, `*` matching any run of characters.
- The default limit equals the one of the logbook and trace tools (100,000 bytes); the plan names
  the environment variable that raises it.
- Constitution §4 applies without exemption: the tool carries `compression_ratio` and a floor in
  CI; the plan sets the floor from the reference instance.
- The redaction rules are the ones `ha_snapshot` already applies to attribute values; this
  feature adds no new rule except what the clarification of FR-011 decides.

### Out of scope

- `ha_history` and `ha_system_log` (features 011 and 012).
- Registries, devices, integrations, config entries and areas: `ha_snapshot` stays the full
  inventory.
- Subscribing to changes or watching live (`ha_watch`), templates (`ha_template`) and long-term
  statistics.
- Any tool that changes the instance.
- Listing users or people as such; only what appears in an entity's attributes and context.
