# Implementation Plan: ha_history — Following How an Entity Changed Over Time

**Branch**: `011-ha-history` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-ha-history/spec.md`

## Summary

A new read-only tool, `ha_history`, the third of the `@domusops/mcp` 0.2.0 release. On one
connection it checks for an administrator and the `history` integration, expands patterns
against `get_states` when it needs to, and reads `history/history_during_period`, a new allowlisted
read sent with every flag explicit (research R1 to R3). The history carries no context, measured on
2026.10.0 and 2026.9.4, so the document carries none and points to `ha_logbook_query` (R1).
Entries are redacted with the snapshot's rules (R8), trimmed and filtered by `attributes` (R9),
and encoded as a `domusops.history/0.1` document: per entity, the start state, then changes
bucketed by local date and hour, each one a delta against the previous listed entry (R6, R7). At
`summary`, it reads without attributes and gives counts per domain, and per entity when
`entities` is given (R11). Windows over 10 days are refused (R5); results above
`DOMUSOPS_HISTORY_MAX_BYTES` are refused (R10). The format ships in `@domusops/schema` with types,
a JSON Schema and the decoder `expandHistory` (R13). Every response carries a
`compression_ratio`, with a CI floor of 5 on the reference fixture (R12). `ha_ping` lists the tool
through a new requirements row (R15).

## Technical Context

**Language/Version**: TypeScript 5.9, strict, shared `tsconfig.base.json`, Node 22 or later.

**Primary Dependencies**: no new ones. `@modelcontextprotocol/sdk`, `zod`, and the workspace's
`@domusops/schema`.

**Storage**: none.

**Testing**:

- Vitest against the simulated instance (`packages/mcp/test/support/fake-ha.ts`, which gains a
  `history/history_during_period` handler that follows research R1) and a new reference fixture,
  `packages/mcp/test/fixtures/generate-history.ts` (R16).
- New test files:
  - `packages/mcp/test/history.test.ts`: the tool, selection, window, filters, notes, errors,
    reads.
  - `packages/mcp/test/history-encode.test.ts`: layout, buckets, deltas, floor, summary bound.
  - `packages/mcp/test/history-roundtrip.test.ts`: encode, then `expandHistory`.
  - `packages/mcp/test/history-json-schema.test.ts`.
  - `packages/mcp/test/history-redaction.test.ts`: a seeded fixture, SC-004.
  - `packages/schema/test/history-expand.test.ts`.
- Existing files gain cases:
  - `tool.test.ts`: the contract and the requirements row.
  - `ping.test.ts`: `ha_history` listed and ready, and not ready without `history`.
  - `client.test.ts`: the new command's parameters.
  - `readme.test.ts`: the decoding example on a history document.
  - `cli.test.ts`: the tool list.
  - `config.test.ts`: the new limit variable.
  - `packages/sandbox/test/mcp.container.test.ts` (§8).

**Target Platform**: any MCP client on macOS, Linux or WSL with Node 22 or later.

**Project Type**: two packages of the pnpm workspace, `packages/mcp` and `packages/schema`.

**Performance Goals**: three or four commands after the handshake on one connection. The history
read uses the overall time budget, as the logbook read does; a whole-home `standard` read over a
long window can time out, and the timeout hint names a shorter window, fewer entities or
`summary`. `summary` reads without attributes, so a whole-home summary stays cheap for the
instance.

**Constraints**:

- One new command on the client's allowlist, a read, with its parameters fixed (R1).
- The outputs of `ha_snapshot`, `ha_logbook_query`, `ha_trace`, `ha_state` and `ha_ping` do not
  change, except that `ha_ping` lists the new tool (FR-021). Every error wording they use stays;
  the new wordings come from new subjects or new functions (R2, R4, R5, R10).
- `summary` without `entities` under 4,000 bytes; everything else under the limit or refused.

**Scale/Scope**: one tool, one format with a decoder, about 800 lines of source and 1,000 of
tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                      | Status | How                                                                                                                                                              |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only              | Pass   | Every artifact in English; the hook enforces it                                                                                                                  |
| §2 Spec before code          | Pass   | Spec, clarifications, this plan, then tasks and analyze before implementing                                                                                      |
| §3 No procedure in the MCP   | Pass   | Selection, deltas and counts are capabilities; the tool never chains other tools. Following a change to its cause is the agent's or a skill's job                |
| §4 Compression is a contract | Pass   | `compression_ratio` on every response, a CI floor of 5 on the reference fixture (R12), a byte limit with a narrowing message (R10), a 10-day maximum window (R5) |
| §5 Public, stable schema     | Pass   | New versioned format `domusops.history/0.1` with types, JSON Schema and decoder in `@domusops/schema` (R13); no existing format changes                          |
| §6 Trademark hygiene         | Pass   | The tool title says "for Home Assistant", nominatively                                                                                                           |
| §7 Destructive is opt-in     | Pass   | Read-only; the new command is a read; `readOnlyHint` true, `destructiveHint` false                                                                               |
| §8 Support is proven         | Pass   | The sandbox container test runs `ha_history` on stable, previous stable and beta in CI                                                                           |
| §9 Trunk-based, changesets   | Pass   | Minor changesets for `@domusops/mcp` and `@domusops/schema`; the Version Packages pull request waits for feature 012 (R17)                                       |
| §10 Convenience, not secrecy | Pass   | Nothing depends on the source staying private                                                                                                                    |

Post-design re-check: still passes. The floor of 5 sits under the prototype's measurements (4.6
for a light alone, 8.5 for the mixed day), so it is asserted on the fixture as a whole and on its
noisiest sensor, the case SC-002 names, not on every entity (R12).

## Project Structure

### Documentation (this feature)

```text
specs/011-ha-history/
├── spec.md
├── plan.md                    # this file
├── research.md                # R1 to R17
├── data-model.md              # raw entry, envelope, standard, summary, listing, decoded entry, errors
├── quickstart.md
├── contracts/
│   ├── ha_history.tool.json   # the tool as the server advertises it
│   └── history-format.md      # domusops.history/0.1, with examples, notes and errors
├── checklists/
│   └── requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
packages/schema/
├── src/history/format.ts         # HISTORY_FORMAT, detail levels, document and entry types
├── src/history/json-schema.ts    # historyJsonSchema
├── src/history/expand.ts         # expandHistory (R13)
├── src/index.ts                  # exports
├── test/history-expand.test.ts
└── README.md                     # the format's row and decoder

packages/mcp/
├── src/ha/client.ts              # history/history_during_period on the allowlist (R1)
├── src/ha/history.ts             # readHistory: the read, its validation, unknown_command (R1, R2)
├── src/ha/config.ts              # DOMUSOPS_HISTORY_MAX_BYTES (R10)
├── src/errors.ts                 # notAdmin("entity_history"), historyUnavailable("states"),
│                                 # inputInvalid("history"), windowTooLong, tooLargeHistory
├── src/notes.ts                  # noHistoryNote, nothingChangedNote (R14)
├── src/history/inputs.ts         # attributes, significant_only, detail (R4)
├── src/history/select.ts         # candidates, exclusion, listing rule (R3)
├── src/history/entries.ts        # start state detection, redaction, attribute filter (R8, R9)
├── src/history/encode-standard.ts
├── src/history/encode-summary.ts
├── src/history/envelope.ts       # envelope and window (R5, R7)
├── src/tools/ha-history.ts       # runHistory / queryHistory: the pipeline
├── src/ping/requirements.ts      # the ha_history row (R15)
├── src/server.ts                 # registers ha_history from the contract, before ha_ping
├── test/fixtures/generate-history.ts
├── test/support/fake-ha.ts       # the history handler (R16)
├── test/…                        # see Testing
└── README.md                     # ha_history section, decoder table row

packages/sandbox/test/mcp.container.test.ts   # ha_history on each release (§8)
README.md                                     # the tool table row
.changeset/                                   # mcp minor, schema minor
```

**Structure Decision**: the tool follows `ha_logbook_query` and `ha_state`: a `tools/` entry point
and its own folder for selection and encoding. It reuses `logbook/selectors.ts`,
`logbook/window.ts`, `logbook/local-time.ts`, `logbook/envelope.ts` (the offset of the window
start), `snapshot/redact.ts`, and the attribute limits and `characterCount` of `state/inputs.ts`,
as they are. The format follows the `logbook/` and `state/` folders of `@domusops/schema`.

## Delivery

One pull request. User Stories 1 and 2 share every file (selection, encoding, limit). User Story
3 (`summary`) is small and rides with them, as in features 002, 003 and 010.
