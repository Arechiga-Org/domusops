# Feature Specification: ha_snapshot — Compressed Instance Inventory

**Feature Branch**: `001-ha-snapshot`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: `docs/SEED.md` §5, "Feature: `ha-snapshot`", passed verbatim.

## Clarifications

### Session 2026-09-23

- Q: Does the snapshot include each entity's current state and attributes? → A: Yes. The
  snapshot includes the registries plus the current state and attributes of every entity,
  including entities that exist only in the state machine (no registry entry).
- Q: Must `standard` be lossless relative to `full`? → A: No. `standard` preserves every
  identifier and every relationship, and may omit a closed, published list of fields that carry
  no meaning for an agent (such as internal registry record IDs and record creation/modification
  timestamps). `full` remains the escape hatch that includes them.
- Q: `detail=full` as a raw passthrough conflicts with constitution §4 ("Raw passthrough of Home
  Assistant API responses is a defect"). How is `full` defined? → A: `full` is lossless: the
  `standard` encoding without the omission list. It keeps every field and stays compressed.
- Q: The seed's acceptance criterion requires `npx @domusops/mcp`, but npm publishing is not
  configured. How is it verified in this feature? → A: With the packed packages in a Node-only
  environment; publishing to npm is a separate release step.
- Q: Config entry titles often contain e-mail addresses. Are they redacted? → A: Yes. E-mail
  addresses are redacted in every non-identifier value (FR-024).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Full inventory within the context budget (Priority: P1)

A Home Assistant user working with a coding agent asks a question about their installation. The
agent invokes `ha_snapshot` once, with no parameters, and receives every entity (with its current
state and attributes), device, integration, and area, plus the core version, grouped and
compressed so that the result fits in the agent's context alongside the real task.

**Why this priority**: This is the whole value of the feature. Without it, the agent either
cannot see the installation or fills its context with repetitive registry data before any work
begins.

**Independent Test**: Run the tool against the 500-entity reference fixture at the default detail
level. Confirm that every entity ID present in the raw retrieved data (registries and states)
appears in the output and that the reported compression ratio is at least 10.

**Acceptance Scenarios**:

1. **Given** a reachable instance and a valid token, **When** the agent invokes `ha_snapshot`
   with no parameters, **Then** it receives a `standard` snapshot containing every entity ID,
   every device, every area, every integration, the core version, and a `compression_ratio`.
2. **Given** the 500-entity reference fixture, **When** a `standard` snapshot is produced,
   **Then** `compression_ratio` is at least 10.
3. **Given** many entities that belong to the same integration and domain, **When** a `standard`
   snapshot is produced, **Then** they appear grouped under that integration and domain, not as a
   flat list.
4. **Given** many entities that share the same attribute structure, **When** a `standard`
   snapshot is produced, **Then** that structure is defined once and referenced by each entity.
5. **Given** entity fields that hold their default value, **When** a `standard` snapshot is
   produced, **Then** those fields are omitted.
6. **Given** an instance with 1,000 entities, **When** the tool is invoked, **Then** the complete
   result is returned in under five seconds.

---

### User Story 2 - Secrets never reach the agent (Priority: P1)

Snapshot output flows into an agent's context and, from there, into model providers, transcripts,
and logs. The user must be able to invoke the tool without any risk that tokens, passwords, API
keys, or location coordinates leave their machine inside the output.

**Why this priority**: A single leaked credential or home location is a severe, irreversible
harm. This story is release-blocking: User Story 1 cannot ship without it.

**Independent Test**: Run every detail level against a redaction fixture that plants a known token
in an entity attribute, embeds another inside a URL-like value, and includes home and entity
coordinates. Search each output for any fragment of the planted secrets and coordinates.

**Acceptance Scenarios**:

1. **Given** a fixture containing a token in an entity attribute, **When** a snapshot is produced
   at any detail level, **Then** the output contains no fragment of that token.
2. **Given** a secret embedded inside a larger value (for example, an access token in a URL query
   string), **When** a snapshot is produced, **Then** the secret does not appear in the output.
3. **Given** latitude and longitude values in the core configuration or in any entity attribute,
   **When** a snapshot is produced, **Then** those values do not appear in the output.
4. **Given** `detail` set to `full`, **When** a snapshot is produced, **Then** redaction still
   applies; `full` disables the omission list, never redaction.
5. **Given** a value that was redacted, **When** the agent reads the output, **Then** the field is
   still present and explicitly marked as redacted, so the agent knows a value existed.

---

### User Story 3 - Loud, actionable failure (Priority: P2)

When the tool cannot produce a complete snapshot, the user and the agent learn exactly why and
what to do next. The tool never hands back an incomplete inventory that looks complete.

**Why this priority**: A silently partial snapshot is worse than no snapshot, because the agent
will reason confidently from missing data. Clear errors also make first-time setup succeed.

**Independent Test**: Invoke the tool with a missing token, an invalid token, an unreachable host,
an unsupported instance version, and a non-administrator token. Confirm each produces a distinct,
actionable error and no snapshot.

**Acceptance Scenarios**:

1. **Given** the token environment variable is not set, **When** the tool is invoked, **Then** it
   returns an error naming the missing variable and how to create a long-lived access token.
2. **Given** the instance rejects the token, **When** the tool is invoked, **Then** it returns an
   authentication error and no snapshot.
3. **Given** the host is unreachable or does not respond in time, **When** the tool is invoked,
   **Then** it returns an error naming the address it tried and suggesting what to check.
4. **Given** the instance runs a version below the minimum supported version, **When** the tool
   is invoked, **Then** it returns an error stating both the detected and the minimum version.
5. **Given** the token belongs to a user without administrator privileges, **When** the tool is
   invoked, **Then** it returns an error saying so and why (a non-administrator user can receive
   a filtered set of states).
6. **Given** any single retrieval fails partway through, **When** the tool is invoked, **Then** the
   whole call fails with an error identifying the failed retrieval, and no partial snapshot is
   returned.

---

### User Story 4 - Choose the level of detail (Priority: P2)

Sometimes the agent only needs orientation ("how big is this installation, what integrations
does it use?"); occasionally it needs every field, including those `standard` omits. The `detail` parameter covers
both ends without changing the default experience.

**Why this priority**: `summary` keeps orientation cheap and `full` is the escape hatch when the
compressed form hides something the agent needs. The default (`standard`) already delivers the
core value, so this story extends it rather than enabling it.

**Independent Test**: Invoke the tool against the reference fixture with each detail value and
with an invalid value. Confirm the shape of each response and the rejection of the invalid value.

**Acceptance Scenarios**:

1. **Given** `detail` set to `summary`, **When** the tool is invoked, **Then** the response
   contains counts and topology only: total entities, devices, areas, and integrations; entity
   counts per integration and per domain; each area with its device and entity counts; the core
   version; and no per-entity listing.
2. **Given** `detail` set to `full`, **When** the tool is invoked, **Then** the response contains
   every retrieved field of every record, including those `standard` omits, in the same lossless
   encoding as `standard`, redacted, with a `compression_ratio`.
3. **Given** `detail` is omitted, **When** the tool is invoked, **Then** the response is a
   `standard` snapshot.
4. **Given** an unrecognised `detail` value, **When** the tool is invoked, **Then** it is rejected
   with an error listing the accepted values, and no snapshot is returned.

---

### User Story 5 - Zero-setup start (Priority: P3)

A user adds DomusOps to their agent's MCP configuration and it works, with nothing to build or
install beyond the Node runtime they already have.

**Why this priority**: Friction at install time loses users before they see any value, but the
tool's behaviour (Stories 1 to 4) matters more than its packaging.

**Independent Test**: On a clean machine with only Node 22 LTS installed, start the server through
the package runner and list the tools it advertises.

**Acceptance Scenarios**:

1. **Given** a clean machine with only Node 22 LTS installed, **When** the user runs
   `npx @domusops/mcp`, **Then** the server starts and advertises `ha_snapshot` to the connected
   client, with no other runtime, toolchain, or manual build step required.

---

### Edge Cases

- **Entities outside the entity registry** (defined without a unique ID) exist only in the state
  machine. They are included, grouped by domain, and marked as not registry-backed; they have no
  device and no area.
- **Integrations without a config entry** (configured in YAML): their entities are grouped under
  the integration name and marked as not backed by a config entry.
- **Entities without a device, devices without an area, and entities whose area differs from
  their device's area** are represented faithfully; an entity's own area is shown wherever it
  differs from its device's area.
- **Disabled and hidden entities** are included, with their disabled or hidden status preserved.
- **Orphaned references** (a reference to a device, config entry, area, or entity that does not
  exist in the snapshot) are preserved and flagged, never dropped.
- **An empty instance** (no user-created entities) produces a valid snapshot with zero counts and
  a well-defined `compression_ratio`, not an error.
- **Instances larger than 1,000 entities** still return a complete snapshot; the output is never
  silently truncated.
- **Non-ASCII names and identifiers** (for example, accented area names) are preserved exactly.
- **A secret-shaped string inside an entity ID** is not redacted, because identifiers are always
  preserved (see FR-017).
- **The instance changes during retrieval** (an entity is added between two registry reads): the
  snapshot reflects what each retrieval returned; any resulting dangling reference is flagged as
  an orphan.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST expose exactly one tool for this feature, named `ha_snapshot`
  (read-only; see FR-018).
- **FR-002**: The system MUST connect to a single Home Assistant instance over its WebSocket API,
  authenticating with a long-lived access token read from an environment variable. The token MUST
  NOT be accepted as a tool parameter and MUST NOT appear in any output, log line, or error
  message.
- **FR-003**: The system MUST retrieve the entity registry, device registry, area registry, config
  entries, core version, and the current state and attributes of every entity, including entities
  that have no entity registry entry.
- **FR-004**: The tool MUST accept an optional `detail` parameter with the values `summary`,
  `standard`, and `full`. When omitted, the value MUST be `standard`. Any other value MUST be
  rejected with an error listing the accepted values.
- **FR-005**: At `standard` detail, entities MUST be grouped by integration and then by domain,
  not listed flatly.
- **FR-006**: At `standard` detail, attribute structures shared by multiple entities MUST be
  defined once as templates within the same response and referenced by each entity that uses
  them.
- **FR-007**: At `standard` detail, fields holding their default value MUST be omitted. The set of
  defaults MUST be part of the published snapshot format, so that an absent field has exactly one
  meaning.
- **FR-008**: At `standard` and `full` detail, every entity ID present in the retrieved raw data
  MUST appear in the output.
- **FR-009**: At `standard` detail, the representation MUST be structurally faithful to the
  retrieved data: every identifier and every relationship (entity to device, integration, and
  area; device to area and config entry) MUST be preserved. `standard` MAY omit only the fields on
  a closed list of fields that carry no meaning for an agent, such as internal registry record IDs
  and record creation/modification timestamps. The exact list is fixed during planning and
  published as part of the snapshot format (FR-021); every field not on it is preserved. `full`
  includes all of them.
- **FR-010**: At `summary` detail, the response MUST contain counts and topology only, as defined
  in User Story 4, and MUST NOT list individual entities.
- **FR-011**: At `full` detail, the response MUST contain every retrieved field of every record,
  including the fields `standard` omits (FR-009), in the same lossless encoding as `standard`
  (grouping, templates, aliases, default elision). Redaction MUST still apply. A raw passthrough
  is not permitted (constitution §4).
- **FR-012**: Every successful response, at every detail level, MUST include a
  `compression_ratio` field equal to the serialised size of the raw retrieved payload divided by
  the serialised size of the emitted payload.
- **FR-013**: The system MUST redact secrets (access tokens, passwords, API keys, and other
  credentials), detecting them both by field name and by value content, including secrets embedded
  inside larger values such as URLs.
- **FR-014**: The system MUST redact geographic coordinates (latitude and longitude) wherever
  they appear, including the core configuration and entity attributes.
- **FR-015**: Redaction MUST be applied to the retrieved data before it is serialised for output.
  Unredacted values MUST NOT be part of any emitted response; the raw serialisation used to compute
  `compression_ratio` is measured and discarded, never emitted.
- **FR-016**: A redacted value MUST be replaced by an explicit redaction marker; the field itself
  MUST remain present.
- **FR-017**: Identifiers (entity IDs, device IDs, area IDs, and config entry IDs) MUST NOT be
  redacted.
- **FR-018**: The tool MUST NOT change the instance's state or configuration under any parameter
  combination.
- **FR-019**: The tool MUST fail with a distinct, actionable error, and return no snapshot, when:
  the required configuration is missing; the token is rejected; the host is unreachable or does
  not respond in time; the instance version is below the minimum supported version; the token does
  not belong to an administrator user (required for unfiltered state reads); or any individual
  retrieval fails.
- **FR-020**: The tool MUST NOT return a partial snapshot under any circumstances. A response is
  either a complete snapshot or an error.
- **FR-021**: The snapshot format MUST be a versioned, publicly documented contract, and every
  response MUST declare the format version it conforms to.
- **FR-022**: The MCP server MUST be startable with `npx @domusops/mcp` on a machine with only
  Node 22 LTS installed, and MUST advertise `ha_snapshot` once started. Within this feature this
  is verified with the packed packages in a Node-only environment; publishing to npm is a
  separate release step.
- **FR-023**: The project MUST maintain a representative 500-entity reference fixture, and
  automated checks MUST fail if the `standard` compression ratio on that fixture falls below 10.
  The tool's description MUST state its expected compression ratio (constitution §4).
- **FR-024**: The system MUST redact e-mail addresses in every value except the identifier fields
  exempted by FR-017, including config entry titles.

### Key Entities _(include if feature involves data)_

- **Instance**: The live Home Assistant installation being inventoried. Identified by its address;
  reports a core version.
- **Entity**: A single controllable or observable item, identified by its entity ID. Belongs to a
  domain (such as `light` or `sensor`), has a current state and attributes, is usually provided by
  an integration, and may belong to a device and to an area. It may or may not have an entity
  registry entry.
- **Device**: A physical or logical device that groups entities. May belong to an area and is
  associated with one or more config entries.
- **Area**: A user-defined location (such as a room) to which devices and entities are assigned.
- **Integration / config entry**: A configured integration instance that provides devices and
  entities.
- **Snapshot**: The response of one `ha_snapshot` invocation. Has a detail level, a format
  version, a `compression_ratio`, and the inventory content appropriate to its detail level.
- **Template**: A shared attribute structure defined once within a snapshot and referenced by the
  entities that use it.
- **Redaction marker**: The explicit placeholder that replaces a secret or coordinate value.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the 500-entity reference fixture, the default snapshot is at least 10 times
  smaller than the raw data it represents.
- **SC-002**: 100% of entity IDs present in the raw retrieved data (registries and states) appear
  in the default and `full` snapshots, verified by an automated round-trip check.
- **SC-003**: Zero fragments of any planted secret or coordinate appear in the output of any
  detail level across the redaction fixture set.
- **SC-004**: On an instance with 1,000 entities, a complete snapshot is returned in under five
  seconds.
- **SC-005**: Each of the six failure conditions in FR-019 produces an error that names its cause
  and a next step, and zero of them produce a partial snapshot.
- **SC-006**: Invoking the tool with every combination of parameters causes zero changes to the
  instance's state or configuration.
- **SC-007**: A user on a clean machine with only Node 22 LTS gets the tool running with a single
  command and no additional installs.
- **SC-008**: Against the maintainer's live instance, the tool returns a complete inventory and the
  resulting compression ratio is recorded.

## Assumptions

- The instance address is supplied through configuration alongside the token (an environment
  variable by default). Exact variable names are decided during planning.
- One server process targets one instance.
- The token belongs to an administrator user. The registries are readable by any user, but the
  instance filters entity states by user permissions, so a non-administrator token could yield
  registry entries without their states: a silently partial snapshot (FR-020). A
  non-administrator token is therefore a handled failure (FR-019), not a supported mode.
- "Version mismatch" means the instance reports a core version below the minimum supported
  version. The minimum is set during planning, consistent with the supported-version matrix of
  constitution §8.
- `compression_ratio` compares byte lengths of UTF-8 serialisations. The raw side is the retrieved
  payloads as returned by the instance, before redaction and compression.
- "No substring of that token" is interpreted as: no contiguous fragment of six or more characters
  of the planted secret appears in the output. Redaction fixtures use high-entropy secrets so that
  accidental matches with legitimate content are negligible.
- The five-second target assumes the instance is on the local network and not under abnormal load.
- HACS-specific metadata (repositories, installed versions) is out of scope for this feature.
  `docs/SEED.md` §2.1 lists HACS components in the `ha_snapshot` contract, but §5, the input for
  this spec, does not. Custom integrations installed through HACS still appear like any other
  integration, through their config entries.
- The live-instance acceptance check (SC-008) is performed manually by the maintainer. Automated
  checks run against fixtures only, because no live instance is available in CI and the sandbox is
  out of scope.
- Point-in-time consistency across separate retrievals is not guaranteed; see Edge Cases. Entity
  states are captured as they were at retrieval time; the snapshot does not track later changes.
- Publishing `@domusops/*` to npm is a separate release task (npm authentication is not
  configured in the `release` workflow yet). SC-007 is verified with the packed tarballs.

### Out of Scope

Diffing, writing, service calls, log retrieval, the sandbox, and anything in `domusops-pro`.
