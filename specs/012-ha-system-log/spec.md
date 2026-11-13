# Feature Specification: ha_system_log — Reading What the Instance Complained About

**Feature Branch**: `012-ha-system-log`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: the fourth and last tool of the `@domusops/mcp` 0.2.0 phase, the
read tools that keep an agent from falling back to the raw instance API (`ha_ping`, 009,
`ha_state`, 010, and `ha_history`, 011, are merged; all four are released together as one minor
release, and the Version Packages pull request is merged after this feature). `ha_system_log`
returns the errors and warnings the instance has recorded in its system log (what the instance's
interface shows under its system logs), so an agent can answer "why did this integration stop
working", "what failed when this automation ran" or "is this custom integration throwing
exceptions" without falling back to the raw API or asking the user to paste logs. It complements
the tools next to it: `ha_trace` explains one automation or script run, `ha_logbook_query` and
`ha_history` show what entities did, and `ha_system_log` shows what the instance itself
complained about.

## Clarifications

### Session 2026-11-13

- Q: Is an entry's traceback included by default, only on request, or only its last frames? → A:
  In full by default, as `ha_history` gives every attribute by default; file paths and frames
  repeated across tracebacks are given once and the instance's installation path is shortened, and
  the size limit and the overview bound the result (FR-002, FR-016).
- Q: Does the integration filter take integration domains, logger name patterns, or both? → A:
  Integration domains, with the same pattern matcher as the other tools; an entry whose logger
  belongs to no integration is listed only when the call has no integration filter (FR-004).
- Q: Are there two detail levels, an overview of counts and the entries, or only the entries? →
  A: Two, as in `ha_logbook_query` and `ha_history`: `summary`, counts per integration and level,
  and `standard`, the entries, the default (FR-012).
- Q: Are file paths in an entry's source and traceback shortened to fixed roots, so that no
  absolute path of the host appears in the response? → A: Yes, three roots are replaced by fixed
  markers: the instance's installation, its configuration directory (where custom integrations
  live) and the Python library directory; any other absolute path stays as it is, apart from
  redaction (FR-009, FR-016).
- Q: When an entry's logger belongs to no integration, is its integration taken from the path of
  its source file? → A: Yes. The logger is used first; when it names no integration, the source
  path is used when it lies in a built-in integration's code or in a custom integration's
  directory; the entry says which of the two gave its integration (FR-003).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Reading the errors of an integration (Priority: P1)

An agent is diagnosing an integration that stopped working, an automation that failed, or a
custom integration the user just installed. It asks for the instance's recorded errors and
warnings, narrowed to the integrations it suspects, and gets, in one call, each recorded entry
with its level, the integration and logger it came from, where in the code it was raised, how
many times it happened, when it first and last happened, its distinct messages and its exception
traceback.

**Why this priority**: This is the gap the tool exists to close. Without it the agent asks the
user to copy logs from the interface, or leaves for the raw API.

**Independent Test**: Against a simulated instance with a known system log, one call naming an
integration returns exactly that integration's entries, with every field above, and reads nothing
else about the home.

**Acceptance Scenarios**:

1. **Given** a system log with entries from several integrations, **When** the agent asks for one
   integration's entries, **Then** the response lists exactly that integration's entries, each
   with its level, logger, source location, count, first and last occurrence, messages and
   traceback.
2. **Given** an entry the instance has grouped because the same problem recurred, **When** the
   agent reads it, **Then** it appears once, with its occurrence count and its distinct messages,
   as the instance grouped it, never split back into occurrences.
3. **Given** an entry raised by a custom integration, **When** the agent reads it, **Then** the
   entry names the integration and marks it as custom, so the agent can tell an installed add-on
   integration's fault from a built-in one.
4. **Given** messages or tracebacks that contain the access token, a secret, an e-mail address,
   credentials inside a URL or the home's coordinates, **When** the agent reads them, **Then** each
   such value is replaced by the redaction marker inside the text, as in the other tools, and the
   rest of the message, the logger, the file names and the line numbers stay visible.
5. **Given** an instance whose time zone is not UTC, **When** the agent reads the log, **Then**
   every time in the response is in the instance's time zone, as in the logbook, trace, state and
   history documents.
6. **Given** nothing recorded between two calls (no new entry and no new occurrence of an existing
   one), **When** the agent makes the same call twice, **Then** both responses are identical.

---

### User Story 2 - Keeping a noisy log within bounds (Priority: P1)

A home with a failing integration can fill its system log with long tracebacks. The agent narrows
by integration, level and time, and when the answer would still be too big for its context, it is
refused, told how many entries matched, and told how to narrow the query.

**Why this priority**: Tracebacks are long and repetitive, and the size bound is a constitutional
contract (§4); compressing what tracebacks repeat is what makes a useful log fit.

**Independent Test**: On a simulated instance with entries at several levels from several
integrations, each filter, alone and combined, returns exactly the expected entries, file paths
and frames repeated across tracebacks are not repeated in the response, and a query over the
limit is refused with the count and a hint.

**Acceptance Scenarios**:

1. **Given** an inclusion and an exclusion filter on integrations, **When** both are given,
   **Then** the exclusion is applied after the inclusion, with the same pattern rules as the other
   tools, and a note after the document lists what was excluded.
2. **Given** a minimum level, **When** the agent passes it, **Then** only entries at that level or
   above are listed.
3. **Given** a start time, **When** the agent passes it, **Then** only entries whose last
   occurrence is at or after it are listed, the time parsed as `ha_logbook_query` parses it.
4. **Given** a query whose result is larger than the limit, **When** the agent calls the tool,
   **Then** it gets an error result, as from the other tools, that gives the number of entries
   matched and says how to narrow the query or raise the limit, and no partial list.
5. **Given** filters that match no entry, or an empty log, **When** the agent calls the tool,
   **Then** it gets a valid empty document and a note, not an error.

---

### User Story 3 - Seeing which integrations are failing before reading the details (Priority: P2)

Before reading entries in detail, the agent wants to know which integrations have entries, at
which levels and how often, to pick the ones worth reading or to see why a query is too large.
One small call answers it.

**Why this priority**: It turns a refused query into a narrower one in a single step, and answers
"is anything wrong at all" cheaply. The detailed read of stories 1 and 2 is the core.

**Independent Test**: On a simulated instance, the overview gives, per integration and level, the
number of entries and of occurrences; the counts match the recorded log, and the result stays
small whatever the log holds.

**Acceptance Scenarios**:

1. **Given** a system log, **When** the agent asks for the overview, **Then** the response lists,
   per integration, the number of entries and of occurrences at each level, with the totals, and
   carries no message or traceback.
2. **Given** the same filters as in story 2, **When** they are combined with the overview,
   **Then** the counts cover only the selected entries.

---

### Edge Cases

- A filter pattern is empty, too long, too many or has characters that cannot be in an integration
  domain: the same validation error, with the same wording, as the selectors of the other tools.
- `start` is malformed or in the future: the same handling as `ha_logbook_query` (a validation
  error for a malformed time; a future start matches nothing).
- The level is not one the tool accepts: a validation error that lists the accepted levels.
- `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` is missing or malformed, the instance is unreachable,
  the token is refused, the instance times out, or its version is below the supported minimum:
  the same error results as in the other tools.
- The system log integration is not loaded: an error result that says so and what to change, as
  `ha_logbook_query` does for the logbook integration.
- The instance keeps only a bounded number of entries and loses them when it restarts: the
  response holds what is recorded, and nothing says more existed; the README states both bounds.
- An entry comes from a logger that belongs to no integration (a third-party library) but its
  source lies in an integration's code: it belongs to that integration, and says that its source
  gave it (FR-003).
- An entry whose logger and source both belong to no integration (the instance's core): listed with
  its logger and no integration.
- An entry has no traceback, or several distinct messages, or a very long message: reported
  completely, apart from redaction.
- A traceback runs through the instance's own installation, a custom integration's directory and
  third-party libraries: every frame keeps its file and line; the installation, configuration and
  Python library roots are replaced by the same markers in every frame (FR-009). A path outside
  those roots stays as it is.
- One entry alone exceeds the limit: refused like any other oversize result, with the hint to
  raise the limit.
- An `integrations` pattern names an integration with no entry: not an error; the empty result or
  the other integrations' entries are returned, as for any filter.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The server MUST offer a tool named `ha_system_log` that returns the entries the
  instance has recorded in its system log.
- **FR-002**: Each entry MUST carry, as the instance records it: its level, its logger, its source
  location (file and line), its occurrence count, its first and last occurrence, its distinct
  messages in the order the instance keeps them, and its exception traceback in full when it has
  one. Entries are never split or merged: one entry of the instance is one entry of the response.
- **FR-003**: Each entry MUST name the integration it belongs to and MUST mark custom integrations
  as such. The integration is derived from the entry's logger name first (built-in and custom
  integrations each have a fixed logger prefix); when the logger names no integration (a
  third-party library's logger, say), it is derived from the entry's source path, when that path
  lies in a built-in integration's code or in a custom integration's directory. The entry MUST say
  which of the two gave its integration. An entry for which neither gives one carries no
  integration and keeps its logger.
- **FR-004**: The tool MUST accept `integrations`, a list of integration domains and `*` patterns,
  and `exclude`, in the same form, applied after it, with the same limits, validation errors and
  matcher as the `entities` and `exclude` selectors of the other tools, and MUST list in a note
  what it excluded. A pattern matches an entry's integration domain, built-in or custom alike. An
  entry with no integration is listed only when the call has no `integrations`, and no `exclude`
  pattern removes it.
- **FR-005**: The tool MUST accept a minimum level among the levels the instance records (debug,
  info, warning, error, critical). By default every recorded entry is listed.
- **FR-006**: The tool MUST accept `start`, parsed exactly as `ha_logbook_query` parses it (a time
  without an offset is read in the instance's time zone). With it, only entries whose last
  occurrence is at or after `start` are listed. Without it, every recorded entry is listed.
- **FR-007**: Entries MUST appear in order of last occurrence, oldest first, ties broken by logger
  and then source location, so that two calls with nothing recorded in between (no new entry and no
  new occurrence of an existing one) give byte-identical responses.
- **FR-008**: Every timestamp MUST be in the instance's local time zone, to the second, in the
  form the logbook, trace, state and history documents use.
- **FR-009**: The access token, secrets, credentials, e-mail addresses, credentials inside URLs and
  coordinates (the instance's own and any pair in the text) MUST be redacted inside messages and
  tracebacks under the same rules the other tools apply to text values, replacing only the
  matching text with the redaction marker. File paths in sources and tracebacks MUST have three
  roots replaced by fixed markers: the instance's installation, its configuration directory and
  the Python library directory, since on some installations these lie under the home directory of
  the host's user and would reveal its name. Logger names, integration names, file paths below
  those roots, line numbers and the rest of the text stay visible.
- **FR-010**: The response MUST be bounded: a result larger than a documented limit, with the same
  default as the other tools (100,000 bytes) and an environment variable of its own to raise it,
  MUST be refused with an error result, never returned in part, and the message MUST say how many
  entries matched and how to narrow the query or raise the limit.
- **FR-011**: A query that selects no entry, or an empty log, MUST return a valid empty document
  and a note, not an error.
- **FR-012**: The tool MUST accept `detail`, with `summary` and `standard` (the default, FR-002).
  The summary carries no message, source location or traceback; it gives, per integration and
  level, the number of entries and of occurrences, plus the totals, with the entries that have no
  integration counted in a row of their own. The filters of FR-004 to FR-006 apply to it, and it is
  subject to the limit of FR-010.
- **FR-013**: The tool MUST check that the system log integration is loaded and, when it is not,
  return an error result that names it and says what to change, as `ha_logbook_query` does for the
  logbook integration.
- **FR-014**: The tool MUST read only the current user (to check for an administrator, as the other
  tools do), the instance's core configuration (time zone, loaded integrations and the instance's
  own coordinates) and the system log. The system log read is a new read-only command on the
  server's allowlist, justified in the plan with its exact parameters; any other new command MUST
  also be a read and be justified. It MUST NOT read the raw log file, entities, registries, the
  logbook, traces or history, and MUST make one connection per call.
- **FR-015**: The tool MUST NOT change anything on the instance (it never writes to or clears the
  log), and MUST declare itself read-only and idempotent to the client.
- **FR-016**: The response MUST be a compact JSON document in a new published, versioned format in
  `@domusops/schema`, with its types, its JSON Schema, a reference decoder that restores every
  entry with its full messages and traceback (apart from redaction, and times to the second), and
  a row in the package README. File paths and frames repeated across tracebacks MUST NOT be
  repeated per entry; the decoder restores paths with the root markers of FR-009, not the host's
  absolute paths.
- **FR-017**: The response MUST carry a `compression_ratio`, measured as for the other tools
  against the raw instance answer it read, and CI MUST assert a floor on a synthetic reference log
  (constitution §4).
- **FR-018**: The tool's entry in the `ha_ping` requirements table MUST state that it needs an
  administrator and the system log integration, as the `ha_ping` tests already expect, so
  `ha_ping` reports its readiness without a new format version (feature 009, FR-019).
- **FR-019**: The tool MUST work against the current stable, previous stable and current beta
  releases, proven by the sandbox in CI (constitution §8). The sandbox harness may produce log
  entries for the test; the server never does.
- **FR-020**: The outputs of `ha_snapshot`, `ha_logbook_query`, `ha_trace`, `ha_state`,
  `ha_history` and `ha_ping` MUST NOT change for the same inputs, and every existing output test
  MUST pass with unchanged expectations. The one exception is FR-018: `ha_ping` lists
  `ha_system_log` among its tools, and the `ha_ping` tests that list every tool gain that entry.
- **FR-021**: The feature MUST carry a minor changeset for `@domusops/mcp` and one for
  `@domusops/schema`.
- **FR-022**: Tests MUST use simulated instances or the sandbox, never a real instance, and no
  specification, fixture or test may contain data taken from a real home (no real log captures,
  tracebacks or paths).

### Key Entities

- **Log entry**: one problem as the instance groups it: level, logger, source location, occurrence
  count, first and last occurrence, distinct messages and traceback, plus the integration derived
  from the logger.
- **Integration**: the built-in or custom integration an entry belongs to, from its logger or,
  failing that, its source path; an entry may have none.
- **Log overview**: the `summary` result: per integration and level, the number of entries and of
  occurrences, and the totals.
- **System log document**: the result of the tool in the new published format, with its notes and
  its compression ratio.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a simulated instance, a call for one integration returns every recorded entry of
  that integration with every field of FR-002 in a single call; 100% of its recorded entries are
  returned and no other.
- **SC-002**: On the synthetic reference log, the result is at least as many times smaller than
  the raw system log as the floor the plan sets (asserted in CI), and the same result decodes back
  to every entry with its full messages and traceback, apart from redaction.
- **SC-003**: A query that exceeds the limit never returns entries: 100% of such queries are
  refused, with the number of entries matched and a hint that names the inputs that narrow it.
- **SC-004**: On a synthetic fixture that seeds every redaction rule into messages and tracebacks,
  100% of the seeded values are absent from the response, no seeded root of the installation,
  configuration or Python library directory appears, and every seeded file name and line number is
  present.
- **SC-005**: Two calls with nothing recorded in between (no new entry and no new occurrence of
  an existing one) give byte-identical responses.
- **SC-006**: On the stable, previous stable and beta releases of the sandbox CI matrix, the same
  query returns the same entries.
- **SC-007**: Every existing output test of the other tools passes with zero edited expectations,
  apart from the new `ha_system_log` entry in `ha_ping`'s tool list (FR-018), and every
  compression floor is unchanged.

## Assumptions

- `ha_system_log` is the last of the four 0.2.0 tools and ships with them in one minor release;
  the Version Packages pull request, already open, is merged after this feature (roadmap of
  2026-11-04, phase 2).
- The system log is read over the same WebSocket connection as every other read, not over the
  REST API, as the roadmap decided; the raw log file is not read.
- Every existing tool requires an administrator token, so `ha_system_log` does too, as the
  `ha_ping` tests already expect.
- The instance keeps the system log in memory, a bounded number of entries (configurable on the
  instance), cleared when it restarts; the plan measures the bound and the fields on the supported
  releases.
- By default every recorded entry is listed, whatever its level (FR-005): the instance records
  warnings and above unless configured otherwise, so the default already leaves out debug and
  info noise. This answers the feature request's open question 3.
- `start` compares against an entry's last occurrence (FR-006): a problem that began before
  `start` and still recurs is the one an agent is looking for. This answers the feature request's
  open question 4.
- The patterns of FR-004 follow the matcher the other tools share: anchored, case-sensitive, `*`
  matching any run of characters.
- The redaction rules are the ones the other tools already apply to text values, which replace only
  the matching text; this feature adds no new rule.
- The system log records no context for an entry, so the response carries none; the plan confirms
  it.
- The default limit equals the one of the other tools (100,000 bytes); the plan names the
  environment variable that raises it.
- Constitution §4 applies without exemption: the tool carries `compression_ratio` and a floor in
  CI; the plan sets the floor from the synthetic reference log.

### Out of scope

- The raw log file, and the instance's log level configuration.
- Writing to or clearing the system log.
- Watching the log live (`ha_watch`).
- Repairs and issues (the repairs registry).
- Supervisor and add-on logs.
- Any tool that changes the instance.
- Changes to the existing tools, apart from `ha_ping` listing the new one.
- The scenario and assertion DSL (feature 006).
