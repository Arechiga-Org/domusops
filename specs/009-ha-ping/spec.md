# Feature Specification: ha_ping — Knowing the Setup Works Before the First Query

**Feature Branch**: `009-ha-ping`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: the first tool of the `@domusops/mcp` 0.2.0 phase, the read tools
that keep an agent from falling back to the raw instance API (the others are `ha_state`, 010,
`ha_history`, 011, and `ha_system_log`, 012, released together as one minor release).
`ha_ping` is a cheap, read-only tool that tells an agent, before any real query, whether the
server can work with the configured instance: whether it is reachable, whether the token
authenticates, the instance's version and whether the server supports it, whether the token's
user is an administrator, and which integrations the existing tools depend on are loaded, so the
agent knows which tools will work. It also reports the server's own name and version. Today a
token without administrator rights or a mistyped address is only discovered on the first real
query, and `ha_snapshot` at summary detail still downloads every registry to answer "does it
connect?". The work comes from using 0.1.1, where the agent had no cheap way to tell a setup
problem from a data problem.

## Clarifications

### Session 2026-11-10

- Q: Is a failure to connect or to authenticate returned as an error result, as the other tools
  do, or as a successful document that describes what failed? → A: An error result, with the
  same kind and remediation text as the other tools (unreachable, refused token, timeout). The
  document is returned whenever the instance answered; a user who is not an administrator, a
  missing integration and an unsupported version are reported in it (FR-007, FR-018).
- Q: Does the result include the instance's time zone? → A: Yes, its IANA name, the same value
  the logbook and trace documents already carry, so an agent can write a query window in it
  from the first query (FR-003, FR-010).
- Q: Does the readiness list cover every tool the server offers, including those features 010
  to 012 add, or only the three tools of today? → A: Every tool the server offers except
  `ha_ping` itself, in a list keyed by tool name that is open by design: each later tool adds
  its own entry and requirements without a new format version (FR-006, FR-019).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Confirming the setup before the first query (Priority: P1)

An agent starts a session against a home and, before it asks anything about the home, wants to
know that the server is configured correctly: that the instance answers, that the token is
accepted, which version the instance runs, and that every tool it may need will work. One call
answers all of it, quickly, without reading the home's entities, history or traces.

**Why this priority**: Every other tool depends on this setup. A cheap check lets the agent
start with confidence, and is the first step of any troubleshooting.

**Independent Test**: Against a simulated instance where everything is in order, one call
returns a small document saying the instance is reachable, the token is accepted, the user is an
administrator, the instance's version is supported, the integrations each tool needs are loaded,
and each existing tool is ready; the call reads no entity, registry, history or trace.

**Acceptance Scenarios**:

1. **Given** a correctly configured server and a supported instance with the logbook
   and trace integrations loaded, **When** the agent calls `ha_ping`, **Then** the response
   states the server's name and version, the instance's version and time zone, that it is
   supported, that the
   user is an administrator, that each of those integrations is loaded, and that
   `ha_snapshot`, `ha_logbook_query` and `ha_trace` are each ready.
2. **Given** the same setup, **When** the agent calls `ha_ping` twice, **Then** both responses
   are identical, and neither changes anything on the instance.
3. **Given** the same setup, **When** the agent calls `ha_ping`, **Then** the response contains
   no token, no instance address, no location, no user or person name, and no entity data.

---

### User Story 2 - Telling a setup problem from a data problem (Priority: P1)

Something is wrong with the setup: the token's user is not an administrator, an integration a
tool needs is not loaded, the instance runs a version the server does not support, the address
is wrong, or the token is refused. The agent calls `ha_ping` and learns what is wrong and what
to change, instead of finding out from a failed history query that looks like missing data.

**Why this priority**: This is the problem that motivated the tool: in real use the agent could
not tell a setup problem from a data problem.

**Independent Test**: Against simulated instances that each have one problem, every call names
that problem and the tools it affects, and says what to change.

**Acceptance Scenarios**:

1. **Given** a token whose user is not an administrator, **When** the agent calls `ha_ping`,
   **Then** the response says the user is not an administrator, that each tool requiring an
   administrator is not ready because of it, and that an administrator's token is needed.
2. **Given** an instance without the trace integration loaded, **When** the agent calls
   `ha_ping`, **Then** the response says `trace` is not loaded and that `ha_trace` is not ready
   because of it, while the other tools are reported ready.
3. **Given** an instance below the server's minimum supported version, **When** the agent calls
   `ha_ping`, **Then** the response gives the instance's version, the minimum, and says no tool
   will work until the instance is upgraded.
4. **Given** an address where no instance answers, or a token the instance refuses, **When** the
   agent calls `ha_ping`, **Then** it gets an error result, with the same kind and remediation
   text the other tools give, that says which of the two happened and what to check, within the
   server's connection time limit.

---

### Edge Cases

- `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` is missing or malformed: the tool reports the same
  configuration problem, with the same wording, as the other tools, without trying to connect.
- The instance answers but takes longer than the server's per-command limit: the response says
  the instance timed out and at which step, as the other tools do.
- The instance's version string cannot be parsed: reported as a protocol problem, as the other
  tools do.
- A beta or development build: its version is reported as the instance gives it, and support is
  judged on its base version, as the other tools judge it.
- An integration reported under a sub-component name: only the integration's own name counts as
  loaded.
- The user is an administrator but an integration is missing: only the tools that need that
  integration are not ready.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The server MUST offer a tool named `ha_ping` that takes no required input and
  answers whether the server can work with the configured instance.
- **FR-002**: The response MUST state the server's name and version, the same values the
  connection handshake reports.
- **FR-003**: The response MUST state the instance's version, the server's minimum supported
  version, whether the instance's version meets it, and the instance's time zone (its IANA
  name, as the logbook and trace documents give it).
- **FR-004**: The response MUST state whether the token's user is an administrator, without
  naming the user.
- **FR-005**: The response MUST state, for each integration a listed tool depends on (today
  `logbook` for `ha_logbook_query`, `trace` for `ha_trace`), whether it is
  loaded.
- **FR-006**: The response MUST state, for every tool the server offers except `ha_ping`
  itself (today `ha_snapshot`, `ha_logbook_query` and `ha_trace`), whether it is ready, and when
  it is not, every reason from a fixed list (not an administrator, version not supported, a
  named integration not loaded).
- **FR-007**: Whenever something is not ready, the response MUST say what to change, in the
  same style as the other tools' remediation text.
- **FR-008**: The tool MUST read only what it needs to answer FR-002 to FR-006: it MUST NOT read
  entities, states, registries, history, logbook events or traces, and MUST make one connection
  per call.
- **FR-009**: The tool MUST NOT change anything on the instance, and MUST declare itself
  read-only and idempotent to the client.
- **FR-010**: The response MUST NOT contain the token, the instance address, the instance's
  location (coordinates or elevation) or name, or any user or person name. The time zone of
  FR-003 is the only regional information it carries.
- **FR-011**: Missing or malformed configuration MUST be reported as the other tools report it,
  before any connection is attempted.
- **FR-012**: The response MUST be a compact JSON document in a published, versioned format in
  `@domusops/schema`, with its types, JSON Schema and a description in the package README, as
  the other formats have.
- **FR-013**: The response MUST carry a `compression_ratio`, measured as for the other tools
  against the raw instance answers it read, and CI MUST assert a floor for it on the reference
  instance (constitution §4).
- **FR-014**: The tool MUST work against the current stable, previous stable and current beta
  releases, proven by the sandbox in CI (constitution §8).
- **FR-015**: The outputs of `ha_snapshot`, `ha_logbook_query` and `ha_trace` MUST NOT change
  for the same inputs, and every existing output test MUST pass with unchanged expectations.
- **FR-016**: The feature MUST carry a minor changeset for `@domusops/mcp` and one for
  `@domusops/schema`.
- **FR-017**: Tests MUST use simulated instances or the sandbox, never a real instance, and no
  specification, fixture or test may contain data taken from a real home.
- **FR-018**: When no instance answers, the token is refused, or the instance does not answer in
  time, the tool MUST return an error result with the same kind and remediation text as the other
  tools. Once the instance has answered, every finding of FR-003 to FR-006, including a user who
  is not an administrator and a version below the minimum, MUST be reported in the document, not
  as an error.
- **FR-019**: The published format MUST treat the readiness list as open: a document that lists
  a tool a reader does not know is valid, so a later feature adds a tool's entry, and its
  requirements, without a new format version.

### Key Entities

- **Ping result**: the document `ha_ping` returns. It holds the server's identity, the
  instance's version, support and time zone, whether the user is an administrator, which needed
  integrations are loaded, each listed tool's readiness with its reasons, the remediation text,
  and the compression ratio.
- **Tool readiness**: for one tool the server offers, keyed by its name, whether it will work
  against this instance, and the reasons it will not, from a fixed list.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the simulated instances of the acceptance scenarios, every setup problem listed
  in User Story 2 is named correctly in 100% of calls, together with the tools it affects.
- **SC-002**: A call against a healthy instance reads zero entities, registries, history events
  or traces.
- **SC-003**: Every response is under 2,000 bytes, whatever the size of the home and with every
  tool of the 0.2.0 release listed.
- **SC-004**: Against an address where nothing answers, the agent has its answer within the
  server's connection time limit (10 seconds by default).
- **SC-005**: On the stable, previous stable and beta releases of the sandbox CI matrix, a
  default instance gives the same findings: supported, an administrator, every needed
  integration loaded, and every tool ready.
- **SC-006**: Every existing output test of the three tools passes with zero edited
  expectations, and every compression floor is unchanged.

## Assumptions

- `ha_ping` is the first of the four 0.2.0 tools and ships with them in one minor release; the
  Version Packages pull request waits for all four (roadmap of 2026-11-04, phase 2).
- The description asked for no compression floor, since the answer has a fixed size. Constitution
  §4 requires every tool that returns data from a live instance to document its ratio and have a
  floor in CI, with no exemption, so the response carries `compression_ratio` like the other
  tools (FR-013). Because the answer is a short summary of the instance's core configuration, its
  ratio is high; the plan sets the floor from the reference instance.
- Every existing tool requires an administrator token today, so readiness is judged against that
  requirement; a later tool with other requirements adds its own entry.
- The minimum supported version is the server's existing refusal threshold; it is a refusal
  threshold, not a support claim (constitution §8).
- The integrations checked are those the listed tools depend on; checking HACS or custom
  integrations is out of scope.

### Out of scope

- `ha_state`, `ha_history` and `ha_system_log` (features 010, 011 and 012).
- Any tool that changes the instance.
- Latency benchmarking or monitoring over time.
- Checking HACS, custom integrations, add-ons or the host system.
