# Feature Specification: debt paydown — Close the Gaps Left After the 0.1.0 Release

**Feature Branch**: `007-debt-paydown`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: the debt carried past the 0.1.0 release of `@domusops/schema`,
`@domusops/mcp`, `@domusops/sandbox` and `@domusops/bootstrap`, collected from the code reviews
of features 001 to 005 and from the first release. One spec, six independently shippable user
stories, one pull request each, delivered from P1 to P3. Feature number 006 stays reserved for
the scenario and assertion DSL.

## Clarifications

### Session 2026-10-22

- Q: Until identity-based publishing has been proven, does the release workflow fall back to the
  stored publish token when it fails, or publish only through identity proof? → A: Identity
  proof only. The token stays stored but unused, and is deleted and revoked after the first
  successful publish through the new path (FR-006, FR-008).
- Q: When a Home Assistant release no longer supports time control but everything else works,
  how does it appear in the supported-versions table? → A: As failed, with the reason "time
  control unavailable"; the results format does not change (FR-017).
- Q: Do add-key and remove-key offer an explicit override when `.sops.yaml` was edited by hand?
  → A: No override. They refuse, and the message explains how to change the recipients by hand
  and re-encrypt with sops; the toolkit leaves a customised file alone, as `init` already does
  (FR-021).
- Q: How does cleanup treat tied instances created by the 0.1.0 sandbox, whose owner is
  identified by host name? → A: The 0.1.0 rule: removed when the host name matches and the owner
  process has exited; otherwise only their deadline removes them (FR-015).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Trace reads that fail fast and never hang (Priority: P1)

An agent asks `ha_trace` about automation runs. When one of the reads behind the answer fails,
the tool stops asking the instance for more and reports the failure at once, instead of
continuing to pull traces whose results will be thrown away. When the connection to the
instance is closed while requests are still waiting for an answer, every waiting request ends
with an error instead of waiting forever. Reads that do not depend on each other are made at
the same time. A `standard` request whose result is going to be refused as too large stops
reading as soon as that is certain, instead of reading every stored trace first.

**Why this priority**: These are correctness defects in a published tool. A request that never
settles leaves an agent stuck, and reads that are wasted or serialised make every call slower
and heavier on the user's instance than it needs to be.

**Independent Test**: Run `ha_trace` against a simulated instance that delays answers, fails a
chosen read, or closes the connection mid-request, and count the reads issued and the time each
request takes to settle.

**Acceptance Scenarios**:

1. **Given** a request that needs ten trace reads and a simulated instance that fails the third,
   **When** the tool runs, **Then** it returns the retrieval error and issues no read that had
   not already started when the failure arrived.
2. **Given** three requests waiting for an answer, **When** the connection is closed, **Then**
   all three end with an error that says the connection closed, and none of them is left
   waiting.
3. **Given** a request whose reads do not depend on each other and a simulated instance that
   answers each read after a fixed delay, **When** the tool runs, **Then** the total time is
   that of the longest chain of reads that depend on each other, not the sum of all the delays.
4. **Given** 500 stored runs and a `standard` request without selectors whose result exceeds
   the size limit, **When** the tool runs, **Then** it returns the existing too-large error after
   reading only part of the runs' full records, and the error says the result would exceed the
   limit.
5. **Given** a `standard` request whose result fits within the size limit, **When** the tool
   runs, **Then** its output is identical to the output before this change.

---

### User Story 2 - Releases published without a long-lived secret (Priority: P1)

The maintainer merges the "Version Packages" pull request and the packages are published to the
public registry by the release workflow, which proves its identity to the registry for that one
run instead of holding a long-lived publish token. Once that path has published successfully,
the stored token is deleted and revoked. The workflows run on current action versions without
deprecation warnings. Every published package has a README on its registry page, and the source
maps shipped in a package never point at files the package does not contain.

**Why this priority**: A long-lived publish token is the most valuable secret the project holds;
removing it closes the largest supply-chain risk before more people depend on the packages.
The deprecated runtime will stop working on a date the project does not control.

**Independent Test**: Publish a patch release through the workflow with no publish token stored
in the repository, then inspect the published packages on the registry: identity proof present,
README present, every source map resolvable from the package contents alone.

**Acceptance Scenarios**:

1. **Given** each package is registered on the registry as trusting this repository's release
   workflow, and no publish token is stored, **When** a "Version Packages" pull request is
   merged, **Then** the release workflow publishes every package with a pending version and the
   registry shows that each was published from this repository's workflow.
2. **Given** each package's trusted publisher names this repository and `release.yml` only,
   **When** the maintainer reviews the four package settings, **Then** no other repository,
   workflow file or environment is listed, so the registry refuses publishes from anywhere
   else.
3. **Given** any workflow run in the repository, **When** it completes, **Then** its log contains
   no warning that an action uses a deprecated runtime.
4. **Given** the published `@domusops/schema`, **When** a user opens its registry page, **Then**
   it shows a README that says what the package is, how to install it, and what stability it
   promises.
5. **Given** any published package, **When** a tool resolves the source maps inside it, **Then**
   every referenced source is either inside the package or embedded in the map.

---

### User Story 3 - A sandbox that keeps working across sessions and releases (Priority: P2)

A developer reattaches to a background sandbox instance from a new process and keeps adding
virtual devices to it, exactly as the process that started it could. Instances tied to a
process that has died are cleaned up even if the machine's name changed in the meantime, and an
instance whose owner is still alive is never removed. When a Home Assistant release no longer
offers what time control needs, time control fails with a clear error naming the cause instead
of an obscure one. The virtual-device integration the sandbox downloads is verified against an
immutable reference before it is installed.

**Why this priority**: These limits surface as soon as someone uses the sandbox beyond the smoke
check, which is the next feature's entire purpose (006 builds on the sandbox). They do not
affect what is already published as working.

**Independent Test**: Start a background instance with devices, attach to it from another
process and add a device; simulate a host-name change and run cleanup; start an instance on a
release without the time-control internals; tamper with the downloaded integration.

**Acceptance Scenarios**:

1. **Given** a background instance started with devices, **When** another process attaches to it
   and adds a device, **Then** the device is created and appears in that handle's device list.
2. **Given** a background instance started without devices, **When** an attached handle adds a
   device, **Then** it fails with the existing "virtual devices unavailable" error, which says
   the instance was started without devices.
3. **Given** a tied instance whose owning process has exited, and the machine's name has changed
   since the instance started, **When** cleanup runs on that machine, **Then** the instance is
   removed with the reason "owner process gone".
4. **Given** a tied instance whose owning process is still running, **When** cleanup runs,
   **Then** the instance is kept, whatever the machine's name is now.
5. **Given** a release on which time control's internals are missing, **When** a caller freezes
   or advances the clock, **Then** the call fails with an error that names time control as
   unavailable on that release, and the rest of the instance keeps working.
6. **Given** a downloaded virtual-device integration whose content does not match the pinned
   reference, **When** an instance starts with devices, **Then** the start fails with an
   integrity error and nothing from the download is installed.
7. **Given** the test that checks teardown output never contains the instance token, **When** the
   token-specific redaction is removed, **Then** that test fails.

---

### User Story 4 - Bootstrap that never clobbers or misleads (Priority: P2)

A user who followed the `ha-bootstrap` skill reads the instructions inside the files it
generated and finds commands that work as written, in the same pinned form the generated hooks
and workflow already use. When they add or remove a key, the tool refuses to rewrite a
`.sops.yaml` that someone has edited by hand, instead of silently replacing it. When a new
contributor runs `init` on a repository that already has encrypted secrets, the tool tells them
whether their key can decrypt those secrets and, if not, what an existing recipient must run.

**Why this priority**: Each of these can cost a user their configuration or an afternoon. They
are rare paths, but the cost when hit is high.

**Independent Test**: Generate a baseline and search its files for commands; hand-edit
`.sops.yaml` and run add-key and remove-key; run `init` with a key that is not a recipient.

**Acceptance Scenarios**:

1. **Given** a freshly generated baseline, **When** a user reads any generated file, **Then**
   every command it tells them to run is in the pinned form that works without a global
   install.
2. **Given** a `.sops.yaml` whose content differs from what the toolkit last wrote, **When** the
   user runs add-key or remove-key, **Then** the command makes no change, says that the file was
   edited outside the toolkit, and exits with a failure code.
3. **Given** a `.sops.yaml` the toolkit wrote and nobody changed, **When** the user runs add-key
   or remove-key, **Then** the behaviour is the same as today.
4. **Given** a repository with encrypted secrets and a local key that is not one of the
   recipients, **When** the user runs `init`, **Then** the report says the key cannot decrypt
   the secrets and the next steps include the add-key command an existing recipient must run,
   with the user's public key filled in.

---

### User Story 5 - MCP internals with one way to do each thing (Priority: P3)

A maintainer changing the MCP server finds each concern implemented once: one way to turn a
trace record into a reference, one path that maps errors to tool results, one comparator for
counts and keys, one table that describes each command, small helpers shared instead of copied,
and no dead branches.
Nothing a tool returns changes.

**Why this priority**: Pure maintainability. It lowers the cost and risk of every later MCP
change, but no user sees it.

**Independent Test**: The existing MCP test suite and its compression floors pass unchanged
before and after; the duplicated and dead code paths named in the source inventory no longer
exist.

**Acceptance Scenarios**:

1. **Given** the MCP test suite as it is before this story, **When** the story is complete,
   **Then** every existing test passes without its expectations being edited.
2. **Given** an instance that reports history as unavailable, **When** `ha_logbook_query` runs,
   **Then** it recognises the condition by the instance's error code, not by the wording of the
   message, and returns the same result as today.

---

### User Story 6 - Project instructions that match the project (Priority: P3)

An agent or contributor opening the repository reads a "current focus" that describes where the
project actually is after the 0.1.0 release, and the formatting check reports nothing on the
project's own instruction and package files.

**Why this priority**: Cheap and low-risk, but a stale "current focus" steers every new session
toward finished work.

**Independent Test**: Read the "current focus" section and run the formatter in check mode on
the named files.

**Acceptance Scenarios**:

1. **Given** the project instructions, **When** a session starts, **Then** the "current focus"
   names the released packages and the next planned feature, and no longer says the harness is
   in progress.
2. **Given** the project instruction file and the sandbox package manifest, **When** the
   formatter runs in check mode, **Then** it reports no difference.

---

### Edge Cases

- A trace read fails while other reads are already in flight: those reads may complete, but
  their results are discarded and the request reports only the failure; no partial result is
  returned (existing rule, feature 003 FR-018).
- The connection closes between a request being sent and its answer arriving, or is closed
  twice: every waiting request is settled exactly once, and a second close is harmless.
- The first release after the publishing change has nothing to publish: the stored token is
  kept until a release has actually published through the new path.
- A publish through the new path fails part-way (some packages published, some not): the next
  run publishes the remaining packages without republishing the ones already out.
- A package's registry trust is configured for the wrong workflow file or repository: the
  publish fails with the registry's refusal, and no package is published with a fallback secret.
- Cleanup runs on a different machine that shares the same container runtime: an instance tied
  to a process on another machine is never treated as orphaned by the process check alone; only
  its deadline reclaims it.
- The machine's name changes while a tied instance's owner is still running: the instance is
  kept.
- The pinned virtual-device integration's upstream repository rewrites or deletes the pinned
  release: the start fails with the integrity error, never with an unverified download.
- `.sops.yaml` exists but the toolkit has no record of writing it (created by hand before
  bootstrap): add-key and remove-key treat it as edited outside the toolkit, unless its content
  is exactly what the toolkit would generate for its recipients.
- `init` runs with no local key yet and existing encrypted secrets: the report says a new key
  was created, that it is not a recipient, and what an existing recipient must run.

## Requirements _(mandatory)_

### Functional Requirements

**MCP correctness (US1)**

- **FR-001**: When any trace read behind an `ha_trace` request fails, the tool MUST start no
  further trace reads for that request and MUST return the retrieval error with no partial
  result.
- **FR-002**: Closing the MCP server's connection to an instance MUST end every request still
  waiting on that connection with an error stating that the connection closed; no request may
  remain unsettled.
- **FR-003**: Reads made by one `ha_trace` request that do not depend on each other's results
  MUST be issued concurrently, within the existing limit on reads in flight.
- **FR-004**: At the `standard` detail level, the tool MUST stop reading full records as soon as
  the records already read prove that the result will exceed the size limit, and MUST then
  return the existing too-large error (same code and guidance), stating that the result exceeds
  the limit. A refusal MUST never happen for a result that would have fit.
- **FR-005**: US1 MUST NOT change any `ha_trace` output for the same instance state; existing
  output tests pass unchanged. The only error text that changes is the early too-large wording
  of FR-004.

**Release (US2)**

- **FR-006**: The release workflow MUST publish to the public registry by proving the identity of
  this repository's release workflow for each run. The workflow MUST NOT read or fall back to any
  long-lived publish credential; if identity proof fails, the publish fails.
- **FR-007**: Each published package MUST be configured on the registry to accept publishes only
  from this repository's release workflow; the maintainer performs this configuration, and the
  spec's quickstart lists the exact steps.
- **FR-008**: The stored publish token MUST be deleted from the repository and revoked on the
  registry only after at least one release has published successfully through the new path.
- **FR-009**: Every action used by the repository's workflows MUST run on a runtime that is not
  deprecated at the time of the change.
- **FR-010**: `@domusops/schema` MUST ship a README stating what the package is, how to install
  it, which formats it exports, and its stability promise under constitution §5.
- **FR-011**: Every source map shipped in any published package MUST resolve each source it
  references from the package contents alone, or the package MUST ship no source maps.
- **FR-012**: A test MUST fail when a packed package would contain a source map that references
  a source missing from the package.

**Sandbox (US3)**

- **FR-013**: A handle obtained by attaching to a running background instance that was started
  with devices MUST be able to add virtual devices with the same behaviour and errors as the
  handle of the process that started it.
- **FR-014**: Cleanup MUST identify the owner of a tied instance in a way that stays valid when
  the machine's name changes, MUST remove a tied instance whose owner process on this machine has
  exited, and MUST never remove a tied instance whose owner process is still running.
- **FR-015**: Instances created by the 0.1.0 sandbox, which carry the old ownership labels, MUST
  keep the 0.1.0 rule: removed when the recorded host name matches this machine's and the owner
  process has exited; otherwise removed only by their deadline.
- **FR-016**: When the time-control internals are not available on an instance's release,
  freezing or advancing time MUST fail with a dedicated error code and a message naming time
  control and the release; other operations on that instance MUST keep working.
- **FR-017**: The smoke check MUST report a release on which time control is unavailable as a
  failed run with the reason "time control unavailable", using the existing results format with
  no new outcome value, so the supported-versions table never lists it as passed.
- **FR-018**: The virtual-device integration MUST be fetched by an immutable upstream reference
  and verified against a digest of its content before anything is installed; a mismatch MUST
  fail the start with an integrity error.
- **FR-019**: The teardown-redaction test MUST use an instance token that only token-specific
  redaction would remove, so the test fails if that redaction is removed.

**Bootstrap (US4)**

- **FR-020**: Every command named in a file the bootstrap generates MUST use the same pinned,
  no-install form the generated hook and workflow already run.
- **FR-021**: add-key and remove-key MUST refuse, without changing any file, when `.sops.yaml`
  differs from the content the toolkit last recorded writing, or, with no such record, from what
  the toolkit would generate for its current recipients; the message MUST say that the file was
  customised and how to change its recipients by hand and re-encrypt the secrets with sops.
  There is no override option.
- **FR-022**: When encrypted secrets already exist, `init` MUST report whether the local key is
  one of their recipients and, when it is not, add a next step with the exact add-key command an
  existing recipient must run, including the local public key. This is reported, not a stop.

**MCP internals (US5)**

- **FR-023**: Each of the following MUST exist exactly once in the MCP package: the conversion of
  a trace record to a trace reference, the mapping of errors to tool results, the count-then-key
  comparator, and each small helper the review found copied between tool modules; each command
  the client sends MUST be described in one table.
- **FR-024**: The unreachable branches identified in the trace selection code MUST be removed.
- **FR-025**: `ha_logbook_query` MUST recognise unavailable history by the instance's structured
  error code.
- **FR-026**: Selecting logbook rows MUST evaluate the selectors once per distinct entity, not
  once per row.
- **FR-027**: US5 MUST NOT change any tool's output or error for the same inputs.

**Housekeeping (US6)**

- **FR-028**: The project instructions' "current focus" MUST describe the post-0.1.0 state: the
  four published packages and the next planned feature.
- **FR-029**: The project instruction file and the sandbox package manifest MUST pass the
  formatter's check.

**Cross-cutting**

- **FR-030**: Each user story MUST ship as one pull request with the lint, type and test gate
  green, and MUST be mergeable on its own in priority order.
- **FR-031**: Every story that changes what a package's users see (US1 to US4) MUST carry a
  changeset for each affected package; US5 and US6 MUST carry none.
- **FR-032**: No story may change the published `@domusops/schema` formats.
- **FR-033**: Nothing in this feature may connect to a real Home Assistant instance; every test
  uses a simulated instance or the sandbox.

### Source debt inventory

For traceability only; the requirements above are the contract.

- **US1**: `getTraces` keeps pulling after a failed `trace/get`; `HaClient.close()` drops
  pending commands; sequential round trips in `tools/ha-trace.ts`; without selectors,
  `detail=standard` reads every stored trace before the size limit is applied.
- **US2**: `NPM_TOKEN` in `release.yml`; Node 20 deprecation warnings on the `@v4` actions; no
  README in `@domusops/schema`; source maps pointing at the unpublished `src/`.
- **US3**: attached handles cannot `addDevices`; reaper ownership keyed on the host name; time
  control depends on Home Assistant internals; the teardown-redaction test passes because the
  test token is JWT-shaped; hass-virtual pinned by a GitHub archive SHA-256 (trust on first use).
- **US4**: bare `domusops-bootstrap` in generated templates; `.sops.yaml` overwritten by
  add/remove-key; no recipient membership check in `init`.
- **US5**: duplicate `refOf`; error-mapping try/catch copied three times in `server.ts`; dead code
  in `trace/select.ts` (`created === null`, redundant alternative in `parseContextId`);
  `history_unavailable` matched by message; selectors evaluated per row in `selectRows`; the
  escape-shape check copied from the schema's logbook decoder into the MCP logbook encoder, and
  other small copied helpers (`isObject`, `pad`); repeated count/key comparator; per-command
  branches in `HaClient.command`.
- **US6**: stale "Current focus" in `CLAUDE.md`; Prettier differences in `CLAUDE.md` and
  `packages/sandbox/package.json`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After the first failed trace read in a request, the number of further reads started
  is zero.
- **SC-002**: When a connection closes with any number of waiting requests, 100% of them settle
  with an error within one second.
- **SC-003**: A request whose reads each take a fixed delay completes in the time of its longest
  chain of dependent reads, at most 5 delays for a request for one run, where reading them one
  after another takes 6 plus the time of the trace read itself.
- **SC-004**: A `standard` request over 500 stored runs whose result exceeds the default size
  limit is refused after reading fewer than half of the runs' full records; a request whose
  result fits is never refused.
- **SC-005**: The first release after US2 publishes all pending packages with zero long-lived
  publish credentials stored in the repository, and the registry page of each published version
  shows that it came from this repository's workflow.
- **SC-006**: Workflow runs on `main` after US2 show zero deprecated-runtime warnings.
- **SC-007**: All four packages show a README on the registry, and 100% of the source maps in
  each packed package resolve from the package alone.
- **SC-008**: In tests, 100% of tied instances whose owner has exited are removed after a
  host-name change, and 0% of instances whose owner is alive are removed.
- **SC-009**: A tampered or substituted integration download is installed 0 times; the start
  fails with the integrity error.
- **SC-010**: A generated baseline contains zero commands that need a global install to run.
- **SC-011**: add-key and remove-key against a hand-edited `.sops.yaml` change zero files.
- **SC-012**: After US5, the MCP test suite passes with zero edited expectations, and every
  compression floor is unchanged.
- **SC-013**: All six stories merge as six pull requests, each with the gate green at merge.

## Assumptions

- The sandbox's own WebSocket client already rejects every pending command when it closes, so
  FR-002 concerns the MCP client only.
- The repository is public and the registry supports identity-based publishing from its hosted
  workflows; this is what makes publishing without a stored token possible and gives each
  version a visible origin.
- The maintainer has owner rights on every `@domusops` package on the registry and does the
  per-package trust configuration by hand; it cannot be done from the repository.
- Until a release publishes through the new path, the stored token stays in the repository's
  secrets but no workflow reads it; deleting and revoking it is a follow-up step of US2, not part
  of the same change.
- Source maps stay useful to users: the preferred outcome is maps that carry or ship their
  sources, not removing maps. Which of the two is chosen is a planning decision.
- Ownership of a tied instance can be identified by something about the machine that survives a
  host-name change; if nothing reliable exists on a platform, the instance falls back to being
  reclaimed only by its deadline, which is already bounded.
- Time-control availability is detected per instance at the moment time is first used, not
  predicted from the release number.
- The virtual-device integration stays the existing community integration at its current pinned
  release; only how the download is identified and verified changes.
- For add-key and remove-key, "what the toolkit last wrote" is the content recorded by the
  bootstrap's existing record of generated files.
- US1 to US4 change user-visible behaviour, so each carries a patch-level changeset for the
  affected packages; whether a new capability (for example devices on attached handles) warrants
  a minor bump is a planning decision under the 0.x rules.
- Already-merged process items are excluded: the `sandbox-gate` check is already required on
  `main`.

### Out of scope

- The SEED §7 articles for backlog items 3, 4 and 5: their drafts live outside this repository
  (SEED §7).
- The scenario and assertion DSL (feature 006).
- Changing how the virtual-device integration names devices. Its requirement that device names
  be unique across device kinds stays a documented limit. Whether upstream would accept a change
  is recorded as an open question in the plan's research, not pursued here.
- Any change to the `@domusops/schema` formats.
