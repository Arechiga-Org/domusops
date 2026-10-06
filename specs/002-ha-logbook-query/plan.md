# Implementation Plan: ha_logbook_query — Compressed Activity History

**Branch**: `002-ha-logbook-query` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-ha-logbook-query/spec.md`

## Summary

Add a second MCP tool, `ha_logbook_query`, beside `ha_snapshot`. It returns the logbook events of
a time window (default: the last 24 hours), optionally narrowed by entity IDs or `*` patterns, in
order, each with its cause. It reuses the `ha_snapshot` connection, configuration, administrator
check, error model, and redaction, and adds one allowlisted read command, `logbook/get_events`.
Rows are redacted, then encoded in a new public format, `domusops.logbook/0.1`: an entity table
with per-entity constants and positional columns, a cause table, a string table, compact context
IDs, and readable local times (`MM:SS` in day and hour buckets). The encoding measured 5.37x on
the maintainer's live 24-hour logbook and 6.47x on a week; CI asserts 5x on a calibrated fixture.
A `standard` result above a configurable size limit (default 100,000 bytes) is refused with the
event count, never truncated.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ES2023 target, NodeNext modules. Unchanged from 001.

**Primary Dependencies**: `@modelcontextprotocol/sdk` 1.30.1, `zod` 4, Node 22's global
`WebSocket` and `Intl` (time zones). No new runtime dependency. `ws` stays a dev dependency.

**Storage**: N/A. Stateless.

**Testing**: Vitest 2.1. New seeded logbook fixture generator (24-hour reference window,
calibrated to live measurements; 1,000-entity performance window), a hand-written logbook
redaction fixture, and the existing fake instance extended with `logbook/get_events`.

**Target Platform**: Node 22 LTS or later; stdio MCP server. Unchanged.

**Project Type**: Library (`@domusops/schema`) + CLI/MCP server (`@domusops/mcp`), existing pnpm
workspace.

**Performance Goals**: 24 hours over 1,000 entities in under 5 s (SC-004). Live: a 24-hour query
took 437 ms and a 7-day query 3.3 s at the instance ([research R5](./research.md#r5-live-measurements)).

**Constraints**: `standard` ratio ≥ 5 on the reference fixture, asserted in CI. Read-only
(allowlist). No partial or truncated results. Deterministic output. Timeouts: 10 s connect and
authenticate, 10 s per metadata command, and `logbook/get_events` bounded only by the 30 s
overall deadline. Size limit 100,000 bytes by default.

**Scale/Scope**: One instance per process. At about 37 bytes per event, the default limit admits
about 2,700 events in one `standard` result; `summary` has no limit. One new tool, two packages
touched.

All unknowns (logbook command and fields, privileges, time zones, selector strategy, encoding,
floor, size limit, timeouts, redaction of free text) are resolved in
[research.md](./research.md). No `NEEDS CLARIFICATION` remains.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                                                        | Pre-research | Post-design                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only                     | All artifacts in English                                                    | PASS         | PASS. The `guard-language` hook accepted every write                                                                                                                      |
| §2 Spec precedes implementation     | Spec, plan, and tasks exist; `/speckit-analyze` before `/speckit-implement` | PASS         | PASS. Plan done; tasks and analyze are next                                                                                                                               |
| §3 MCP holds no procedure           | Capability only, no workflow                                                | PASS         | PASS. One read. Selectors and `detail` shape the query and output; `too_large` names ways to narrow but never narrows or retries on its own                               |
| §4 Compression is a contract        | Ratio documented per tool; CI asserts a floor                               | PASS         | PASS. `compression_ratio` in every result; the description states "at least 5x"; CI asserts ≥ 5 on the fixture; the size limit keeps even compressed output within budget |
| §5 Public schema, private judgement | Format in `@domusops/schema`, no dependency on paid code                    | PASS         | PASS. Types, JSON Schema, and the reference decoder `expandLogbook` go to `@domusops/schema`                                                                              |
| §6 Trademark hygiene                | No HA branding                                                              | PASS         | PASS. Tool name from the seed contract; title says "for Home Assistant"                                                                                                   |
| §7 Destructive operations opt-in    | Mutating tools default to `dry_run`                                         | N/A          | PASS. Read-only; the allowlist gains one read command; `readOnlyHint: true`                                                                                               |
| §8 Version support proven           | No unproven support claims                                                  | PASS         | PASS. Same refusal threshold (2025.1.0); the parser accepts rows lacking newer keys; no version list is written                                                           |
| §9 Trunk-based                      | Short-lived branch, changesets                                              | PASS         | PASS. Branch `002-ha-logbook-query` exists; minor bumps for `@domusops/schema` and `@domusops/mcp`, noting the stricter redaction in `ha_snapshot`                        |
| §10 Convenience, not secrecy        | No telemetry                                                                | PASS         | PASS. No traffic except to the configured instance                                                                                                                        |

**Result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-ha-logbook-query/
├── spec.md
├── plan.md                          # this file
├── research.md                      # Phase 0
├── data-model.md                    # Phase 1: format domusops.logbook/0.1
├── quickstart.md                    # Phase 1: validation scenarios
├── contracts/
│   ├── ha_logbook_query.tool.json   # MCP tool definition as advertised
│   └── ha_logbook_query.md          # input, result, error, and configuration contract
├── checklists/
│   └── requirements.md
└── tasks.md                         # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/schema/
├── src/
│   ├── index.ts                     # also re-exports the logbook format
│   └── logbook/
│       ├── format.ts                # LOGBOOK_FORMAT, LOGBOOK_DETAIL_LEVELS, document and row types
│       ├── ulid.ts                  # compact context ID encode/decode (data-model §3.2)
│       ├── project.ts               # projection P1, P2 (data-model §5)
│       ├── expand.ts                # reference decoder expandLogbook: standard → projected rows
│       └── json-schema.ts           # JSON Schema of the format
└── test/
    └── logbook-expand.test.ts

packages/mcp/
├── src/
│   ├── errors.ts                    # SnapshotError → ToolError (tool name in the text); new kinds
│   ├── server.ts                    # registers ha_logbook_query beside ha_snapshot
│   ├── ha/
│   │   ├── client.ts                # allowlist + logbook/get_events; params for it only; per-command budget
│   │   ├── config.ts                # + DOMUSOPS_LOGBOOK_MAX_BYTES
│   │   └── logbook.ts               # admin + config, history check, get_events, row shape checks
│   ├── snapshot/
│   │   ├── redact.ts                # generic entry point; exemption sets per record kind; rules C2, C3
│   │   └── ratio.ts                 # finalize() generalised over document types
│   ├── logbook/
│   │   ├── window.ts                # ISO parsing, time-zone resolution, defaults, clamping
│   │   ├── selectors.ts             # validation, deduplication, matching, no_events
│   │   ├── local-time.ts            # epoch → local date, hour key, MM:SS (Intl)
│   │   ├── encode-standard.ts       # tables, columns, buckets, compact context IDs
│   │   └── encode-summary.ts
│   └── tools/
│       └── ha-logbook-query.ts      # config → client → retrieve → select → redact → encode → limit
└── test/
    ├── fixtures/
    │   ├── generate-logbook.ts      # seeded: 24-hour reference, 1,000-entity performance
    │   └── logbook-redaction.json   # planted secrets, coordinates, e-mail addresses in messages and states
    ├── support/fake-ha.ts           # + logbook/get_events, entity_ids filtering, unknown_command mode
    ├── logbook-window.test.ts
    ├── logbook-selectors.test.ts
    ├── logbook-encode.test.ts       # determinism, invariants, floor, DST hour keys
    ├── logbook-roundtrip.test.ts    # expandLogbook(standard) == projectLogbook(rows)
    ├── logbook-redaction.test.ts    # oracle at both detail levels, C2, C3
    └── logbook-tool.test.ts         # end to end: errors, size limit, performance, allowlist

.changeset/*.md                      # minor: @domusops/schema, @domusops/mcp
```

**Structure Decision**: No new package. The new format sits in its own `logbook/` folder in
`@domusops/schema`, beside the snapshot format, so the two stay independent while sharing the
redaction marker. In `@domusops/mcp`, only `ha/` talks to the instance (unchanged rule); logbook
encoding gets its own folder, and the pieces both tools use (errors, configuration, client,
redaction, ratio) are generalised in place rather than copied ([research R11](./research.md#r11-shared-code)).
`ha_snapshot` output does not change, except that the new coordinate rules C2 and C3 can redact
more.

Housekeeping, also in scope:

- `CLAUDE.md` "Current focus" still says nothing but `ha_snapshot` may land; update it to this
  feature.
- The `ha_snapshot` contract's "Tools advertised: `ha_snapshot` only" becomes outdated; note the
  second tool there.

## Decisions to confirm at review

1. **Readable times at second precision** (maintainer decision, 2026-09-26). Sub-second precision
   is not in the output; order is. Cost against millisecond deltas: 5.37x instead of 5.99x on 24
   hours ([research R6](./research.md#r6-compression-approach-for-standard)).
2. **Floor margin is thin.** The live 24-hour ratio is 7% above 5x. A busier or more varied
   instance may fall below it; the live check blocks release in that case, as in 001.
3. **Size limit default of 100,000 bytes.** It fits the maintainer's full 24-hour logbook (about
   79 KB) and refuses a full week. A different default only changes one constant.
4. **Stricter redaction in `ha_snapshot`.** Rules C2 and C3 apply to both tools. Its output can
   change (more `[redacted]` markers), which the `@domusops/mcp` changeset states.
5. **Pattern queries follow the instance's YAML logbook exclusions; exact IDs do not.** This is
   the instance's behaviour, documented rather than worked around.

## Complexity Tracking

No constitution violations to justify.
