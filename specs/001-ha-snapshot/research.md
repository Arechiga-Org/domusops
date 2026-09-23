# Research: ha_snapshot

Phase 0 output for [plan.md](./plan.md). Every open question from the Technical Context is
resolved here. Facts about the Home Assistant WebSocket API were verified against the
`home-assistant/core` source (`dev` branch) and the developer documentation on 2026-09-23, not
recalled from memory.

## R1. Home Assistant commands and privileges

**Decision**: Use seven read-only commands over one WebSocket connection:

| Purpose                 | Command                       | Admin required                       |
| ----------------------- | ----------------------------- | ------------------------------------ |
| Identity check          | `auth/current_user`           | No                                   |
| Core config and version | `get_config`                  | No                                   |
| Entity states           | `get_states`                  | No, but filtered by user permissions |
| Entity registry         | `config/entity_registry/list` | No                                   |
| Device registry         | `config/device_registry/list` | No                                   |
| Area registry           | `config/area_registry/list`   | No                                   |
| Config entries          | `config_entries/get`          | No                                   |

The tool requires the token's user to be an administrator (`is_admin: true` from
`auth/current_user`) and fails otherwise.

**Rationale**: None of the read commands require admin, but `get_states` returns only the states
the user may read, while the registries are unfiltered. A restricted user would produce registry
entries without states, which is a silently partial snapshot (FR-020). Admins always see every
state, so requiring admin is the only way to guarantee completeness. The spec's original rationale
("registries require admin") was wrong and has been corrected in the spec's Assumptions.

**Alternatives considered**:

- _Accept any user and detect filtering_: not possible. An entity with a registry entry and no
  state is normal (disabled entities have no state), so filtering cannot be told apart from
  legitimate absence.
- _`config/entity_registry/list_for_display`_: a compact, abbreviated form made for the frontend.
  It omits fields the spec requires (`config_entry_id`, `disabled_by`, `options`) and filters out
  disabled entities.

## R2. Authentication handshake and version check

**Decision**: On connect, read `auth_required.ha_version` and compare it with the minimum
supported version **before** sending the token. Then send `auth` with the token and expect
`auth_ok`. `auth_invalid` is an authentication failure (the server closes the connection).

**Rationale**: The version is announced before authentication, so an unsupported instance is
rejected without ever sending it a credential.

**Minimum supported version**: `2025.1.0`. Every command and field the tool depends on exists
there, and the parser treats fields added later (for example `config_subentry_id`) as optional.
Version strings are parsed as `YEAR.MONTH.PATCH`. Beta (`2026.10.0b3`) and dev
(`2026.10.0.dev20260915`) builds compare by their base version.

This floor is a **refusal threshold, not a support claim**. Constitution §8 forbids claiming
version support that CI has not proven, and the sandbox that will prove it is out of scope. Until
then, no document lists supported or verified versions. The versions checked (the fixture model
and the maintainer's live instance, SC-008) are recorded only in the pull request that delivers
this feature.

**Alternatives considered**: a floor at "previous stable" (too strict, since users lag behind
releases), or no floor at all (the spec requires a version-mismatch failure).

## R3. WebSocket client

**Decision**: Use Node 22's built-in global `WebSocket` behind a thin client module (`ha/client`).
It is the only module that talks to Home Assistant (technical constraint in `docs/SEED.md` §4).
After `auth_ok`, all six data commands are sent immediately with unique integer IDs and the
results are awaited together (pipelining), so latency is one round trip, not six.

The client exposes only an allowlist of the seven read commands above. Any other command type is
rejected before it reaches the socket, which enforces FR-018 (read-only) structurally rather than
by convention.

**Rationale**: No runtime dependency is needed (the "clean machine with only Node 22" criterion),
and a single-shot read needs neither reconnection nor subscriptions.

**Alternatives considered**: `home-assistant-js-websocket` (the official frontend library). It is
built around browsers, reconnection, and subscriptions, and would still need a WebSocket
implementation injected. The `ws` package works but is unnecessary at runtime on Node 22; it is
used only as a **dev** dependency, to run a fake Home Assistant server in integration tests.

**Timeouts**: 10 s to connect and authenticate, 10 s per command, 30 s overall deadline. Any
timeout is an unreachable/timeout failure (FR-019). The five-second target (SC-004) is for
successful runs; the timeouts bound failure latency.

## R4. Configuration

**Decision**: Two environment variables:

- `DOMUSOPS_HA_URL`: base URL of the instance, for example `http://homeassistant.local:8123`.
  `http` maps to `ws://…/api/websocket` and `https` to `wss://…/api/websocket`.
- `DOMUSOPS_HA_TOKEN`: a long-lived access token.

Both are validated when the tool is invoked (not at server start), so the server can still start
and advertise the tool, and a missing variable produces an actionable tool error (FR-019).

**Rationale**: Namespaced names avoid collisions in the shared environment of an MCP client
configuration.

**Alternatives considered**: `HASS_SERVER`/`HASS_TOKEN` (used by `hass-cli`). Reading them as a
fallback would be convenient, but it is an implicit behaviour with no requirement behind it
(YAGNI). It can be added later if users ask for it.

## R5. MCP server and tool result

**Decision**: `@modelcontextprotocol/sdk@1.30.1` (latest; already resolved in `pnpm-lock.yaml`
with `zod@4.6.5`), stdio transport, `McpServer.registerTool`.

- Input schema: `{ detail?: "summary" | "standard" | "full" }` (zod enum, default `standard`).
- Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
  `openWorldHint: true`.
- Result: a single `text` content block containing the **minified JSON** snapshot. No
  `structuredContent` and no `outputSchema`.
- Failures: a tool result with `isError: true` and an actionable message. Protocol-level errors
  are not used for domain failures, so the agent always sees the remediation text.

**Rationale**: The MCP specification recommends that a tool returning `structuredContent` also
return the same data as text. Many clients put both into the model's context, which would double
the payload and defeat constitution §4. The format is still machine-checkable: its JSON Schema is
published in `@domusops/schema`.

**To verify during implementation**: how SDK 1.30.1 reports an input that fails zod validation
(an `isError` tool result or a protocol `InvalidParams` error). Either satisfies the spec
(User Story 4, scenario 4) as long as the message lists the accepted values; a test pins the
observed behaviour.

## R6. Compression approach for `standard`

**Decision**: Lossless relative to a documented projection (spec, Clarifications Q2):

1. **Projection**: remove the fields on the closed omission list (see
   [data-model.md](./data-model.md#omitted-fields)).
2. **Default elision**: remove fields equal to their published default.
3. **Grouping**: integration → config entry → domain.
4. **Templates**: entities in a domain group are partitioned by the _shape_ of their record (the
   set of non-default keys). Keys whose value is constant across a partition go into the
   template; the remaining keys become positional columns. Partitions of size one are emitted
   inline, without a template.
5. **Aliases**: devices and config entries get short local aliases (`d12`, `e3`). The full ID is
   emitted exactly once, in the definition of the alias.
6. **Entity IDs are emitted in full** in every row, never split into domain and object ID.

The output is deterministic: identical input produces byte-identical output (stable sort orders,
stable alias and template numbering). This is required for fixtures and useful to `ha_diff`
later.

**Rationale and budget**: the estimates below come from the verified serializer field lists.
Raw data per entity is about 1.1–1.3 KB (state ~600 B, registry entry ~450 B, amortised device
~200 B). The 10× floor therefore allows about 110–130 B per entity in `standard`. An entity ID
(~30 B), a state value, a device alias, and a few variable attribute values fit. Per-entity key
names (the dominant cost in raw JSON), per-entity 32-character device IDs, and 26-character config
entry IDs would not. That is why columns, aliases, and grouping are all needed together.

**Alternatives considered**:

- _Generic compression (gzip + base64)_: a model cannot read it, so it is not a representation an
  agent can hold.
- _A custom line-based text format_: fewer tokens per entity, but no JSON Schema, harder for
  `ha_diff` and skills to consume, and a second parser to maintain. It can be revisited if the
  live ratio (SC-008) falls short.
- _Splitting entity IDs into domain + object ID_: saves bytes, but agents must reconstruct IDs
  exactly to call services, and reconstruction errors are silent. Rejected.

## R7. Compression ratio measurement

**Decision**: `compression_ratio = raw_bytes / emitted_bytes`, rounded to two decimals.

- `raw_bytes`: the sum, over the six data retrievals, of the UTF-8 byte length of
  `JSON.stringify(result)`, measured before redaction. The unredacted serialisation is measured
  and discarded (FR-015).
- `emitted_bytes`: the UTF-8 byte length of the minified output document, serialised with
  `compression_ratio` set to `0`. This breaks the circular dependency (the ratio's own digits
  would otherwise change the size it measures); the error is at most a few bytes.

**Alternatives considered**: counting tokens. That depends on the tokenizer, and none is
canonical across MCP clients; bytes are deterministic and reproducible in CI.

## R8. Redaction

**Decision**: A single pass over the retrieved data, before any serialisation for output, with
four rule families (full rule table in [data-model.md](./data-model.md#redaction-rules)):

1. **Key names**: keys whose normalised tokens match a credential vocabulary (token, password,
   secret, API key, credential, authorization, webhook ID, and similar).
2. **Values**: URL query parameters with credential-like names, passwords in URL user info,
   JWT-shaped strings, `Bearer` values, any exact occurrence of the configured
   `DOMUSOPS_HA_TOKEN`, and e-mail addresses (FR-024).
3. **Coordinates**: `latitude`, `longitude`, `elevation`, and `gps`/`location` pairs, at any
   depth.
4. **Replacement**: the secret part is replaced with the marker `[redacted]`. Inside a larger
   string, only the secret substring is replaced (for example, a camera's `entity_picture` keeps
   its path). The field is always kept (FR-016).

Redaction runs identically for all three detail levels. False positives (redacting something
harmless, such as a `token_expiry` timestamp) are accepted; false negatives are not.

**Personal data**: config entry titles often contain e-mail addresses (for example cloud
integrations). They are redacted by rule V6 (spec FR-024). Other account names without an e-mail
shape are not detected; that limitation is accepted for this feature.

**Rationale for identifiers**: identifiers are never redacted (FR-017). Hardware identifiers
(MAC addresses in `connections`, vendor `identifiers`) are not needed by an agent and are on the
omission list of `standard`, so they only appear in `full`.

## R9. Test strategy and fixtures

**Decision**:

- **Runner**: Vitest (existing). Tests live in `packages/<pkg>/test/`.
- **Reference fixtures**: a deterministic, seeded generator
  (`packages/mcp/test/fixtures/generate.ts`) builds raw payloads in the exact shapes of the
  verified serializers: 500 entities (compression floor) and 1,000 entities (performance). The
  domain and integration mix is modelled on typical installations (sensors dominant, then binary
  sensors, lights, switches, automations, updates, and a few cameras, media players, climate
  devices, people, and zones).
- **Redaction fixture**: small and hand-written, with planted high-entropy secrets in every
  position the rules cover: attribute, nested option, URL query, URL user info, JWT, config entry
  title, and core config coordinates.
- **Fake Home Assistant**: a `ws` (dev dependency) server that speaks the handshake and serves
  fixtures. It can be told to reject auth, report an old version, return a non-admin user, fail a
  single command, or stall until timeout.
- **Round trip**: `expand(standard) == project(full)`, using the reference decoder published in
  `@domusops/schema`. This proves both FR-008 (every entity ID) and FR-009 (lossless modulo the
  omission list).
- **CI floor**: a test asserts `compression_ratio >= 10` on the 500-entity fixture. It runs in the
  existing `verify` job.

**Risk**: a synthetic fixture is more regular than a real installation, so it may overstate the
ratio. The live check (SC-008) is the counterweight. If the live ratio falls below 10, that blocks
release and the fixture is recalibrated. Committing a capture of a real instance was rejected: it
would put personal data into a public repository.

**Consequences for repository tooling** (small, tracked as tasks):

- Once real tests exist, `--passWithNoTests` should be removed from the root `test` script, so
  that deleting all tests fails CI again.
- `eslint.config.js` only lints `packages/*/src/**/*.ts`; its scope must also cover `test/`.
- Tests import `@domusops/schema` from source through a Vitest alias, so they do not depend on a
  prior `tsc -b` build. Test files are type-checked by a per-package `tsconfig.test.json`
  (`noEmit`), run by the root `typecheck` script.

## R10. Distribution (`npx @domusops/mcp`)

**Decision**: `@domusops/mcp` keeps its single `bin` (`domusops-mcp` → `dist/cli.js` with a
`#!/usr/bin/env node` shebang). With a single bin, `npx @domusops/mcp` runs it. Runtime
dependencies are limited to `@domusops/schema`, `@modelcontextprotocol/sdk`, and `zod`; there are
no native modules.

**Verification**: `pnpm pack` both packages and run the tarball with `npx` in a container that has
only Node 22 (see [quickstart.md](./quickstart.md)). This proves SC-007 without publishing.

**Dependency, outside this feature**: making the literal `npx @domusops/mcp` work for users
requires publishing to npm. The `release` workflow currently fails at the publish step (no npm
authentication is configured), so publishing is a separate release task. That task must set up
npm trusted publishing (OIDC), as noted in `release.yml`.
