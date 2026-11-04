# Implementation Plan: mcp reliability — A Server That Loads, Says What It Is, and Filters Better

**Branch**: `008-mcp-reliability` (spec), then one branch per story | **Date**: 2026-11-04 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-mcp-reliability/spec.md`

## Summary

Release 0.1.2 of `@domusops/mcp`, four stories, one pull request each:

- **US1** reports the package's real version in the handshake, read from `package.json` at start
  (research R1).
- **US2** rewrites the README's setup: a development dependency of the configuration repository
  as the recommended installation, a Claude Code section, and which `@domusops/schema` decoder
  reads each response, with a test that keeps the README's versions and example correct (R7,
  R8).
- **US3** adds `exclude` to `ha_logbook_query` and `ha_trace`, reusing the `entities` validator
  and matcher, applied after `entities` (R3).
- **US4** makes `ha_trace` warn when stored runs may no longer reach the window start: it counts
  each item's stored runs per bucket from `trace/list`, reads the limit with
  `automation/config` or `script/config` only for candidates, and names at most 10 items (R4,
  R5).

Notes travel as extra text blocks after the unchanged document (R2), so no published format
changes. The tool contracts move to this feature's `contracts/` (R6).

## Technical Context

**Language/Version**: TypeScript 5.9, strict, shared `tsconfig.base.json`, Node 22 or later.

**Primary Dependencies**: no new ones. `@modelcontextprotocol/sdk` (multi-block tool results),
`zod` (input schemas), `@domusops/schema` (decoders used by the README test).

**Storage**: none.

**Testing**:

- Vitest unit tests against the simulated instance (`test/support/fake-ha.ts`), extended to
  answer `automation/config` and `script/config` and to hold runs and not-triggered records per
  item.
- New test files: `server-version`, `readme`, `logbook-exclude`, `trace-exclude`,
  `trace-discarded` (quickstart).
- `packages/sandbox/test/mcp.container.test.ts` gains the discarded-runs and exclusion checks
  against real releases (§8).

**Target Platform**: any MCP client on macOS, Linux or WSL with Node 22 or later; Claude Code is
the documented one.

**Project Type**: one package of the existing pnpm workspace (`packages/mcp`), plus its README.

**Performance Goals**:

- A windowed `ha_trace` adds at most one configuration read per candidate item, in parallel
  within the existing limit of 8 in flight; a query without a window adds none.
- `exclude` adds no request to the instance.

**Constraints**:

- Every output for inputs without `exclude`, and without a window that triggers the warning, is
  byte-identical to 0.1.1 (FR-017); compression floors unchanged (§4).
- No published format changes (§5); notes bounded (R5).
- The token never appears in a note, the README, or a committed example.

**Scale/Scope**: about 5 source files and 6 test files in `packages/mcp`, the README, two
contracts, one container test.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                      | Status | How                                                                                                             |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| §1 English-only              | Pass   | Every artifact, note and README text is in English                                                              |
| §2 Spec before code          | Pass   | Spec, clarifications, this plan, then tasks and `/speckit.analyze` before implementation                        |
| §3 No procedure in the MCP   | Pass   | `exclude` is a filter and the warning is data about what the instance kept; no sequencing or judgement is added |
| §4 Compression is a contract | Pass   | Documents unchanged; notes are a few hundred bytes and bounded; floors unchanged                                |
| §5 Public schema             | Pass   | No format changes; notes travel outside the document (clarification 1)                                          |
| §6 Trademark hygiene         | Pass   | The README keeps nominative use ("for Home Assistant")                                                          |
| §7 Destructive opt-in        | N/A    | No mutating tool                                                                                                |
| §8 Proven support            | Pass   | The configuration reads and the trace buckets are checked by the container test on stable and previous stable   |
| §9 Changesets                | Pass   | US1 to US4 each add a patch changeset for `@domusops/mcp`; they release together as 0.1.2                       |
| §10 Convenience              | Pass   | Free package, documentation only adds setup convenience                                                         |

Post-design re-check: still passing. The one structural change, moving the contracts (R6), adds
no violation.

## Project Structure

### Documentation (this feature)

```text
specs/008-mcp-reliability/
├── spec.md
├── plan.md                  # this file
├── research.md              # R1–R8
├── data-model.md            # exclusion, stored-run limit, notes
├── quickstart.md
├── contracts/
│   ├── ha_logbook_query.tool.json
│   ├── ha_trace.tool.json
│   ├── response-notes.md
│   └── readme.md
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code (repository root)

```text
packages/mcp/
├── README.md                     # US2 (+ exclude and notes in the tool sections, US3/US4)
├── src/
│   ├── server.ts                 # US1 version; US2–US4 contracts, multi-block results, exclude
│   ├── tools/ha-logbook-query.ts # US3: exclusion, note
│   ├── tools/ha-trace.ts         # US3: exclusion; US4: limits and note
│   ├── trace/select.ts           # US3: exclude in parseRequest and selectTraces
│   ├── trace/discarded.ts        # US4: new — affected items from trace/list and limits
│   ├── ha/trace.ts               # US4: readStoredLimits (automation/config, script/config)
│   └── notes.ts                  # US3/US4: new — note wording (contracts/response-notes.md)
└── test/
    ├── support/fake-ha.ts        # config commands, buckets
    ├── server-version.test.ts    # US1
    ├── readme.test.ts            # US2
    ├── logbook-exclude.test.ts   # US3
    ├── trace-exclude.test.ts     # US3
    ├── trace-discarded.test.ts   # US4
    ├── logbook-contract.test.ts  # points at 008 contracts
    └── trace-tool.test.ts        # points at 008 contracts
packages/sandbox/test/mcp.container.test.ts   # US3/US4 against real releases
.changeset/                                   # one patch changeset per story
```

**Structure Decision**: all code stays in `packages/mcp`; the only file outside it is the
container test, which already drives the built server against the sandbox.

## Delivery

- One pull request per story, in order US1, US2, US3, US4. US2 writes the setup and decoding
  sections; US3 and US4 each add their own lines (`exclude`, notes) to the tool sections of the
  README, so it never describes something unreleased.
- The gate (lint, typecheck, test) is green on each pull request; the container test runs in CI
  on stable, previous stable and beta.
- The Version Packages pull request then releases `@domusops/mcp` 0.1.2 alone.

## Complexity Tracking

No violations to justify.
