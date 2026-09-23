---
description: "Task list for the ha_snapshot feature"
---

# Tasks: ha_snapshot — Compressed Instance Inventory

**Input**: Design documents from `specs/001-ha-snapshot/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Requested. The spec's acceptance criteria require a round-trip test, a redaction test,
and a CI-asserted compression floor (FR-023). Within each story, write the tests first and confirm
they fail before implementing.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested as
an increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US5, from spec.md)

## Path Conventions

pnpm workspace: `packages/schema/` (public contract) and `packages/mcp/` (MCP server). Sources
live in `packages/<pkg>/src/`, tests in `packages/<pkg>/test/`. All paths are relative to the
repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch, dependencies, and test tooling

- [X] T001 Create branch `001-ha-snapshot` from an up-to-date `main` (`git checkout -b 001-ha-snapshot`), carrying the uncommitted `specs/001-ha-snapshot/` directory. Commit it alone as `docs: add ha-snapshot spec, plan, and tasks`. `main` is protected (constitution §9), so all work happens on this branch.
- [X] T002 Update `packages/mcp/package.json`: add `"zod": "^4.6.5"` to `dependencies` (the SDK takes zod schemas, and the package imports zod directly). Add `"ws"` and `"@types/ws"` to `devDependencies`. Remove the dangling `"main"` and `"types"` fields (there is no `src/index.ts`) and keep `"bin": { "domusops-mcp": "./dist/cli.js" }`. Then run `pnpm install`. Never hand-edit `pnpm-lock.yaml`; the `guard-scope` hook blocks it.
- [X] T003 [P] Create `vitest.config.ts` at the repository root. Include `packages/*/test/**/*.test.ts`, and alias `@domusops/schema` to `packages/schema/src/index.ts`, so that tests never depend on a prior `tsc -b` build. Remove the per-package `"test"` scripts from `packages/schema/package.json` and `packages/mcp/package.json`; tests run from the root config only.
- [X] T004 [P] Extend `eslint.config.js` so its TypeScript `files` glob covers `packages/*/test/**/*.ts` in addition to `packages/*/src/**/*.ts`. Keep the `recommended` rules only.
- [X] T005 [P] Create `packages/schema/tsconfig.test.json` and `packages/mcp/tsconfig.test.json`. Each extends `../../tsconfig.base.json` with `"noEmit": true`, `"composite": false`, `"rootDir": "."`, and `"include": ["src", "test"]`.
- [X] T006 Update the `typecheck` script in the root `package.json` to `tsc -b --pretty && tsc -p packages/schema/tsconfig.test.json && tsc -p packages/mcp/tsconfig.test.json` (depends on T005).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The format contract, the Home Assistant client, and the test infrastructure that
every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Format contract (`@domusops/schema`)

- [X] T007 [P] Create `packages/schema/src/format.ts`:
  - `FORMAT = "domusops.snapshot/0.1"` and `DetailLevel = "summary" | "standard" | "full"`.
  - The envelope type, with `format`, `detail`, `ha_version`, and `compression_ratio`, all snake_case (data-model §2).
  - Types for the `standard` document (`config`, `areas`, `entries`, `templates`, `devices`, `integrations`; data-model §3), the `summary` document (data-model §4), and the `full` document (the same structure as `standard`, with `detail: "full"`; data-model §5).
  - `Template = { const: Record<string, unknown>; cols: string[] }`.
  - Raw input record types for core config, state, entity registry entry, device, area, and config entry (data-model §1). Every field except the record's own ID is optional, and each type has an index signature for unknown fields.
- [X] T008 [P] Create `packages/schema/src/omitted.ts` exporting `OMITTED_FIELDS`, keyed by record kind, verbatim from data-model §6:
  - entity registry: `id`, `unique_id`, `created_at`, `modified_at`
  - device: `connections`, `identifiers`, `created_at`, `modified_at`
  - area: `created_at`, `modified_at`
  - config entry: `created_at`, `modified_at`
  - state: `last_changed`, `last_updated`, `last_reported`, `context`
  - core config: `config_dir`, `allowlist_external_dirs`, `allowlist_external_urls`, `whitelist_external_dirs`, `components`, `internal_url`, `external_url`
- [X] T009 [P] Create `packages/schema/src/defaults.ts` exporting `DEFAULTS`, keyed by record kind, verbatim from data-model §7:
  - entity registry: `area_id: null`, `categories: {}`, `config_subentry_id: null`, `disabled_by: null`, `entity_category: null`, `has_entity_name: true`, `hidden_by: null`, `icon: null`, `labels: []`, `name: null`, `options: {}`, `original_name: null`, `translation_key: null`
  - device: `area_id: null`, `configuration_url: null`, `config_entry_id: null`, `config_subentry_id: null`, `disabled_by: null`, `entry_type: null`, `hw_version: null`, `labels: []`, `manufacturer: null`, `model: null`, `model_id: null`, `name_by_user: null`, `parent_device_id: null`, `serial_number: null`, `sw_version: null`, `via_device_id: null`
  - device, derived (exported as functions): `primary_config_entry` equals the only entry when `config_entries` has exactly one element; `config_entries_subentries` equals `{ <entry>: [null] }` for each entry
  - area: `aliases: []`, `floor_id: null`, `humidity_entity_id: null`, `icon: null`, `labels: []`, `picture: null`, `temperature_entity_id: null`
  - config entry: `disabled_by: null`, `error_reason_translation_domain: null`, `error_reason_translation_key: null`, `error_reason_translation_placeholders: null`, `num_subentries: 0`, `pref_disable_new_entities: false`, `pref_disable_polling: false`, `reason: null`, `source: "user"`, `state: "loaded"`, `supported_subentry_types: {}`, `supports_options: false`, `supports_reconfigure: false`, `supports_remove_device: false`, `supports_unload: false`
  - core config: `safe_mode: false`, `recovery_mode: false`, `state: "RUNNING"`

  Default comparison is deep equality.

- [X] T010 [P] Create `packages/schema/src/redaction.ts` exporting `REDACTION_MARKER = "[redacted]"`.
- [X] T011 Replace `packages/schema/src/index.ts`: remove the camelCase placeholder `HaSnapshot` (`schemaVersion`, `compressionRatio`) and re-export everything from `format.ts`, `omitted.ts`, `defaults.ts`, and `redaction.ts`. Update the header comment to reference `docs/SEED.md` and constitution §5, not `01-SEED.md` (depends on T007 to T010).

### Home Assistant client (`@domusops/mcp`, `src/ha/` is the only code that talks to Home Assistant)

- [X] T012 [P] Create `packages/mcp/src/errors.ts`:
  - `SnapshotError extends Error`, with a `kind` field.
  - `ErrorKind` is exactly: `config_missing`, `config_invalid`, `unreachable`, `timeout`, `version_unsupported`, `auth_invalid`, `not_admin`, `retrieval_failed`, `protocol_error` (data-model §9).
  - The constructor takes a cause and a next step, and must never receive the token.
- [X] T013 [P] Create `packages/mcp/src/ha/config.ts` with `readConfig(env)`, called on every invocation, never at startup:
  - Read `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`.
  - The URL must be `http://host[:port]` or `https://host[:port]`, with an optional trailing slash.
  - Map `http` to `ws://<host>[:port]/api/websocket` and `https` to `wss://…/api/websocket`.
  - Throw `config_missing` naming the missing variable, and `config_invalid` stating the expected URL form.
  - Return `{ baseUrl, wsUrl, token }`.
- [X] T014 [P] Create `packages/mcp/src/ha/version.ts`:
  - `MIN_VERSION = "2025.1.0"`.
  - Parse versions as `YEAR.MONTH.PATCH`. Beta builds (`2026.10.0b3`) and dev builds (`2026.10.0.dev20260915`) compare by their base version.
  - `isSupported(version)`. An unparseable version is a `protocol_error`.
- [X] T015 Create `packages/mcp/src/ha/client.ts` using Node 22's global `WebSocket`, with no WebSocket package at runtime (depends on T012, T014). Behaviour:
  - Wait for `auth_required`, read its `ha_version`, and throw `version_unsupported` **before** sending the token when it is below `MIN_VERSION`.
  - Send `{ "type": "auth", "access_token": <token> }`. Continue on `auth_ok`; throw `auth_invalid` on `auth_invalid`.
  - Send commands with unique, incrementing integer IDs and resolve each on its `result`. `success: false` throws `retrieval_failed` with the command, `error.code`, and `error.message`.
  - Allowlist exactly `auth/current_user`, `get_config`, `get_states`, `config/entity_registry/list`, `config/device_registry/list`, `config/area_registry/list`, `config_entries/get`. Any other type throws before anything is written to the socket (FR-018).
  - Timeouts: 10 s to connect and authenticate, 10 s per command, and 30 s overall; exceeding any of them throws `timeout` naming the phase. The timeouts are injectable for tests.
  - A connection error or drop throws `unreachable` before auth and `retrieval_failed` after auth.
  - Always close the socket. Never log or embed the token.
- [X] T016 Create `packages/mcp/src/ha/retrieve.ts` with `retrieve(client)` (depends on T015):
  - Call `auth/current_user` and throw `not_admin` when `is_admin` is not `true`.
  - Then send the six data commands concurrently (pipelined) and await them all. The result is all-or-nothing: any failure throws `retrieval_failed` naming which retrieval failed.
  - Return `{ haVersion, config, states, entityRegistry, deviceRegistry, areaRegistry, configEntries }`.
- [X] T017 [P] Create `packages/mcp/src/snapshot/ratio.ts`:
  - `measureRawBytes(retrieved)` is the sum of the UTF-8 byte lengths of `JSON.stringify(result)` for the six data retrievals, measured **before redaction**. The serialisation is discarded, never returned.
  - `finalize(doc)` serialises `doc` minified with `compression_ratio: 0`, computes `raw / emitted` rounded to two decimals, and returns the final minified text with the real ratio (research R7).

### Test infrastructure

- [X] T018 [P] Create `packages/mcp/test/fixtures/generate.ts`: a deterministic generator built on a seeded PRNG (for example mulberry32), `generate(entityCount, seed)`.
  - Output: raw payloads shaped exactly like data-model §1: `get_config`, `get_states`, the entity, device, and area registries, `config_entries/get`, and `auth/current_user` with `is_admin: true`.
  - Mix modelled on typical installations (research R9): sensors dominant, then binary sensors, lights, switches, automations, updates, and a few cameras, media players, climate devices, people, and zones.
  - Also include:
    - devices at about one third of the entity count, about 12 areas, and one config entry per integration, with one integration holding two entries;
    - disabled entities (registry entry, no state) and hidden entities;
    - entities with an area that differs from their device's area;
    - YAML entities (registry entry, no config entry);
    - about 2% state-only entities (no registry entry);
    - one orphan reference of each kind in data-model §3.4 (device, config entry, area, via device, area sensor entity);
    - one camera with an `access_token` attribute and an `entity_picture` containing `?token=`;
    - latitude and longitude on `person`, `zone`, and `device_tracker` entities and in `get_config`;
    - non-ASCII names in areas, devices, and `friendly_name` (for example `Küche`, `客厅`, emoji).
  - Calibration, fixed before encoder work (changing it requires a comment in `generate.ts` explaining why): raw fields carry realistic high-entropy values, namely a 32-hex registry `id`, a `unique_id` of 12 to 40 characters, float `created_at`/`modified_at`, ISO `last_changed`/`last_updated`/`last_reported` with microseconds, a 26-character `context.id`, and MAC `connections`. Every `friendly_name` is distinct, and numeric attribute values vary per entity.
  - Export `REFERENCE_500 = generate(500, 500)`, `PERF_1000 = generate(1000, 1000)`, and `EMPTY = generate(0, 0)` (core config only; no entities, devices, or areas).
- [X] T019 [P] Create `packages/mcp/test/support/fake-ha.ts`, a `ws`-based fake instance on an ephemeral port.
  - It sends `auth_required` with a configurable `ha_version`, validates the token, and replies `auth_ok`, or `auth_invalid` followed by close.
  - It serves the fixture payloads as `result` messages.
  - It records every received command type.
  - Failure options: `isAdmin: false`, `failCommand: <type>` (reply `success: false` with code and message), `dropAfter: <type>` (close the connection mid-call), `stall: "connect" | "auth" | <type>` (never reply), and `malformed: <type>` (reply with an unexpected shape).

**Checkpoint**: The format constants, the client, and the test infrastructure are in place; user
story work can begin.

---

## Phase 3: User Story 1 - Full inventory within the context budget (Priority: P1) 🎯 MVP

**Goal**: `ha_snapshot` with no parameters returns a complete `standard` snapshot, grouped,
templated, and at least 10× smaller than the raw data.

**Independent Test**: Against `REFERENCE_500`, every entity ID in the raw data (registries and
states) appears in the output, and `compression_ratio >= 10`.

### Tests for User Story 1 ⚠️ (write first; confirm they fail)

- [ ] T020 [P] [US1] Create `packages/schema/test/expand.test.ts`. On small hand-built `standard` documents, assert that `expand()` restores:
  - defaults (T009), including the derived device defaults;
  - template `const` and positional `cols`;
  - device aliases (`d<n>`), entry aliases (`e<n>`), and template aliases (`t<n>`);
  - entry groups `"_yaml"`, `"!<entry_id>"` (orphan), and `"_unregistered"`/`"_none"`;
  - `"!"`-prefixed orphan references in every reference field of data-model §3.4;
  - a `null` state column restores no state record;
  - `reg.`-prefixed registry fields, kept separate from same-named attributes (for example `icon`).
- [ ] T021 [P] [US1] Create `packages/mcp/test/encode.test.ts` over `REFERENCE_500`. Assert:
  - the fixture's raw size is between 900 and 1,600 bytes per entity (research R6 estimate), so the floor cannot be met by shrinking the raw side;
  - non-ASCII names are byte-identical to the input;
  - every entity ID in `states` ∪ `entity_registry` appears exactly once, as a row or an inline record (data-model §10.1);
  - every alias used is defined and every alias defined is used (data-model §10.2);
  - identical input gives byte-identical output (data-model §10.5);
  - entity IDs are emitted in full;
  - grouping is `integration → entry group → domain → template key`;
  - no omitted field (T008) and no default-valued field (T009) appears.
- [ ] T022 [P] [US1] Create `packages/mcp/test/roundtrip.test.ts`: for `REFERENCE_500`, assert that `expand(encodeStandard(retrieved))` deep-equals `project(retrieved)` (data-model §10.3, FR-008, FR-009).
- [ ] T023 [P] [US1] Create `packages/mcp/test/tool.test.ts` (happy path). Start the MCP server in-process against `fake-ha` serving `REFERENCE_500` and call `ha_snapshot` with no arguments. Assert:
  - exactly one `text` content block and no `structuredContent`;
  - the text parses to a document with `format: "domusops.snapshot/0.1"` and `detail: "standard"`.

  Against `REFERENCE_500`, assert that the parsed `compression_ratio >= 10`. This is the CI floor (FR-023), asserted on the pipeline that ships (`runSnapshot`: redact → project → encode → finalize), not on the encoder alone. Against `PERF_1000`, assert the call completes in under 5,000 ms (SC-004). Against `EMPTY`, assert a valid snapshot with zero entities and a finite `compression_ratio`.

### Implementation for User Story 1

- [ ] T024 [P] [US1] Create `packages/schema/src/expand.ts`, the reference decoder `expand(standard)`. It rebuilds the projected records (entity registry entries, states, devices, areas, config entries, config) by restoring defaults, template constants, columns, aliases, and tree positions (data-model §3). Export it from `packages/schema/src/index.ts`.
- [ ] T025 [P] [US1] Create `packages/mcp/src/snapshot/project.ts` with `project(retrieved, { omit })`. With `omit: true` it removes `OMITTED_FIELDS`; in both cases it elides values deep-equal to `DEFAULTS` (both from `@domusops/schema`), including the derived device defaults. `omit: false` is used by `full` (data-model §5). It returns the projected records used by the encoders and by the round-trip test.
- [ ] T026 [P] [US1] Create `packages/mcp/src/snapshot/templates.ts`, the shape partitioning and template builder.
  - Partition records by the set of their non-default keys. Keys constant across a partition go to `const`; the rest are `cols`, in sorted key order.
  - A template is created only for partitions of two or more records; singletons are returned for inline emission.
  - Templates are numbered `t1…` in order of first use, in the deterministic traversal of data-model §3.3.
- [ ] T027 [US1] Create `packages/mcp/src/snapshot/encode-standard.ts` with `encodeStandard(projected, haVersion)`, following data-model §3 (depends on T025, T026):
  - Device aliases `d<n>` and entry aliases `e<n>` are assigned in ascending order of full ID, and each full ID is emitted once in its alias definition.
  - `devices` rows are `[alias, id, ...cols]`, with inline records under `"_"`.
  - `integrations` is keyed by registry `platform` → entry alias, `"_yaml"`, or `"!<entry_id>"` → domain → template key.
  - Entity rows are `[entity_id, state, device, ...cols]`. `device` is an alias, `null`, or `"!<device_id>"` when the device is an orphan; every reference field follows data-model §3.4. `state` is `null` for registry entities without a state object.
  - State-only entities go under `"_unregistered"` → `"_none"`.
  - Attribute keys are unprefixed and registry fields use the `reg.` prefix. `reg.area_id` appears only when set.
  - Object keys are emitted in sorted order.
- [ ] T028 [US1] Create `packages/mcp/src/tools/ha-snapshot.ts` with `runSnapshot(env)`: `readConfig` → client → `retrieve` → `measureRawBytes` → `project` → `encodeStandard` → `finalize` (depends on T013, T016, T017, T027). Return the minified text.
- [ ] T029 [US1] Create `packages/mcp/src/server.ts` (depends on T028). It creates an `McpServer` from `@modelcontextprotocol/sdk` and registers `ha_snapshot` with:
  - `title` and `description` copied verbatim from `specs/001-ha-snapshot/contracts/ha_snapshot.tool.json`;
  - annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`;
  - no input parameters yet (`detail` arrives in US4).

  The handler returns `{ content: [{ type: "text", text }] }` and no `structuredContent` (research R5).

- [ ] T030 [US1] Replace the stub `packages/mcp/src/cli.ts`. Keep the `#!/usr/bin/env node` shebang and start `server.ts` over the SDK's stdio transport. Stdout carries protocol traffic only; diagnostics go to stderr, prefixed `[domusops-mcp]`, and never include the token. Remove the stale comments that point to `01-SEED.md` and `specs/ha-snapshot/`.

**Checkpoint**: US1 tests pass: `standard` works end to end with a ratio of at least 10. **Do not
merge to `main` yet**. Without US2, the output can contain secrets, and `main` must stay
releasable (§9).

---

## Phase 4: User Story 2 - Secrets never reach the agent (Priority: P1)

**Goal**: No token, password, API key, or coordinate appears in the output, at any detail
level.

**Independent Test**: For the redaction fixture, no fragment of six or more characters of any
planted secret or coordinate appears in the `standard` output.

### Tests for User Story 2 ⚠️

- [ ] T031 [P] [US2] Create `packages/mcp/test/fixtures/redaction.json`, a small raw payload set with distinct high-entropy planted secrets (at least 24 characters each) in:
  - an entity attribute named `access_token`;
  - a nested registry `options` key `api_key`;
  - an `entity_picture` URL query `?token=…`;
  - a `configuration_url` with `https://user:<password>@host`;
  - a JWT in a free-text attribute;
  - a `Bearer <credential>` string;
  - a value equal to the configured `DOMUSOPS_HA_TOKEN`;
  - an e-mail address in a config entry `title`;
  - `latitude`, `longitude`, and `elevation` in `get_config`;
  - `latitude` and `longitude` on `person` and `zone` states;
  - a `gps` numeric pair.

  Also list the planted values in an `expected_absent` array, and include an entity ID that looks like a secret, to prove identifiers are never redacted.

- [ ] T032 [P] [US2] Create `packages/mcp/test/redact.test.ts` with one unit test per rule (K1, V1 to V6, C1; data-model §8). Assert that:
  - the field stays present with `REDACTION_MARKER`;
  - inside a URL, only the secret substring is replaced and the path survives;
  - values of every key on the closed exemption list of data-model §8 are untouched, even when they look like a secret;
  - `token_expiry`-style false positives are accepted, meaning they are redacted.
- [ ] T033 [P] [US2] Create `packages/mcp/test/redaction-oracle.test.ts`: run `runSnapshot` against `fake-ha` serving `redaction.json`, and assert that for every `expected_absent` value, no contiguous substring of six or more characters appears in the output text (spec Assumptions, data-model §8 oracle). Parametrise it over detail levels, so that US4 can add `summary` and `full`.

### Implementation for User Story 2

- [ ] T034 [US2] Create `packages/mcp/src/snapshot/redact.ts` with `redact(retrieved, configuredToken)`. It returns a deep copy with the rules applied verbatim from data-model §8:
  - **K1**: keys normalised to lowercase tokens (split on `_`, `-`, `.`, and camelCase) containing `token`, `password`, `passwd`, `secret`, `apikey`, `credential(s)`, `authorization`, `bearer`, or `webhook`, or the pairs `api key`, `private key`, `secret key`, `access key`, `auth key`, or `encryption key`. The whole value is replaced.
  - **V1**: URL query parameters named as in K1, plus `key`, `sig`, `signature`, and `auth`. The parameter value is replaced.
  - **V2**: the password in `scheme://user:password@host`.
  - **V3**: JWTs (three base64url segments, the first starting with `eyJ`).
  - **V4**: the credential after `Bearer `.
  - **V5**: any exact occurrence of the configured token.
  - **V6**: e-mail addresses (`local@domain.tld`) in any string, including config entry titles (FR-024).
  - **C1**: keys `latitude`, `longitude`, `lat`, `lon`, `lng`, or `elevation`, and `gps` or `location` holding a numeric pair. The whole value is replaced.

  V1 to V6 apply to every string, at any depth. Values of the keys on the closed exemption list of data-model §8 are never redacted. Replacement uses `REDACTION_MARKER` from `@domusops/schema`.

- [ ] T035 [US2] Wire redaction into `packages/mcp/src/tools/ha-snapshot.ts`. `measureRawBytes` runs on the unredacted data, then `redact(retrieved, config.token)` runs **before** `project`/`encodeStandard` and before any serialisation for output (FR-015). No code path passes unredacted records to an encoder.

**Checkpoint**: US1 and US2 pass together. This is the MVP, and the first point at which the
branch may be merged.

---

## Phase 5: User Story 3 - Loud, actionable failure (Priority: P2)

**Goal**: Every failure yields a distinct, actionable error and no snapshot.

**Independent Test**: A missing token, an invalid token, an unreachable host, an unsupported
version, a non-admin token, and a failed retrieval each produce their own error kind, and no
snapshot.

### Tests for User Story 3 ⚠️

- [ ] T036 [P] [US3] Create `packages/mcp/test/version.test.ts`: `2025.1.0` is supported; `2024.12.4` is not; `2026.10.0b3` and `2026.10.0.dev20260915` compare by their base version; an unparseable string is a `protocol_error`.
- [ ] T037 [P] [US3] Create `packages/mcp/test/client.test.ts` against `fake-ha`, using short injected timeouts. Assert one error kind per condition:
  - `config_missing` for each missing variable, with the message naming it;
  - `config_invalid` for `ftp://x` and for a URL without a host;
  - `unreachable` for a closed port;
  - `timeout` for `stall: "connect"`, `stall: "auth"`, and `stall: "get_states"`, with the message naming the phase;
  - `version_unsupported` for `2024.12.4`, where the fake receives **no** `auth` message (the version is checked before the token is sent);
  - `auth_invalid`;
  - `not_admin`;
  - `retrieval_failed` for `failCommand: "config/device_registry/list"` and for `dropAfter: "get_states"`, with the message naming the retrieval;
  - `protocol_error` for `malformed: "get_config"`.
- [ ] T038 [P] [US3] Extend `packages/mcp/test/tool.test.ts` with failure cases through the MCP server:
  - each error kind returns `isError: true` with exactly one text block matching `ha_snapshot failed [<kind>]: <cause>. <next step>.` (contracts/ha_snapshot.md);
  - the text never contains `DOMUSOPS_HA_TOKEN` or any snapshot data;
  - a failure after some retrievals succeeded still returns no partial data (FR-020).

### Implementation for User Story 3

- [ ] T039 [US3] Complete the message builders in `packages/mcp/src/errors.ts`, with the next step for each kind verbatim from data-model §9:
  - `config_missing`: which variable to set, and how to create a long-lived access token;
  - `config_invalid`: the expected URL form;
  - `unreachable`: the address tried, and to check host, port, and network;
  - `timeout`: the address tried and which phase timed out;
  - `version_unsupported`: the detected and the minimum version;
  - `auth_invalid`: create a new long-lived access token;
  - `not_admin`: use a token of an administrator user, and why;
  - `retrieval_failed`: which retrieval failed, and the instance's error code and message;
  - `protocol_error`: report it as a bug, including `ha_version`.
- [ ] T040 [US3] In `packages/mcp/src/server.ts`, catch `SnapshotError` in the `ha_snapshot` handler and return `{ isError: true, content: [{ type: "text", text: "ha_snapshot failed [<kind>]: <cause>. <next step>." }] }`. Any unexpected exception maps to `protocol_error`. Protocol-level errors are never used for domain failures (research R5).

**Checkpoint**: US1 to US3 pass independently.

---

## Phase 6: User Story 4 - Choose the level of detail (Priority: P2)

**Goal**: The `detail` parameter selects `summary`, `standard` (the default), or `full`; an
invalid value is rejected.

**Independent Test**: Against `REFERENCE_500`, each detail value has the documented shape, and
an invalid value is rejected with the accepted values listed.

### Tests for User Story 4 ⚠️

- [ ] T041 [P] [US4] Create `packages/mcp/test/encode-summary.test.ts` over `REFERENCE_500`. Assert the `summary` fields from data-model §4:
  - `counts: { entities, devices, areas, integrations, entries, unregistered_entities, disabled_entities }`;
  - `by_domain`;
  - `by_integration: { entities, devices, entries, domains }`;
  - `areas: { name, devices, entities }`, counted by effective area (the entity's own area, otherwise its device's area);
  - `unassigned: { devices, entities }`.

  Also assert that no entity ID appears anywhere in the output (FR-010), and that the counts agree with the generator's totals. On `EMPTY`, every count is 0.

- [ ] T042 [P] [US4] Create `packages/mcp/test/encode-full.test.ts` over `REFERENCE_500`: `full` uses the `standard` structure (data-model §3); every omitted field (T008) is present; `expand(full)` deep-equals the redacted retrieved data (data-model §10.3); and `compression_ratio > 1`, so it is never a raw passthrough (FR-011, constitution §4).
- [ ] T043 [P] [US4] Extend `packages/mcp/test/tool.test.ts`:
  - `detail` omitted gives `standard`;
  - `summary` and `full` give their shapes, and every successful response has a `compression_ratio`;
  - `detail: "verbose"` is rejected with a message listing `summary`, `standard`, and `full`, and no snapshot (pin whichever shape SDK 1.30.1 produces, an `isError` result or `InvalidParams`, per research R5);
  - an unknown extra property is either rejected or ignored; pin which (contracts/ha_snapshot.md);
  - for every detail value, `fake-ha` recorded only allowlisted read commands (SC-006, FR-018).
- [ ] T044 [P] [US4] Extend `packages/mcp/test/redaction-oracle.test.ts` to run the oracle at `summary` and `full` as well (US2 scenario 4: `full` never disables redaction).

### Implementation for User Story 4

- [ ] T045 [P] [US4] Create `packages/mcp/src/snapshot/encode-summary.ts` with `encodeSummary(redacted, haVersion)`, producing exactly the data-model §4 fields listed in T041. `config` is the same as in `standard`, and no entity IDs are emitted.
- [ ] T046 [P] [US4] Create `packages/mcp/src/snapshot/encode-full.ts` with `encodeFull(redacted, haVersion)`: `project(redacted, { omit: false })`, then the same grouping, templates, and aliases as `encodeStandard`, with `detail: "full"` (data-model §5).
- [ ] T047 [US4] Add the `detail` input to the `ha_snapshot` registration in `packages/mcp/src/server.ts` (depends on T045, T046). Use a zod enum of `"summary" | "standard" | "full"`, default `"standard"`, strict (no extra properties), with the field description verbatim from `contracts/ha_snapshot.tool.json`. Then dispatch in `packages/mcp/src/tools/ha-snapshot.ts`: redact first, then choose `encodeSummary`, `encodeStandard` (via `project`), or `encodeFull`, then `finalize`.

**Checkpoint**: US1 to US4 pass. The tool matches `contracts/ha_snapshot.tool.json` exactly.

---

## Phase 7: User Story 5 - Zero-setup start (Priority: P3)

**Goal**: On a machine with only Node 22, the server starts from a package and advertises
`ha_snapshot`.

**Independent Test**: The packed tarballs start in a `node:22-slim` container, and `tools/list`
returns only `ha_snapshot`.

### Tests for User Story 5 ⚠️

- [ ] T048 [P] [US5] Create `packages/mcp/test/cli.test.ts`. Spawn `node packages/mcp/dist/cli.js` (built by `pnpm typecheck` → `tsc -b`), send `initialize`, `notifications/initialized`, and `tools/list` over stdio, and assert that exactly one tool, `ha_snapshot`, is listed. Also assert that stdout carries only JSON-RPC lines. If `dist/` is missing, fail with the message "run `pnpm typecheck` first".

### Implementation for User Story 5

- [ ] T049 [US5] Verify the packaging of `packages/mcp/package.json` and `packages/schema/package.json`:
  - `"files": ["dist"]`;
  - the `bin` target keeps its shebang after `tsc`;
  - runtime `dependencies` are only `@domusops/schema`, `@modelcontextprotocol/sdk`, and `zod`;
  - `pnpm pack` rewrites `workspace:*` to a concrete version;
  - no native modules.

  Fix anything that differs.

- [ ] T050 [US5] Run quickstart.md scenario 2 (Docker `node:22-slim`, both packed tarballs, `npx --package=… domusops-mcp`) and record the result (pass/fail and the `tools/list` output) in the pull request description (SC-007).

**Checkpoint**: All five user stories pass.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Contract publication, repository hygiene, release metadata, and live verification

- [ ] T051 [P] Create `packages/schema/src/json-schema.ts`, exporting `snapshotJsonSchema` (a JSON Schema for the envelope and all three document shapes), and export it from `packages/schema/src/index.ts`. Add `ajv` as a `devDependency` of `@domusops/schema`, and create `packages/schema/test/json-schema.test.ts`, which validates `summary`, `standard`, and `full` outputs of `REFERENCE_500` against it (FR-021).
- [ ] T052 [P] Create `packages/mcp/README.md` covering:
  - what the tool does, "for Home Assistant" (nominative use only, §6);
  - the `DOMUSOPS_HA_URL`/`DOMUSOPS_HA_TOKEN` setup, including the administrator requirement and why;
  - the three detail levels and the "at least 10x" compression claim with its fixture basis (§4);
  - a link to the format in `specs/001-ha-snapshot/data-model.md`;
  - HTTPS with a self-signed certificate: set `NODE_EXTRA_CA_CERTS` to the CA file;
  - versions: only the refusal threshold (2025.1.0, stated as not a support claim) and a note that the supported-version matrix will be generated by the sandbox CI (constitution §8). No hand-written list of verified or supported versions.
- [ ] T053 [P] Remove `--passWithNoTests` from the `test` script in the root `package.json` (research R9), so that deleting all tests fails CI again.
- [ ] T054 [P] Update stale references:
  - in `CLAUDE.md`, "Current focus" points to `specs/001-ha-snapshot/` and `docs/SEED.md` §5 instead of `specs/ha-snapshot/` and `01-SEED.md`;
  - in `packages/sandbox/src/index.ts`, the comment references `docs/SEED.md` §6 instead of `01-SEED.md` and `00-BOOTSTRAP-RUNBOOK.md`;
  - in `.github/workflows/ci.yml`, the `sandbox-matrix` comment references `docs/SEED.md` §6.
- [ ] T055 [P] Add changesets with `pnpm exec changeset`:
  - `@domusops/schema` minor: "Add the `domusops.snapshot/0.1` format: types, omission list, defaults, redaction marker, JSON Schema, and reference decoder. Replaces the placeholder `HaSnapshot` type (breaking in 0.x)."
  - `@domusops/mcp` minor: "Add the `ha_snapshot` tool."
- [ ] T056 Run `pnpm lint && pnpm typecheck && pnpm test` from the repository root and fix any failure. The `verify` CI job runs the same steps (quickstart.md scenario 1).
- [ ] T057 Run quickstart.md scenario 3 against the maintainer's live instance with `detail=summary`, `standard`, and `full`, and scenario 4 (failure smoke test). Record only `ha_version`, the entity count, the `standard` compression ratio, and the wall-clock time in the pull request description, never snapshot content (SC-008). A ratio below 10 blocks release: recalibrate the fixture (T018) and revisit research R6.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002 to T005 in parallel after it; T006 after T005.
- **Foundational (Phase 2)**: Depends on Setup. It blocks every user story.
- **US1 (Phase 3)**: Depends on Foundational.
- **US2 (Phase 4)**: Depends on Foundational; its wiring task (T035) modifies the US1 pipeline (T028).
- **US3 (Phase 5)**: Depends on Foundational; T040 modifies `server.ts` from US1 (T029).
- **US4 (Phase 6)**: Depends on US1 (`project`, `server.ts`, and the tool pipeline) and on US2 (redaction runs before every encoder).
- **US5 (Phase 7)**: Depends on US1 (a working `cli.ts`). It is independent of US2 to US4.
- **Polish (Phase 8)**: Depends on all stories. T051 needs all three encoders (US4).

### User Story Dependencies

- **US1 (P1)**: Needs only the foundation.
- **US2 (P1)**: Needs only the foundation to build and test `redact.ts` (T031, T032, T034). Its oracle test (T033) and wiring (T035) need US1's pipeline. US1 and US2 ship together as the MVP.
- **US3 (P2)**: Needs only the foundation for client-level tests (T036, T037). Tool-level tests (T038, T040) need US1's server.
- **US4 (P2)**: Extends US1 and US2.
- **US5 (P3)**: Needs US1 only.

### Within Each User Story

- Tests are written first and must fail before implementation.
- Schema/contract changes come before encoders, encoders before the tool pipeline, and the pipeline before server registration.
- A story is complete when its checkpoint tests pass.

### Parallel Opportunities

- **Setup**: T003, T004, T005.
- **Foundational**: T007 to T010 (schema files), T012 to T014 (errors, config, version), T017 (ratio), T018 and T019 (fixtures and fake instance). T015 and T016 are sequential.
- **US1**: tests T020 to T023 together; then T024, T025, T026 together; then T027 → T028 → T029 → T030.
- **US2**: T031, T032, T033 together. T034 can start in parallel with all of US1 (it depends only on the foundation).
- **US3**: T036, T037, T038 together; T039 can run alongside US1.
- **US4**: T041 to T044 together; T045 and T046 together; then T047.
- **US5**: T048 alongside US2 to US4.
- **Polish**: T051 to T055 together; then T056 → T057.

---

## Parallel Example: User Story 1

```bash
# Tests for User Story 1, together (they must fail first):
Task: "expand() decoder tests in packages/schema/test/expand.test.ts"
Task: "standard invariants and fixture calibration in packages/mcp/test/encode.test.ts"
Task: "round trip expand(standard) == project(retrieved) in packages/mcp/test/roundtrip.test.ts"
Task: "happy path, CI compression floor, and 1,000-entity performance in packages/mcp/test/tool.test.ts"

# Independent building blocks, together:
Task: "reference decoder in packages/schema/src/expand.ts"
Task: "omission and default elision in packages/mcp/src/snapshot/project.ts"
Task: "shape templates in packages/mcp/src/snapshot/templates.ts"
```

## Parallel Example: Foundational

```bash
Task: "format types in packages/schema/src/format.ts"
Task: "omission list in packages/schema/src/omitted.ts"
Task: "defaults table in packages/schema/src/defaults.ts"
Task: "error kinds in packages/mcp/src/errors.ts"
Task: "env config in packages/mcp/src/ha/config.ts"
Task: "version floor in packages/mcp/src/ha/version.ts"
Task: "fixture generator in packages/mcp/test/fixtures/generate.ts"
Task: "fake instance in packages/mcp/test/support/fake-ha.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Phase 1: Setup (branch, dependencies, test tooling).
2. Phase 2: Foundational (format contract, client, fixtures, fake instance).
3. Phase 3: US1. `standard` works and meets the 10× floor.
4. Phase 4: US2. Redaction is in place. **Only now** is the branch releasable.
5. **Stop and validate**: `pnpm lint && pnpm typecheck && pnpm test`, then open the pull request.

US2 is P1 and release-blocking: without it US1 can emit credentials, so the MVP is US1 + US2.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 + US2 → MVP; merge once green.
3. US3 → actionable failures.
4. US4 → `summary`/`full` and the complete tool contract.
5. US5 → verified clean-machine start.
6. Polish → JSON Schema, README, changesets, live verification (SC-008).

Constitution §9 limits feature branches to three days. If the full scope does not fit, merge the
MVP first, then deliver US3 to US5 on short follow-up branches.

---

## Notes

- Constitution §2: run `/speckit-analyze` on spec, plan, and tasks **before** `/speckit-implement`.
- Commit after each task or logical group. Every commit and artifact is in English (§1; the `guard-language` hook enforces it).
- Never hand-edit `pnpm-lock.yaml` (the `guard-scope` hook blocks it); change dependencies through `pnpm`.
- Decisions carried from the plan (see plan.md, "Decisions to confirm at review"):
  - the omission list (T008) omits `unique_id`, hardware identifiers, and state timestamps;
  - personal data in config entry titles is not redacted, which is a candidate spec amendment;
  - npm publishing is outside this feature.

  Changing any of these changes T008, T034, or T050 respectively.
