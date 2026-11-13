# Implementation Plan: ha_system_log — Reading What the Instance Complained About

**Branch**: `012-ha-system-log` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-ha-system-log/spec.md`

## Summary

A new read-only tool, `ha_system_log`, the last of the `@domusops/mcp` 0.2.0 release. On one
connection it checks for an administrator and the `system_log` integration, then reads
`system_log/list`, a new allowlisted read with no parameter (research R1, R2). Each entry is given
the integration of its logger or, for a library's logger, of its source path (R3); filtered by
`integrations`, `exclude`, `level` and `start` (R4); re-rooted so no absolute path of the host
appears (R7) and redacted with the existing text rules (R8); and encoded as a
`domusops.system_log/0.1` document: entries in time order grouped by local date, with file paths,
frames and repeated traceback lines given once in shared tables (R5, R6). At `summary`, counts per
integration and level (R10). Results above `DOMUSOPS_SYSTEM_LOG_MAX_BYTES` are refused (R9). The
format ships in `@domusops/schema` with types, a JSON Schema and the decoder `expandSystemLog`
(R13). Every response carries a `compression_ratio`, with a CI floor of 1.8 on the reference
fixture (R12). `ha_ping` lists the tool through the requirements row its tests already expect
(R15).

## Technical Context

**Language/Version**: TypeScript 5.9, strict, shared `tsconfig.base.json`, Node 22 or later.

**Primary Dependencies**: no new ones. `@modelcontextprotocol/sdk`, `zod`, and the workspace's
`@domusops/schema`.

**Storage**: none.

**Testing**:

- Vitest against the simulated instance (`packages/mcp/test/support/fake-ha.ts`, which gains a
  `system_log/list` handler that follows research R1) and a new reference fixture,
  `packages/mcp/test/fixtures/generate-system-log.ts` (R14).
- New test files:
  - `packages/mcp/test/system-log.test.ts`: the tool, integration attribution, filters, notes,
    errors, reads.
  - `packages/mcp/test/system-log-encode.test.ts`: layout, parts, roots, order, floor, summary.
  - `packages/mcp/test/system-log-roundtrip.test.ts`: encode, then `expandSystemLog`.
  - `packages/mcp/test/system-log-json-schema.test.ts`.
  - `packages/mcp/test/system-log-redaction.test.ts`: a seeded fixture, SC-004.
  - `packages/schema/test/system-log-expand.test.ts`.
- Existing files gain cases:
  - `tool.test.ts`: the contract and the requirements row.
  - `ping.test.ts`: `ha_system_log` listed and ready, and not ready without `system_log`.
  - `client.test.ts`: the new command refuses any parameter.
  - `readme.test.ts`: the decoding example on a system log document.
  - `cli.test.ts`: the tool list.
  - `config.test.ts`: the new limit variable.
  - `selectors` and `errors` cases for the integration selector subject.
  - `packages/sandbox/test/mcp.container.test.ts` (§8), with a temporary configuration holding a
    synthetic custom integration that logs on a service call (R14).

**Target Platform**: any MCP client on macOS, Linux or WSL with Node 22 or later.

**Project Type**: two packages of the pnpm workspace, `packages/mcp` and `packages/schema`.

**Performance Goals**: three commands after the handshake on one connection. The answer is bounded
by the instance's `max_entries` (50 by default), so `system_log/list` keeps the per-command time
limit.

**Constraints**:

- One new command on the client's allowlist, a read, with no parameter (R1).
- The outputs of `ha_snapshot`, `ha_logbook_query`, `ha_trace`, `ha_state`, `ha_history` and
  `ha_ping` do not change, except that `ha_ping` lists the new tool (FR-020). Every error wording
  they use stays; the new wordings come from new subjects or new functions (R2, R4, R9). The
  `entity_history` subject of `notAdmin` is renamed `required`, an internal name; its wording does
  not change.
- Everything under the limit or refused.

**Scale/Scope**: one tool, one format with a decoder, about 700 lines of source and 900 of tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                      | Status | How                                                                                                                                          |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only              | Pass   | Every artifact in English; the hook enforces it                                                                                              |
| §2 Spec before code          | Pass   | Spec, clarifications, this plan, then tasks and analyze before implementing                                                                  |
| §3 No procedure in the MCP   | Pass   | Attribution, filters and counts are capabilities; the tool never chains other tools. Diagnosing from the log is the agent's or a skill's job |
| §4 Compression is a contract | Pass   | `compression_ratio` on every response, a CI floor of 1.8 on the reference fixture (R12), a byte limit with a narrowing message (R9)          |
| §5 Public, stable schema     | Pass   | New versioned format `domusops.system_log/0.1` with types, JSON Schema and decoder in `@domusops/schema` (R13); no existing format changes   |
| §6 Trademark hygiene         | Pass   | The tool title says "for Home Assistant", nominatively                                                                                       |
| §7 Destructive is opt-in     | Pass   | Read-only; the new command is a read; the write and clear actions are never called; `readOnlyHint` true, `destructiveHint` false             |
| §8 Support is proven         | Pass   | The sandbox container test runs `ha_system_log` on stable, previous stable and beta in CI                                                    |
| §9 Trunk-based, changesets   | Pass   | Minor changesets for `@domusops/mcp` and `@domusops/schema`; the Version Packages pull request is merged after this feature (R15)            |
| §10 Convenience, not secrecy | Pass   | Nothing depends on the source staying private                                                                                                |

Post-design re-check: still passes. The floor of 1.8 is the lowest of the tools (logbook 5,
history 5, trace 3, ping 3, state 2): a log entry is mostly free text that appears once, and the
prototype reaches 2.05 by folding what repeats, the structure and the tracebacks (R12). The
`summary` is the compact view when the entries do not fit.

## Project Structure

### Documentation (this feature)

```text
specs/012-ha-system-log/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R1 to R15
├── data-model.md                   # raw entry, envelope, standard, summary, decoded entry, errors
├── quickstart.md
├── contracts/
│   ├── ha_system_log.tool.json     # the tool as the server advertises it
│   └── system-log-format.md        # domusops.system_log/0.1, with examples, notes and errors
├── checklists/
│   └── requirements.md
└── tasks.md                        # /speckit-tasks
```

### Source Code (repository root)

```text
packages/schema/
├── src/system-log/format.ts        # SYSTEM_LOG_FORMAT, detail levels, document and entry types
├── src/system-log/json-schema.ts   # systemLogJsonSchema
├── src/system-log/expand.ts        # expandSystemLog (R13)
├── src/index.ts                    # exports
├── test/system-log-expand.test.ts
└── README.md                       # the format's row and decoder

packages/mcp/
├── src/ha/client.ts                # system_log/list on the allowlist (R1)
├── src/ha/system-log.ts            # readSystemLog: the read, its validation, unknown_command (R1, R2)
├── src/ha/instance.ts              # config_dir from get_config (R7)
├── src/ha/config.ts                # DOMUSOPS_SYSTEM_LOG_MAX_BYTES (R9)
├── src/errors.ts                   # notAdmin("required"), systemLogUnavailable, selectorInvalid
│                                   # subject, inputInvalid("system_log"), tooLargeSystemLog
├── src/notes.ts                    # emptyLogNote, noEntryMatchedNote (R15)
├── src/logbook/selectors.ts        # the integration selector kind (R4)
├── src/snapshot/redact.ts          # redactString exported for text (R8)
├── src/system-log/inputs.ts        # integrations, exclude, level, start, detail (R4)
├── src/system-log/entries.ts       # integration attribution, filters, order (R3, R4, R5)
├── src/system-log/paths.ts         # the three roots (R7)
├── src/system-log/traceback.ts     # frames and lines, parts and files (R6)
├── src/system-log/encode-standard.ts
├── src/system-log/encode-summary.ts
├── src/system-log/envelope.ts      # envelope and times (R11)
├── src/tools/ha-system-log.ts      # runSystemLog / querySystemLog: the pipeline
├── src/ping/requirements.ts        # the ha_system_log row (R15)
├── src/server.ts                   # registers ha_system_log from the contract, before ha_ping
├── test/fixtures/generate-system-log.ts
├── test/support/fake-ha.ts         # the system log handler (R14)
├── test/…                          # see Testing
└── README.md                       # ha_system_log section, decoder table row

packages/sandbox/test/mcp.container.test.ts   # ha_system_log on each release (§8)
README.md                                     # the tool table row
.changeset/                                   # mcp minor, schema minor
```

**Structure Decision**: the tool follows `ha_history` and `ha_state`: a `tools/` entry point and
its own folder for attribution and encoding. It reuses `logbook/selectors.ts` (with a new
selector kind), `logbook/window.ts` and `logbook/local-time.ts` for `start` and local times,
`logbook/envelope.ts` for the offset, `snapshot/redact.ts` for text, and `util/json.ts` for keys
written as data. The format follows the `history/` folder of `@domusops/schema`.

## Delivery

One pull request. User Stories 1 and 2 share every file (attribution, filters, encoding, limit).
User Story 3 (`summary`) is small and rides with them, as in features 002, 003, 010 and 011.
After it merges, the Version Packages pull request (#36) releases 0.2.0.
