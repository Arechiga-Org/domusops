# Research: ha_ping

Each entry records a decision, why it was taken, and what was rejected. Facts about the instance
were checked against a sandbox instance of 2026.10.0 with `default_config` on 2026-11-10.

## R1. What the tool reads

- **Facts**:
  - `auth/current_user` answers any authenticated user with `id`, `name`, `is_owner`,
    `is_admin`, `credentials` and `mfa_modules` (242 bytes on the sandbox).
  - `get_config` needs no administrator. It answers with the core configuration, including
    `version`, `time_zone`, the location (`latitude`, `longitude`, `elevation`,
    `location_name`), URLs, and `components` (2,328 bytes, 140 components on the sandbox).
  - Both commands are already on the client's allowlist.
- **Decision**: the tool sends exactly those two commands, after the handshake, on one
  connection. From `auth/current_user` it keeps `is_admin` only; from `get_config` it keeps
  `time_zone` and `components` only. The instance's version comes from the handshake, as for every
  other tool.
- **Why**: everything FR-002 to FR-006 needs, and nothing else (FR-008, FR-010). No new command.
- **Rejected**: `readInstance`, the existing helper, because it throws `not_admin` before reading
  the configuration, while a ping must report a user who is not an administrator in the document
  (FR-018); `system_health/info`, which is broader, slower and partly integration-dependent.

## R2. Which integrations are loaded

- **Facts**: `components` lists each loaded integration by its own name (`logbook`, `recorder`,
  `trace`) and also integration platforms as `<integration>.<platform>` (`backup.sensor`,
  `mobile_app.notify`; 10 of 140 on the sandbox).
- **Decision**: an integration is loaded when its exact name is in `components`. A platform entry
  never counts for the integration before the dot, nor for the one after it.
- **Why**: the existing tools decide the same way (`ha_trace` checks `components` for `trace`),
  so the ping says what those tools will find.

## R3. An instance below the minimum version

- **Facts**: the client refuses an instance below `MIN_VERSION` as soon as `auth_required`
  arrives, before authenticating, with `version_unsupported`. `ClientOptions.minVersion` already
  overrides the threshold.
- **Decision**: `ClientOptions.minVersion` also accepts `null`, which disables the refusal. The
  ping connects with `null`, then decides support itself with `isSupported(haVersion)`, which
  still turns an unparseable version into a protocol error (spec edge case).
- **Why**: the instance answered, so an old version is a finding of the document, not an error
  (FR-018). Every other tool keeps the refusal.
- **Rejected**: a fake minimum such as `0000.0.0` (works only by accident of the parser); catching
  `version_unsupported` and reconnecting (two connections, against FR-008).

## R4. What each tool needs

- **Decision**: a table in `packages/mcp/src/ping/requirements.ts`, one entry per tool the server
  offers except `ha_ping`, in registration order:

  | Tool               | Administrator | Integrations          |
  | ------------------ | ------------- | --------------------- |
  | `ha_snapshot`      | yes           | none                  |
  | `ha_logbook_query` | yes           | `logbook`, `recorder` |
  | `ha_trace`         | yes           | `trace`               |

  Every tool also needs a supported version. Features 010 to 012 add their own rows (spec
  FR-006, FR-019). A test checks that the table names every registered tool except `ha_ping`, so a
  new tool cannot be forgotten.

- **Why**: the table states capabilities; there is no workflow in it (constitution §3).

## R5. Remediation text

- **Decision**: `next_steps`, present only when some tool is not ready, holds one sentence per
  distinct reason, in a fixed order: version, administrator, then each missing integration in
  name order. The sentences reuse the wording of the existing errors (`version_unsupported`,
  `not_admin`, `history_unavailable`, `traces_unavailable`), adapted to name the integration.
- **Why**: one place to look, the same advice the failing tool would give (FR-007).

## R6. Errors before the instance answers

- **Decision**: missing or malformed configuration, an unreachable address, a refused token, a
  timeout and a protocol error are thrown by the existing `readConfig` and `HaClient` code and
  returned as error results with their existing kinds and texts (clarification 1, FR-011,
  FR-018). Nothing new is written for them.

## R7. Compression ratio and its floor

- **Facts**: on the sandbox the two answers total about 2,570 bytes; a ping document of a healthy
  instance is about 450 bytes. The reference fixture's `get_config` has 180 components.
- **Decision**: the ratio is measured as for the other tools, `finalize(document, rawBytes)`, with
  `rawBytes` the size of the two answers as received. CI asserts a floor of 3 on the reference
  fixture with the three integrations loaded, and the sandbox test asserts it on each release.
- **Why**: constitution §4 has no exemption (spec Assumptions). A real home has more components
  than the sandbox, so the ratio only grows from there; 3 leaves room for the 0.2.0 tools' rows.

## R8. Size

- **Decision**: SC-003's bound is raised from 1,000 to 2,000 bytes. With the six tools of
  0.2.0 and every reason present at once (old version, no administrator, five missing
  integrations), the document measures about 1,600 bytes; a healthy instance is about 500. A test
  builds that worst case and asserts the bound.
- **Why**: the bound must hold for the whole 0.2.0 tool set, not only for this feature's three
  rows.

## R9. Format

- **Decision**: `domusops.ping/0.1` in `@domusops/schema`: the identifier constant `PING_FORMAT`,
  the TypeScript types, `pingJsonSchema`, and a row in the package README. There is no decoder:
  the document is not templated or compressed, and is read as it is. `tools` and `integrations`
  are maps keyed by name that accept names a reader does not know (FR-019); `reasons` entries
  follow a fixed grammar, so a reader can match them.
- **Rejected**: an array of tools (order would become meaningful and lookups harder); free-text
  reasons (not matchable).

## R10. The README's decoding example

- **Facts**: the tested example in the `@domusops/mcp` README returns a `summary` document as it
  is and otherwise calls `decoders[document.format]`, which would throw on a ping document.
- **Decision**: the example returns any document whose format has no decoder as it is, and the
  README test runs it on a ping document too.

## R11. Where the server's identity comes from

- **Decision**: `readVersion` and `packageVersion` move from `server.ts` to `src/package-info.ts`,
  with the name `domusops-mcp`; the handshake and `ha_ping` both read from there (FR-002).
- **Why**: one source, so the two can never differ; a tool module importing `server.ts` would be
  circular.

## R12. Release

- **Decision**: minor changesets for `@domusops/mcp` and `@domusops/schema`. `@domusops/sandbox`
  pins `@domusops/mcp` exactly and follows with a dependency-only patch, as in 0.1.2. The Version
  Packages pull request is held until features 010 to 012 merge, so 0.2.0 ships the four tools
  together (spec Assumptions).
