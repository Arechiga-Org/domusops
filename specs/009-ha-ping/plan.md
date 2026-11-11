# Implementation Plan: ha_ping — Knowing the Setup Works Before the First Query

**Branch**: `009-ha-ping` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-ha-ping/spec.md`

## Summary

A new read-only tool, `ha_ping`, the first of the `@domusops/mcp` 0.2.0 release. On one
connection it sends `auth/current_user` and `get_config`, keeps only the administrator flag, the
time zone and the list of loaded integrations, and answers with a small `domusops.ping/0.1`
document: the server's identity, the instance's version and support, whether the user is an
administrator, which needed integrations are loaded, and each other tool's readiness with its
reasons and next steps (research R1 to R5). Failures before the instance answers stay error
results (R6). The format is published in `@domusops/schema` with types and a JSON Schema (R9),
and the response carries a `compression_ratio` with a CI floor of 3 (R7).

## Technical Context

**Language/Version**: TypeScript 5.9, strict, shared `tsconfig.base.json`, Node 22 or later.

**Primary Dependencies**: no new ones. `@modelcontextprotocol/sdk`, `zod`, and the workspace's
`@domusops/schema`.

**Storage**: none.

**Testing**:

- Vitest against the simulated instance (`packages/mcp/test/support/fake-ha.ts`, with the
  reference fixture's `get_config` given the `logbook`, `recorder` and `trace` components where a
  test needs them).
- New test files: `packages/mcp/test/ping.test.ts`, `packages/mcp/test/ping-json-schema.test.ts`.
- Existing files gain cases: `tool.test.ts` (the tool's contract), `readme.test.ts` (the decoding
  example on a ping document), `client.test.ts` (`minVersion: null`),
  `packages/sandbox/test/mcp.container.test.ts` (§8).

**Target Platform**: any MCP client on macOS, Linux or WSL with Node 22 or later.

**Project Type**: two packages of the pnpm workspace, `packages/mcp` and `packages/schema`.

**Performance Goals**: two commands after the handshake, on one connection; a reachable instance
answers within the per-command limit (10 seconds by default), an unreachable one fails within
the connection limit (SC-004).

**Constraints**:

- No new command on the client's allowlist (research R1).
- The outputs of `ha_snapshot`, `ha_logbook_query` and `ha_trace` do not change (FR-015).
- Under 2,000 bytes in the worst case of research R8 (SC-003).

**Scale/Scope**: one tool, one format, about 300 lines of source and 400 of tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                      | Status | How                                                                                                                                |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only              | Pass   | Every artifact in English; the hook enforces it                                                                                    |
| §2 Spec before code          | Pass   | Spec, clarifications, this plan, then tasks and analyze before implementing                                                        |
| §3 No procedure in the MCP   | Pass   | The tool reports facts and a static requirements table (R4); it never sequences other tools or decides what the agent does next    |
| §4 Compression is a contract | Pass   | `compression_ratio` on every response and a CI floor of 3 on the reference fixture (R7); no raw answer is passed through           |
| §5 Public, stable schema     | Pass   | New versioned format `domusops.ping/0.1` with types and JSON Schema in `@domusops/schema` (R9); no existing format changes         |
| §6 Trademark hygiene         | Pass   | The tool title says "for Home Assistant", nominatively                                                                             |
| §7 Destructive is opt-in     | Pass   | Read-only; `readOnlyHint` true, `destructiveHint` false                                                                            |
| §8 Support is proven         | Pass   | The sandbox container test runs `ha_ping` on stable, previous stable and beta in CI                                                |
| §9 Trunk-based, changesets   | Pass   | Minor changesets for `@domusops/mcp` and `@domusops/schema`; the Version Packages pull request waits for features 010 to 012 (R12) |
| §10 Convenience, not secrecy | Pass   | Nothing depends on the source staying private                                                                                      |

Post-design re-check: still passes. The one deviation from the feature description (a
compression floor where the description asked for none) resolves in favour of §4, as the spec's
Assumptions record.

## Project Structure

### Documentation (this feature)

```text
specs/009-ha-ping/
├── spec.md
├── plan.md               # this file
├── research.md           # R1 to R12
├── data-model.md         # the ping document, readiness, next steps
├── quickstart.md
├── contracts/
│   ├── ha_ping.tool.json # the tool as the server advertises it
│   └── ping-format.md    # domusops.ping/0.1, with examples
├── checklists/
│   └── requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
packages/schema/
├── src/ping/format.ts          # PING_FORMAT and the document types
├── src/ping/json-schema.ts     # pingJsonSchema
├── src/index.ts                # exports
├── (no test: the format is tested from packages/mcp, which has ajv)
└── README.md                   # the format's row

packages/mcp/
├── src/package-info.ts         # SERVER_NAME, readVersion, packageVersion (moved from server.ts, R11)
├── src/ha/client.ts            # minVersion: null disables the refusal (R3)
├── src/ping/requirements.ts    # what each tool needs (R4)
├── src/ping/encode.ts          # the document, readiness and next steps (data model)
├── src/tools/ha-ping.ts        # runPing: config, connection, two reads, encoding, ratio
├── src/server.ts               # registers ha_ping from the contract
├── test/ping.test.ts
├── test/tool.test.ts           # contract and requirements-table checks
├── test/readme.test.ts         # the decoding example on a ping document (R10)
├── test/client.test.ts         # minVersion: null
└── README.md                   # ha_ping section, decoder table row, example change

packages/sandbox/test/mcp.container.test.ts   # ha_ping on each release (§8)
.changeset/                                   # mcp minor, schema minor
```

**Structure Decision**: the tool follows the layout of `ha_logbook_query` and `ha_trace` (a
`tools/` entry point and a folder of its own for the encoding), and its format follows the
`logbook/` and `trace/` folders of `@domusops/schema`.

## Delivery

One user story pair, one pull request: the two stories share every file, and the tool is small.
