# Feature Specification: mcp reliability — A Server That Loads, Says What It Is, and Filters Better

**Feature Branch**: `008-mcp-reliability`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: release 0.1.2 of `@domusops/mcp`. Make the server load reliably
in an MCP client and report what it is, and add two small filters, with no change to any
existing output for the same inputs. The work comes from using 0.1.1 against a live instance:
the server did not load in a Claude Code session, the agent wrote its own decoder for the
compressed logbook, a broad entity pattern returned many entities of no interest, and a morning
query for automation runs from the night before returned nothing, because the instance had
already discarded those traces. One feature, shipped as one patch release. Feature number 006
stays reserved for the scenario and assertion DSL.

## Clarifications

### Session 2026-11-04

- Q: Where do the discarded-runs warning and the exclusion note go: next to the document in the
  tool's response, or inside the document? → A: Next to the document, as a separate text block
  in the same response. The document stays identical to 0.1.1's and `@domusops/schema` does not
  change (FR-009, FR-013, FR-015).
- Q: Which fixed installation does the README recommend as the main way to run the server? → A:
  A development dependency of the Home Assistant configuration repository, so its version is
  pinned in that repository's lockfile and updated through a pull request; the MCP client runs
  the binary from the repository's dependencies. A global installation and the pinned on-demand
  form are documented as alternatives (FR-003).
- Q: Does `exclude` also reach `ha_trace` in this release, or only `ha_logbook_query`? → A:
  Both, with the same syntax and rules. In `ha_trace`, excluded automations and scripts appear
  neither in the result nor in the discarded-runs warning (FR-007 to FR-010).
- Q: How many affected automations or scripts does the discarded-runs warning name at most
  before summarising the rest? → A: 10; past that it says how many more there are (FR-014).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The server says which release it is (Priority: P1)

An agent or a person connects an MCP client to the server and wants to know which release
answered. Today the server introduces itself as version 0.0.0 whatever is installed, so a
stale cache, a wrong pin or an old global install cannot be told apart from the current release.

**Why this priority**: Every other diagnosis starts from "which version is running". It is a
defect in what the server reports, and it is the smallest change in this feature.

**Independent Test**: Start the built server, complete the connection handshake, and compare
the reported version with the version of the installed package.

**Acceptance Scenarios**:

1. **Given** release 0.1.2 is installed, **When** a client connects, **Then** the server
   reports the name `domusops-mcp` and the version `0.1.2`.
2. **Given** any later release, **When** a client connects, **Then** the reported version is
   that release's version with no edit made by hand for the release.

---

### User Story 2 - Setting up the server without guesswork (Priority: P1)

A person adds the server to Claude Code for a Home Assistant configuration repository. They
follow the package's README: they install the server once so it does not download itself at
every start, register it, approve it, keep the token out of the repository, and know what to
check when it does not connect. When they or their agent read a response, the README points
them to the decoders that already ship in `@domusops/schema`, so nobody writes their own.

**Why this priority**: When the server does not load, the agent falls back to calling the
instance directly and nothing else in this toolkit gets used. The first real use of 0.1.1 hit
exactly this.

**Independent Test**: On a machine with Node.js and Claude Code but no prior setup, follow only
the README against a simulated instance or the sandbox, and check that the tools are listed as
connected and that a response decodes with the documented decoder.

**Acceptance Scenarios**:

1. **Given** the README, **When** a person follows its recommended installation in their
   configuration repository, **Then** the server's version is recorded in that repository's
   lockfile and the server starts without resolving or downloading the package at start.
2. **Given** the README's Claude Code section, **When** a person registers the server for one
   repository, **Then** the steps cover registering it, approving a server declared in the
   repository, and keeping the token out of version control.
3. **Given** a server that does not connect, **When** the person reads the troubleshooting
   list, **Then** it names the checks for the common causes: the server is waiting for
   approval, the command is not found, the URL or token variable is missing or wrong, and the
   token's user is not an administrator.
4. **Given** a response from any of the three tools, **When** the reader follows the README's
   decoding section, **Then** it names the decoder for that document and detail level, and the
   example in it runs as written.

---

### User Story 3 - Leaving uninteresting entities out of the logbook and traces (Priority: P2)

An agent asks the logbook about one room with a broad pattern and also gets firmware updates,
buttons and number settings it does not care about. It now passes an exclusion list, written
the same way as the entity list, and those entities do not appear in the result. The same
list works for traces, where `automation.*` otherwise brings in every automation.

**Why this priority**: It makes broad patterns usable and lets results that are refused for size
fit without narrowing the window. It is additive and does not change existing calls.

**Independent Test**: Against a simulated instance, run the same logbook query and the same
trace query with and without an exclusion list, and compare the events or runs, counts and size.

**Acceptance Scenarios**:

1. **Given** a query with `entities` and `exclude`, **When** it runs, **Then** no event of an
   entity matched by `exclude` appears, at any detail level, and the counts leave them out.
2. **Given** a query with `exclude` but no `entities`, **When** it runs, **Then** every event
   is returned except those of excluded entities, and events with no entity are kept.
3. **Given** an entity matched by both `entities` and `exclude`, **When** the query runs,
   **Then** it is excluded.
4. **Given** a standard result over the size limit, **When** the excluded entities bring it
   under the limit, **Then** it is returned instead of refused.
5. **Given** any query without `exclude`, **When** it runs, **Then** its document is identical
   to 0.1.1's for the same instance state and no exclusion note is added.
6. **Given** a trace query with `entities: ["automation.*"]` and an `exclude` pattern, **When**
   it runs, **Then** no run of an excluded automation appears, the counts and the size check
   leave them out, and the discarded-runs warning (US4) does not name them.
7. **Given** a trace query by `run` or `context`, **When** it also has `exclude`, **Then** it is
   refused as `entities` is today, because those selections take no other selector.

---

### User Story 4 - Telling "nothing ran" from "the runs are gone" (Priority: P2)

In the morning, an agent asks for the traces of the night before. The instance keeps only the
last few runs of each automation, and an automation that runs on every motion has already
replaced them. Today the result is empty or partial with no explanation, which reads as "it
did not run". Now the result comes with a warning that names the automations and scripts whose
stored runs no longer reach back to the start of the window, how many runs each keeps, how to
keep more, and that the logbook holds the full history.

**Why this priority**: A silent empty result leads to a wrong conclusion. The warning prevents
that without changing the traces returned.

**Independent Test**: Against a simulated instance whose automation stores its maximum number of
runs, all later than the window start, run a windowed query and check the warning; then repeat
with an automation that stores fewer runs than its maximum and check there is none.

**Acceptance Scenarios**:

1. **Given** an automation that stores as many runs as it is allowed and whose oldest stored
   run started after the window start, **When** a windowed query selects it, **Then** the
   response carries a warning naming it, the number of runs it keeps, the setting that keeps
   more, and `ha_logbook_query` as the full history.
2. **Given** an automation that stores fewer runs than it is allowed, **When** the same query
   runs, **Then** there is no warning for it, because nothing of it was discarded.
3. **Given** a windowed query with no matching runs at all, **When** runs may have been
   discarded, **Then** the empty result still carries the warning.
4. **Given** a query with no window, or a query by `run` or `context`, **When** it runs,
   **Then** no warning is added; the existing not-found guidance is unchanged.
5. **Given** any query, **When** a warning is present, **Then** the trace document itself is
   identical to the one 0.1.1 returns for the same instance state.

---

### Edge Cases

- An `exclude` entry that matches nothing is not an error, as with `entities`.
- An `exclude` list that matches every selected entity gives a valid empty result, not an error.
- `exclude` follows the same validation as `entities` (non-empty strings, the same pattern
  syntax and limits); an invalid entry is refused with the same kind of error.
- An exact ID in `entities` that is also excluded is not reported as an entity with no events.
- The number of runs an automation or script keeps cannot be read from the instance: the
  warning assumes the instance's default (5) and says that it assumed it.
- A selection of many automations, several of them affected: the warning lists each affected
  one once, names at most 10, and says how many more there are past that.
- The server is installed both globally and through a cached on-demand copy: the version it
  reports tells which one answered.
- The README's commands must stay correct across patch releases without an edit per release.

## Requirements _(mandatory)_

### Functional Requirements

**Version (US1)**

- **FR-001**: The server MUST report, during the connection handshake, the name `domusops-mcp`
  and the version of the installed package.
- **FR-002**: The reported version MUST come from the package's own version at build or start,
  so no release requires a hand edit to keep them equal; a test MUST fail when they differ.

**Setup guidance (US2)**

- **FR-003**: The `@domusops/mcp` README MUST present, as the recommended way to run the server,
  installing it as a development dependency of the configuration repository (version pinned in
  that repository's lockfile, the MCP client running the binary from the repository's
  dependencies, the dependency folder kept out of version control). A global installation and
  the pinned on-demand form MUST be documented as alternatives. Each form has a configuration
  example.
- **FR-004**: The README MUST have a section for Claude Code covering: registering the server
  for one repository and for all of them, approving a server declared in a repository file,
  supplying the token from the environment so it never appears in a committed file, and a
  troubleshooting list for the causes named in US2 scenario 3.
- **FR-005**: The README MUST say, for each tool and detail level, which decoder in
  `@domusops/schema` reads the response, with one example that a test runs as written.
- **FR-006**: Commands and versions in the README MUST remain correct for every 0.1.x release,
  or a test MUST fail when they are not.

**Exclusion (US3)**

- **FR-007**: `ha_logbook_query` and `ha_trace` MUST each accept an optional `exclude` list of
  exact entity IDs and `*` patterns, with the same syntax, validation and limits as that tool's
  `entities`. In `ha_trace`, `exclude` is refused with `run` or `context`, as `entities` is.
- **FR-008**: Nothing of an excluded entity MAY appear in the result at any detail level: no
  logbook event, no trace run, no entity ID in any list of the document, and no mention in the
  discarded-runs warning. Every count and the size check MUST be computed after the exclusion.
  The logbook's list of selectors with no events keeps its 0.1.1 meaning (selectors that
  matched no event before the exclusion), except that an exact ID that is itself excluded is
  never listed; a selector whose events were all excluded is therefore not reported as having
  none. Logbook events with no entity are never excluded.
- **FR-009**: When `exclude` is given, the response MUST state the exclusion list that was
  applied, as a separate text block next to the document in the same response; the published
  formats do not change.
- **FR-010**: For the same inputs and instance state, the document in every response MUST be
  identical to 0.1.1's when `exclude` is absent. The only additions to a response are the notes
  of FR-009 and FR-013; a response that carries neither is exactly 0.1.1's single block.

**Trace warning (US4)**

- **FR-011**: When a query has a window (`start`, `end` or both), `ha_trace` MUST warn about
  every selected automation or script that stores as many runs as it is allowed and whose
  oldest stored run started after the window start (with no `start`, after the beginning of
  time), because runs inside the window may have been discarded.
- **FR-012**: The warning MUST name each affected automation or script, the number of runs it
  keeps, the setting that keeps more, and `ha_logbook_query` as the full history. It MUST NOT
  be raised for an item that stores fewer runs than it is allowed, nor for queries by `run` or
  `context`.
- **FR-013**: The warning MUST accompany the result, including an empty one, as a separate text
  block next to the document in the same response, and MUST NOT change the trace document, its
  counts or its size check.
- **FR-014**: The warning MUST name at most 10 affected automations or scripts, each once, and
  state how many more were affected past those 10.

**Cross-cutting**

- **FR-015**: No published format in `@domusops/schema` changes in this feature, and every
  compression floor stays where it is.
- **FR-016**: The feature MUST carry only patch changesets for `@domusops/mcp`, one per pull
  request, and none for any other package.
- **FR-017**: `ha_snapshot` MUST NOT change, and every existing output test of the three tools
  MUST pass with unchanged expectations.
- **FR-018**: Tests MUST use simulated instances or the sandbox, never a real instance, and no
  specification, fixture or test may contain data taken from a real home.

### Key Entities

- **Exclusion list**: entity IDs and patterns given with a logbook or trace query; removes
  matching entities from the result after `entities` is applied.
- **Discarded-runs warning**: a note returned next to a trace result that names the
  automations and scripts whose stored runs may not reach back to the window start, with the
  number of runs each keeps.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In 100% of starts, the version the server reports equals the installed package's
  version.
- **SC-002**: A person with no prior setup connects the server to Claude Code by following only
  the README, with zero steps taken from anywhere else.
- **SC-003**: With the recommended installation, starting the server makes zero requests to the
  package registry.
- **SC-004**: A logbook or trace query with an exclusion list returns zero events or runs of
  excluded entities, and on the reference logbook window a standard query refused for size fits
  once its noisiest entities are excluded.
- **SC-005**: In tests, a windowed trace query where runs were discarded carries the warning in
  100% of cases, and one where no automation reached its stored-run limit carries it in 0%.
- **SC-006**: Every existing output test of the three tools passes with zero edited
  expectations, and every compression floor is unchanged.
- **SC-007**: The release changes the version of `@domusops/mcp` only, to 0.1.2.

## Assumptions

- Folding the exclusion note and the trace warning into the published formats is left to a
  later format revision; this feature keeps them out of the documents (Clarifications).
- The number of runs each automation or script keeps can be read from the instance; when it
  cannot, the instance's documented default of 5 applies and the warning says so. The plan
  confirms how it is read.
- The README is the place for setup guidance; the `ha-bootstrap` skill and other skills are not
  changed by this feature.
- The recommended installation needs Node.js and npm on the machine that runs the MCP client,
  as the current one does, and adds a `package.json` to the configuration repository when it
  has none. The dependency folder is ignored by version control, so deploying the
  repository to the instance never copies it.
- Examples in this specification and in the README use invented entity names.

### Out of scope

- `ha_ping` and every other new tool: a new tool is a minor release (0.2.0).
- `ha_history`, `ha_state`, `ha_system_log`, a timeline detail level, user names in logbook
  causes, and any tool that changes the instance.
- Changes to `@domusops/schema`, `@domusops/sandbox` and `@domusops/bootstrap`.
