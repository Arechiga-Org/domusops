# Implementation Plan: ha_snapshot — Compressed Instance Inventory

**Branch**: `001-ha-snapshot` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-ha-snapshot/spec.md`

## Summary

Add the first MCP tool, `ha_snapshot`. It returns a complete, redacted, compressed inventory of a
live Home Assistant instance: entities with their state and attributes, devices, areas,
integrations and config entries, and the core version. The tool opens one WebSocket connection
with Node 22's built-in client. It rejects unsupported versions before sending the token, requires
an administrator user (so state reads are unfiltered), and pipelines seven allowlisted read
commands. It redacts the retrieved data, then encodes it at one of three detail levels. `standard`
reaches the 10× floor losslessly relative to a published projection: a closed omission list,
default elision, integration → entry → domain grouping, shape templates with positional columns,
and short aliases for device and entry IDs. The format (`domusops.snapshot/0.1`) is a public
contract in `@domusops/schema`, with a reference decoder that the round-trip test uses.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ES2023 target, NodeNext modules

**Primary Dependencies**: `@modelcontextprotocol/sdk` 1.30.1 and `zod` 4 (runtime,
`@domusops/mcp`). The global `WebSocket` of Node 22 (no runtime WebSocket package). `ws` is a dev
dependency, for the fake instance in tests.

**Storage**: N/A. The tool is stateless: no cache, no files written.

**Testing**: Vitest 2.1: seeded fixture generator (500 and 1,000 entities), hand-written
redaction fixture, fake Home Assistant WebSocket server

**Target Platform**: Node 22 LTS or later on macOS, Linux, and Windows; stdio MCP server launched by
an MCP client

**Project Type**: Library (`@domusops/schema`) + CLI/MCP server (`@domusops/mcp`) in the existing
pnpm workspace

**Performance Goals**: A complete snapshot of 1,000 entities in under 5 s on a local network
(SC-004). The encoding cost is O(n) in records.

**Constraints**: `standard` ratio ≥ 10 on the 500-entity reference fixture, asserted in CI.
Read-only (command allowlist). No secret or coordinate in the output. No partial snapshots.
Deterministic output. Timeouts of 10 s to connect and authenticate, 10 s per command, and 30 s
overall. Instance version ≥ 2025.1.0 (refusal threshold).

**Scale/Scope**: One instance per server process. Designed for 100 to about 5,000 entities; the
performance target is set at 1,000. One tool, two packages touched.

All earlier unknowns (HA commands and privileges, version floor, WebSocket client, env var names,
MCP result shape, compression and ratio method, redaction rules, fixtures) are resolved in
[research.md](./research.md). No `NEEDS CLARIFICATION` remains.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                                                        | Pre-research     | Post-design                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only                     | All artifacts in English                                                    | PASS             | PASS. All spec artifacts are English; the `guard-language` hook accepted every write                                                                                                                                                                       |
| §2 Spec precedes implementation     | Spec, plan, and tasks exist; `/speckit-analyze` before `/speckit-implement` | PASS (spec done) | PASS. Plan done; tasks and analyze are next                                                                                                                                                                                                                |
| §3 MCP holds no procedure           | The tool is a capability, with no workflow or judgement                     | PASS             | PASS. One read; `detail` only selects the output shape; errors state a cause and a next step but never branch into other actions                                                                                                                           |
| §4 Compression is a contract        | Ratio documented per tool; CI asserts a floor                               | PASS             | PASS. `compression_ratio` in every result; the tool description states "at least 10x"; a CI test asserts ≥ 10 on the fixture                                                                                                                               |
| §5 Public schema, private judgement | `@domusops/schema` public and dependency-free of paid code                  | PASS             | PASS. Format types, JSON Schema, constants, and the reference decoder go to `@domusops/schema`; `@domusops/mcp` depends on it, never the reverse                                                                                                           |
| §6 Trademark hygiene                | No HA branding in names                                                     | PASS             | PASS. The tool name `ha_snapshot` comes from the seed contract and is nominative; packages are `@domusops/*`; docs say "for Home Assistant"                                                                                                                |
| §7 Destructive operations opt-in    | Mutating tools default to `dry_run`                                         | N/A (read-only)  | PASS. The client allowlist makes mutation structurally impossible; `readOnlyHint: true`                                                                                                                                                                    |
| §8 Version support proven           | No unproven support claims                                                  | PASS             | PASS. 2025.1.0 is documented as a refusal threshold only; no document lists supported or verified versions until the sandbox CI generates the matrix                                                                                                       |
| §9 Trunk-based                      | Short feature branch, changesets                                            | ATTENTION        | ATTENTION. The branch `001-ha-snapshot` does not exist yet (the spec files are uncommitted on `main`, which is protected). It must be created before the first commit. The changesets are planned (minor bumps for `@domusops/schema` and `@domusops/mcp`) |
| §10 Convenience, not secrecy        | No telemetry, no obfuscation                                                | PASS             | PASS. No network traffic except to the configured instance                                                                                                                                                                                                 |

**Result**: no violations. The only open item (§9) is a procedural step, not a design issue.

## Project Structure

### Documentation (this feature)

```text
specs/001-ha-snapshot/
├── spec.md
├── plan.md                     # this file
├── research.md                 # Phase 0
├── data-model.md               # Phase 1: snapshot format domusops.snapshot/0.1
├── quickstart.md               # Phase 1: validation scenarios
├── contracts/
│   ├── ha_snapshot.tool.json   # MCP tool definition as advertised
│   └── ha_snapshot.md          # result, error, and configuration contract
├── checklists/
│   └── requirements.md
└── tasks.md                    # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/schema/                      # public contract (constitution §5)
├── src/
│   ├── index.ts                      # re-exports; replaces the camelCase placeholder
│   ├── format.ts                     # FORMAT id, DetailLevel, document types (standard/summary/full)
│   ├── omitted.ts                    # closed omission list (data-model §6)
│   ├── defaults.ts                   # default values table (data-model §7)
│   ├── redaction.ts                  # REDACTION_MARKER constant
│   ├── json-schema.ts                # JSON Schema of the format, exported as a const
│   └── expand.ts                     # reference decoder: standard → projected full records
├── test/
│   └── expand.test.ts
└── tsconfig.test.json

packages/mcp/                         # capability plane
├── src/
│   ├── cli.ts                        # bin entry: start the stdio server (replaces the stub)
│   ├── server.ts                     # McpServer, tool registration
│   ├── errors.ts                     # SnapshotError kinds and message builders (data-model §9)
│   ├── tools/
│   │   └── ha-snapshot.ts            # config → client → retrieve → redact → encode → result
│   ├── ha/                           # the only code that talks to Home Assistant
│   │   ├── config.ts                 # DOMUSOPS_HA_URL / DOMUSOPS_HA_TOKEN validation
│   │   ├── version.ts                # version parsing and the 2025.1.0 floor
│   │   ├── client.ts                 # WebSocket handshake, allowlisted commands, timeouts
│   │   └── retrieve.ts               # pipelined retrieval, all-or-nothing
│   └── snapshot/
│       ├── redact.ts                 # rules K1, V1–V5, C1
│       ├── project.ts                # omission list + default elision
│       ├── templates.ts              # shape partitioning, const/cols, deterministic numbering
│       ├── encode-standard.ts
│       ├── encode-summary.ts
│       ├── encode-full.ts
│       └── ratio.ts                  # raw/emitted byte measurement
├── test/
│   ├── fixtures/
│   │   ├── generate.ts               # seeded generator (500 / 1,000 entities)
│   │   └── redaction.json            # planted high-entropy secrets and coordinates
│   ├── support/
│   │   └── fake-ha.ts                # ws-based fake instance with failure modes
│   ├── redact.test.ts
│   ├── encode.test.ts                # determinism, invariants, compression floor
│   ├── roundtrip.test.ts             # expand(standard) == project(full)
│   ├── client.test.ts                # handshake, version, auth, admin, timeouts, allowlist
│   └── tool.test.ts                  # end to end through the MCP server, including performance
└── tsconfig.test.json

vitest.config.ts                      # resolves @domusops/schema from source
eslint.config.js                      # scope extended to packages/*/test/**/*.ts
package.json                          # test script: drop --passWithNoTests; typecheck covers tests
.changeset/*.md                       # minor bumps: @domusops/schema, @domusops/mcp
```

**Structure Decision**: This uses the existing workspace; no new package. The format and its
reference decoder go in `@domusops/schema`, because paid and future tools (`ha_diff`, skills)
must be able to read snapshots without depending on the server (§5). Everything that touches
Home Assistant is confined to `packages/mcp/src/ha/` (technical constraint: no direct access to
Home Assistant outside the client module). `@domusops/sandbox` is untouched (out of scope).

Housekeeping, also in scope:

- `@domusops/mcp` declares `zod` directly, because it imports zod for the input schema.
- The dangling `main`/`types` fields of `@domusops/mcp` (there is no `index.ts`) are removed or
  pointed at a real entry.
- Stub comments that point to `01-SEED.md` and `specs/ha-snapshot/` are updated or removed.

## Decisions to confirm at review

These are within the spec, but they are judgement calls the maintainer may want to override
before tasks are generated:

1. **Omission list** ([data-model §6](./data-model.md#6-omitted-fields)). It reads FR-009's "every
   identifier" as the IDs that link records (FR-017's set). `unique_id`, device `connections`, and
   device `identifiers` are therefore omitted from `standard`. State timestamps (`last_changed`
   and similar) are omitted too, so "when did this change" is only answerable with
   `detail=full`.
2. **Personal data in config entry titles**: resolved. The spec now requires e-mail redaction
   (FR-024, rule V6); other account names are an accepted limitation
   ([research R8](./research.md#r8-redaction)).
3. **npm publishing** is outside this feature. SC-007 is verified with packed tarballs, and the
   `release` workflow's publish step still fails for lack of npm authentication
   ([research R10](./research.md#r10-distribution-npx-domusopsmcp)).

## Complexity Tracking

No constitution violations to justify.
