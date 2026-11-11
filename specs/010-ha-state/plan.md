# Implementation Plan: ha_state — Seeing What an Entity Is Doing Right Now

**Branch**: `010-ha-state` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-ha-state/spec.md`

## Summary

A new read-only tool, `ha_state`, the second of the `@domusops/mcp` 0.2.0 release. On one
connection it checks for an administrator, reads `get_config` and `get_states`, and selects
locally by `entities`, `domain`, `state` and `exclude`, with the logbook's matcher (research R1,
R2). The selected states are redacted with the snapshot's rules (R7) and encoded as a
`domusops.state/0.1` document. At `standard`, the snapshot's templates are grouped by domain,
with local times and compact context IDs that `ha_trace` and `ha_logbook_query` accept (R4 to
R6). At `summary`, it gives counts per domain (R9). Results above `DOMUSOPS_STATE_MAX_BYTES` are
refused (R8). The format ships in `@domusops/schema` with types, a JSON Schema and the decoder
`expandState` (R11). Every response carries a `compression_ratio`, with a CI floor of 2 on the
reference fixture (R10). `ha_ping` lists the tool through a new requirements row (R12).

## Technical Context

**Language/Version**: TypeScript 5.9, strict, shared `tsconfig.base.json`, Node 22 or later.

**Primary Dependencies**: no new ones. `@modelcontextprotocol/sdk`, `zod`, and the workspace's
`@domusops/schema`.

**Storage**: none.

**Testing**:

- Vitest against the simulated instance (`packages/mcp/test/support/fake-ha.ts`, which already
  serves `get_states` from a fixture) and the reference fixture `REFERENCE_500`.
- New test files:
  - `packages/mcp/test/state.test.ts`: the tool, filters, notes, errors, reads.
  - `packages/mcp/test/state-encode.test.ts`: layout, defaults, floor, summary bound.
  - `packages/mcp/test/state-roundtrip.test.ts`: encode, then `expandState`.
  - `packages/mcp/test/state-json-schema.test.ts`.
  - `packages/mcp/test/state-redaction.test.ts`: a seeded fixture, SC-005.
  - `packages/schema/test/state-expand.test.ts`.
- Existing files gain cases:
  - `tool.test.ts`: the contract and the requirements row.
  - `ping.test.ts`: `ha_state` listed and ready.
  - `readme.test.ts`: the decoding example on a state document.
  - `cli.test.ts`: the tool list.
  - `config.test.ts`: the new limit variable.
  - `packages/sandbox/test/mcp.container.test.ts` (§8).

**Target Platform**: any MCP client on macOS, Linux or WSL with Node 22 or later.

**Project Type**: two packages of the pnpm workspace, `packages/mcp` and `packages/schema`.

**Performance Goals**: three commands after the handshake on one connection; `get_states` of a
3,000-entity home is about 1.3 MB on the wire and is selected and encoded in memory in well
under a second.

**Constraints**:

- No new command on the client's allowlist (R1).
- The outputs of `ha_snapshot`, `ha_logbook_query`, `ha_trace` and `ha_ping` do not change,
  except that `ha_ping` lists the new tool, which its open format allows (FR-022, feature 009
  FR-019).
- `summary` under 4,000 bytes (FR-014). `standard` under the limit or refused.

**Scale/Scope**: one tool, one format with a decoder, about 600 lines of source and 800 of tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                      | Status | How                                                                                                                                                   |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only              | Pass   | Every artifact in English; the hook enforces it                                                                                                       |
| §2 Spec before code          | Pass   | Spec, clarifications, this plan, then tasks and analyze before implementing                                                                           |
| §3 No procedure in the MCP   | Pass   | Filters and counts are capabilities; the tool never chains other tools. It returns context IDs, and following them is the agent's or a skill's job    |
| §4 Compression is a contract | Pass   | `compression_ratio` on every response, a CI floor of 2 on the reference fixture (R10), a byte limit with a narrowing message (R8), no raw passthrough |
| §5 Public, stable schema     | Pass   | New versioned format `domusops.state/0.1` with types, JSON Schema and decoder in `@domusops/schema` (R11); no existing format changes                 |
| §6 Trademark hygiene         | Pass   | The tool title says "for Home Assistant", nominatively                                                                                                |
| §7 Destructive is opt-in     | Pass   | Read-only; `readOnlyHint` true, `destructiveHint` false                                                                                               |
| §8 Support is proven         | Pass   | The sandbox container test runs `ha_state` on stable, previous stable and beta in CI                                                                  |
| §9 Trunk-based, changesets   | Pass   | Minor changesets for `@domusops/mcp` and `@domusops/schema`; the Version Packages pull request waits for features 011 and 012 (R14)                   |
| §10 Convenience, not secrecy | Pass   | Nothing depends on the source staying private                                                                                                         |

Post-design re-check: still passes. The floor of 2 is lower than the other tools' floors. §4
asks for a documented ratio and a floor, not a value. R10 records why readable local times,
which FR-008 requires, set it.

## Project Structure

### Documentation (this feature)

```text
specs/010-ha-state/
├── spec.md
├── plan.md                  # this file
├── research.md              # R1 to R14
├── data-model.md            # envelope, standard, summary, times, context, decoded record
├── quickstart.md
├── contracts/
│   ├── ha_state.tool.json   # the tool as the server advertises it
│   └── state-format.md      # domusops.state/0.1, with examples, notes and errors
├── checklists/
│   └── requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
packages/schema/
├── src/state/format.ts         # STATE_FORMAT, detail levels, document and record types
├── src/state/json-schema.ts    # stateJsonSchema
├── src/state/expand.ts         # expandState (R11)
├── src/expand.ts               # decodeGroups exported from the module, not from the index
├── src/index.ts                # exports
├── test/state-expand.test.ts
└── README.md                   # the format's row and decoder

packages/mcp/
├── src/ha/config.ts            # DOMUSOPS_STATE_MAX_BYTES (R8)
├── src/errors.ts               # notAdmin("states"), inputInvalid, tooLargeStates (R1, R3, R8)
├── src/notes.ts                # notFoundNote, nothingMatchedNote (R13)
├── src/state/inputs.ts         # domain, state, attributes validation (R3)
├── src/state/select.ts         # filter order and not-found IDs (R2)
├── src/state/encode-standard.ts
├── src/state/encode-summary.ts
├── src/state/envelope.ts       # envelope and anchor (R5)
├── src/tools/ha-state.ts       # runState / queryState: the pipeline
├── src/ping/requirements.ts    # the ha_state row (R12)
├── src/server.ts               # registers ha_state from the contract, before ha_ping
├── test/…                      # see Testing
└── README.md                   # ha_state section, decoder table row

packages/sandbox/test/mcp.container.test.ts   # ha_state on each release (§8)
README.md                                     # the tool table row
.changeset/                                   # mcp minor, schema minor
```

**Structure Decision**: the tool follows `ha_logbook_query` and `ha_trace`: a `tools/` entry
point and its own folder for selection and encoding. It reuses `logbook/selectors.ts`,
`logbook/local-time.ts`, `snapshot/templates.ts` and `snapshot/redact.ts` as they are. The format
follows the `logbook/` and `trace/` folders of `@domusops/schema`.

## Delivery

One pull request. User Stories 1 and 2 share every file (selection, encoding, limit). User Story
3 (`summary`) is small and rides with them, as in features 002 and 003.
