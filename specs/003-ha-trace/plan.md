# Implementation Plan: ha_trace — Compressed Automation and Script Traces

**Branch**: `003-ha-trace` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-ha-trace/spec.md`

## Summary

Add a third MCP tool, `ha_trace`, beside `ha_snapshot` and `ha_logbook_query`. It returns the
stored traces of automations and scripts (runs and, from 2026.7, not-triggered traces), selected
by entity IDs or `*` patterns, a start-time window, a run ID, or a context ID taken from either
tool. It reuses the connection, configuration, administrator check, error model, selectors,
window, local-time code, and redaction, and adds three allowlisted read commands: `trace/list`,
`trace/contexts`, and `trace/get`. Records are redacted, then encoded in a new public format,
`domusops.trace/0.1`: `summary` is one row per run; `standard` is lossless, with a configuration
table, string and subtree tables, positional steps in execution order, exact timestamp offsets,
compact context IDs, and state objects and deltas. The lossless encoding measured 3.51x on the
maintainer's 92 live traces (3.26x per item); CI asserts 3x on a calibrated fixture. A result above
a configurable size limit (default 100,000 bytes) is refused with the run count, never truncated.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ES2023 target, NodeNext modules. Unchanged.

**Primary Dependencies**: `@modelcontextprotocol/sdk` 1.30.1, `zod` 4, Node 22's global
`WebSocket` and `Intl`. No new runtime dependency.

**Storage**: N/A. Stateless.

**Testing**: Vitest 2.1. New seeded trace fixture generator (reference set: 20 items × 5 runs,
calibrated to live measurements; performance set: 100 items, 500 runs), a hand-written trace
redaction fixture, and the fake instance extended with the three trace commands and a
not-admin `unauthorized` mode.

**Target Platform**: Node 22 LTS or later; stdio MCP server. Unchanged.

**Project Type**: Library (`@domusops/schema`) + CLI/MCP server (`@domusops/mcp`), existing pnpm
workspace.

**Performance Goals**: `summary` of 500 runs and `standard` of one item's runs each under 5 s
(SC-004). Live: every list, context, and extended record of 92 traces in 707 ms, sequential.

**Constraints**: `standard` lossless; ratio ≥ 3 on the reference fixture, asserted in CI.
Read-only (allowlist; no `trace/debug/*`). No partial or truncated results. Deterministic output.
Timeouts: 10 s connect and authenticate, 10 s per command, 30 s overall; up to 8 `trace/get` in
flight. Size limit 100,000 bytes by default, at both detail levels.

**Scale/Scope**: One instance per process. At about 150 bytes per run, the default limit admits
about 650 runs in `summary`; the largest live one-item `standard` response is 16 KB. One new tool,
two packages touched.

All unknowns (commands and fields, privileges, item resolution, retrieval, context matching, run
links, not-triggered traces, encoding, floor, size limit, step order, time representation,
redaction exemptions) are resolved in [research.md](./research.md). No `NEEDS CLARIFICATION`
remains.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                                                        | Pre-research | Post-design                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only                     | All artifacts in English                                                    | PASS         | PASS                                                                                                                                                    |
| §2 Spec precedes implementation     | Spec, plan, and tasks exist; `/speckit-analyze` before `/speckit-implement` | PASS         | PASS. Plan done; tasks and analyze are next                                                                                                             |
| §3 MCP holds no procedure           | Capability only, no workflow                                                | PASS         | PASS. Selection parameters shape one read; a context lookup is a filter, not a workflow; `too_large` names ways to narrow and never narrows on its own  |
| §4 Compression is a contract        | Ratio documented per tool; CI asserts a floor                               | PASS         | PASS. `compression_ratio` in every result; the description states "at least 3x"; CI asserts ≥ 3 on the fixture; the size limit bounds every response    |
| §5 Public schema, private judgement | Format in `@domusops/schema`, no dependency on paid code                    | PASS         | PASS. Types, JSON Schema, and the reference decoder `expandTrace` go to `@domusops/schema`                                                              |
| §6 Trademark hygiene                | No HA branding                                                              | PASS         | PASS. Tool name from the seed contract; title says "for Home Assistant"                                                                                 |
| §7 Destructive operations opt-in    | Mutating tools default to `dry_run`                                         | N/A          | PASS. Read-only; the allowlist gains three read commands and excludes the debug commands that control running scripts; `readOnlyHint: true`             |
| §8 Version support proven           | No unproven support claims                                                  | PASS         | PASS. Same refusal threshold (2025.1.0); the parser accepts records lacking newer keys (`not_triggered`, `template_errors`); no version list is written |
| §9 Trunk-based                      | Short-lived branch, changesets                                              | PASS         | PASS. Branch `003-ha-trace`, cut from `002-ha-logbook-query` (unmerged PR #3); minor bumps for `@domusops/schema` and `@domusops/mcp`                   |
| §10 Convenience, not secrecy        | No telemetry                                                                | PASS         | PASS. No traffic except to the configured instance                                                                                                      |

**Result**: no violations. §4 does not fix a number; the spec's floor of 5 is replaced by 3 on
measurement (research R6), a spec change recorded in its Clarifications.

## Project Structure

### Documentation (this feature)

```text
specs/003-ha-trace/
├── spec.md
├── plan.md                    # this file
├── research.md                # Phase 0
├── data-model.md              # Phase 1: format domusops.trace/0.1
├── quickstart.md              # Phase 1: validation scenarios
├── contracts/
│   ├── ha_trace.tool.json     # MCP tool definition as advertised
│   └── ha_trace.md            # input, result, error, and configuration contract
├── checklists/
│   └── requirements.md
└── tasks.md                   # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/schema/
├── src/
│   ├── index.ts                   # also re-exports the trace format
│   └── trace/
│       ├── format.ts              # TRACE_FORMAT, detail levels, document, run, step, record types
│       ├── values.ts              # value decoding: #n, $n, @ms, compact IDs, S, D, C, v (data-model §3.2)
│       ├── expand.ts              # reference decoder expandTrace: standard → extended records
│       └── json-schema.ts         # JSON Schema of the format
└── test/
    └── trace-expand.test.ts

packages/mcp/
├── src/
│   ├── errors.ts                  # + traces_unavailable, run_not_found, selection_invalid; too_large for runs
│   ├── server.ts                  # registers ha_trace beside the other two
│   ├── ha/
│   │   ├── client.ts              # allowlist + trace/list, trace/get, trace/contexts, closed params each
│   │   ├── config.ts              # + DOMUSOPS_TRACE_MAX_BYTES
│   │   └── trace.ts               # admin + config (trace component), registry, states, list, contexts, get (concurrent), shape checks
│   ├── trace/
│   │   ├── items.ts               # item resolution, untraceable, removed items, no_runs reasons
│   │   ├── select.ts              # selectors, window, run and context lookup, selection_invalid
│   │   ├── context-id.ts          # input parsing and suffix matching of context IDs
│   │   ├── values.ts              # value encoding: anchoring, escapes, S/C/D forms, tables
│   │   ├── encode-standard.ts     # configs, items, runs, steps, time order
│   │   └── encode-summary.ts
│   └── tools/
│       └── ha-trace.ts            # config → client → resolve → select → retrieve → redact → encode → limit
└── test/
    ├── fixtures/
    │   ├── generate-traces.ts     # seeded: reference set, performance set, edge cases
    │   └── trace-redaction.json   # planted token, configuration secret, coordinates, e-mail
    ├── support/fake-ha.ts         # + trace commands, not_found, unauthorized, unknown_command modes
    ├── trace-select.test.ts       # selectors, window, run, context (suffix match, shared contexts)
    ├── trace-values.test.ts       # anchoring, escapes, canonical timestamps, S/C/D
    ├── trace-encode.test.ts       # determinism, orders, floor, steps_order fallback
    ├── trace-roundtrip.test.ts    # expandTrace(standard) == redacted records
    ├── trace-redaction.test.ts    # oracle at both detail levels
    └── trace-tool.test.ts         # end to end: errors, size limit, performance, allowlist, no_runs

.changeset/*.md                    # minor: @domusops/schema, @domusops/mcp
```

**Structure Decision**: No new package. The format sits in its own `trace/` folder in
`@domusops/schema`, beside the snapshot and logbook formats, and reuses the logbook's compact
context ID code. In `@domusops/mcp`, only `ha/` talks to the instance; trace encoding gets its own
folder; errors, configuration, client, selectors, window, local time, redaction, and ratio are
reused or extended in place ([research R15](./research.md#r15-shared-code)).

Housekeeping, also in scope:

- `CLAUDE.md` "Current focus": `ha_trace`.
- The `ha_logbook_query` contract's "the server advertises two tools" becomes three; note it.
- The README gains an `ha_trace` section beside the other two.

## Decisions to confirm at review

1. **Floor of 3, lossless `standard`** (maintainer decision, 2026-09-26). 5x is not reachable
   without dropping the configuration, `this`, and trigger attributes, and even then not reliably
   ([research R6](./research.md#r6-compression-approach-for-standard-and-the-floor)).
2. **Floor margin.** Measured live with the shipped encoder: 3.07x over every stored trace, 2%
   above 3 (the prototype predicted 3.51x); one automation's 5 runs 2.63x; a single run 1.14x. The
   fixture is calibrated to 3.15x. A positional run encoding would add about 5%, at the cost of a
   format change ([research R6](./research.md#r6-compression-approach-for-standard-and-the-floor)).
3. **Not-triggered traces are included** as stored traces with outcome `not_triggered`, counted
   separately (research R10). They exist only from 2026.7.
4. **Context IDs match on their last 16 characters**, because the offset part differs between
   the tools (research R8). The tool description states the rule.
5. **Size limit of 100,000 bytes at both levels.** A `summary` of more than about 650 runs is
   refused; narrow by items or window.
6. **Branch base.** `003-ha-trace` starts from `002-ha-logbook-query`; its pull request targets
   that branch until PR #3 merges, then is rebased onto `main`.

## Complexity Tracking

No constitution violations to justify.
