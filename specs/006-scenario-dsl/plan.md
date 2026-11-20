# Implementation Plan: Scenarios — Declaring and Proving What an Automation Does

**Branch**: `006-scenario-dsl` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-scenario-dsl/spec.md`

## Summary

Add a declarative scenario format, `domusops.scenario/0.1`, to `@domusops/schema` (types, JSON
Schema, a dependency-free checker and normaliser), and a runner to `@domusops/sandbox` that drives
the existing harness from it. Scenario files are YAML 1.2 next to the configuration
(`<config>/scenarios`), checked with line and column before any instance starts. Each scenario
runs in its own fresh instance, measured at 10–14 s to ready on CI: stand-ins are `hass-virtual`
devices created under the real entity IDs, absent actions are answered by one new companion
command that wraps the action registry for declared patterns only, the clock is frozen at the
start moment, and one WebSocket records state changes, action calls and automation triggers for
the expectations. Results come out as a readable report and a compact
`domusops.scenario-report/0.1` document, through `loadScenarios` / `runScenarios` and a thin
`domusops-sandbox test` command. CI runs a reference suite on each matrix leg and the existing
required `sandbox-gate` fails on stable and previous-stable failures; a documented example
workflow is exercised against packed packages. The smoke check is untouched.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `tsconfig.base.json`), Node 22+. Companion addition
in Python inside the instance's interpreter, as in 005.

**Primary Dependencies**: `yaml` 2.x (new for the sandbox; already in the workspace through
`@domusops/bootstrap`) for parsing with positions (R2). `@domusops/schema` (workspace) becomes a
sandbox dependency again (R15). Existing: `tar`, `@domusops/mcp`, MCP SDK, `hass-virtual` v0.9.4
pinned. The schema package stays dependency-free (§5).

**Storage**: None. Scenario files are read; reports are written only where `--report` says.
Recorded events live in memory per scenario.

**Testing**: Vitest. Unit tests in `pnpm test` (schema checker and normaliser, JSON Schema
agreement via `ajv`, comparisons, duration and time parsing, starting-point resolution, YAML
positions, report rendering and size, exit status, CLI parsing, expectation evaluation against
recorded events with a fake handle). Container tests (`*.container.test.ts`) in the matrix legs:
the verification-before-building facts, the SEED example, stand-ins, absent actions, time and
sequences, determinism (20 runs).

**Target Platform**: as the harness: macOS and Linux with Docker or Podman; CI `ubuntu-latest`.

**Project Type**: additions to two existing library packages, one CLI subcommand, one companion
command, one fixture, CI changes and documentation.

**Performance Goals**: SEED example under 2 minutes cold (SC-001); 10 scenarios under 10 minutes
per release on CI (SC-005; estimate under 7 sequentially, R1); an hour of instance time under 30 s
real once ready (SC-006).

**Constraints**: Never an instance the harness did not create (FR-018); source directory never
written; token and named secret values never in output (FR-028); deterministic outcomes
(SC-004): frozen clock, fixed default date, fresh instance.

**Scale/Scope**: Suites of tens of scenarios; ≤ 20 000 recorded events per scenario. About 8
schema source files, 10 sandbox source files, one companion module, one fixture with ~10
scenarios.

All unknowns are resolved in [research.md](./research.md) (R1–R16). No `NEEDS CLARIFICATION`
remains.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                          | Pre-research | Post-design                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1 English-only                     | All artifacts in English                      | PASS         | PASS. Format keywords, messages, reports, fixture and docs in English (FR-032)                                                                                                                                                                                                                                                                                                                               |
| §2 Spec precedes implementation     | Spec, plan, tasks; analyze before implement   | PASS         | PASS. Clarified spec, this plan; tasks and analyze next                                                                                                                                                                                                                                                                                                                                                      |
| §3 MCP holds no procedure           | Workflow lives in skills                      | PASS         | PASS. No MCP tool is added; running a suite is a library call and a command                                                                                                                                                                                                                                                                                                                                  |
| §4 Compression is a contract        | Instance data sized for an agent              | PASS         | PASS. The machine report counts passes and details only failures; SC-009 is asserted by a test (R14)                                                                                                                                                                                                                                                                                                         |
| §5 Public schema, private judgement | Schema depends on nothing                     | PASS         | PASS. Format, report, checker and normaliser in the schema with no dependency; YAML parsing stays in the sandbox (R3)                                                                                                                                                                                                                                                                                        |
| §6 Trademark hygiene                | No HA branding                                | PASS         | PASS. Names say DomusOps or "scenario"; nominative wording only                                                                                                                                                                                                                                                                                                                                              |
| §7 Destructive operations opt-in    | Mutations default to dry run                  | N/A          | PASS in spirit. Scenarios mutate only instances the harness created (FR-018)                                                                                                                                                                                                                                                                                                                                 |
| §8 Version support proven           | stable, previous stable, beta in CI           | PASS         | PASS. The reference suite runs on all three legs (FR-030); the supported-versions table keeps coming from the smoke check (FR-029)                                                                                                                                                                                                                                                                           |
| §9 Trunk-based                      | Short branches, changesets, `main` releasable | PASS         | PASS with a risk: the scope exceeds three days. The first increment is two pull requests: PR-A, the format in the schema (Phase 1, Phase 2 and the schema half of US1, with the facts test), releasable alone; PR-B, the runner, stand-ins, absent actions, the `test` command and the gate (the rest of US1 and US2). Then US3, US4 and US5, one pull request each. Changesets: schema 0.3.0, sandbox 0.2.0 |
| §10 Convenience, not secrecy        | No telemetry, no obfuscation                  | PASS         | PASS. Apache-2.0, plain source; nothing phones home                                                                                                                                                                                                                                                                                                                                                          |

**Result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-scenario-dsl/
├── spec.md
├── plan.md                    # this file
├── research.md                # Phase 0: R1–R16, verification before building
├── data-model.md              # Phase 1: normalised scenario, run lifecycle, results, outcomes
├── quickstart.md              # Phase 1: ten validation scenarios
├── contracts/
│   ├── scenario-format.md     # domusops.scenario/0.1
│   ├── report-format.md       # domusops.scenario-report/0.1 and the readable report
│   ├── library-api.md         # schema and sandbox additions
│   ├── cli.md                 # domusops-sandbox test
│   └── companion.md           # domusops_sandbox/actions/absent
├── checklists/
│   └── requirements.md
└── tasks.md                   # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/schema/
├── src/
│   ├── index.ts                     # + scenario exports
│   └── scenario/
│       ├── format.ts                # constants, written and normalised types
│       ├── values.ts                # entity ids, actions, durations, times, dates
│       ├── check.ts                 # checkScenarioDocument → ScenarioIssue[]
│       ├── normalize.ts             # normalizeScenarioDocument
│       ├── resolve.ts               # resolveSuite: names, use, cycles
│       ├── compare.ts               # compareValue (R10)
│       ├── json-schema.ts           # scenarioJsonSchema
│       └── report.ts                # report types and scenarioReportJsonSchema
├── schema/                          # scenario.schema.json, scenario-report.schema.json (for editors)
├── scripts/write-schemas.mjs        # writes schema/ from the two constants
├── README.md                        # + the two formats
└── test/
    ├── scenario-check.test.ts       # every issue code, SEED example valid
    ├── scenario-normalize.test.ts
    ├── scenario-resolve.test.ts
    ├── scenario-compare.test.ts
    └── scenario-json-schema.test.ts # checker and JSON Schema agree; schema/ files match

packages/sandbox/
├── package.json                     # + yaml, + @domusops/schema
├── src/
│   ├── index.ts                     # + loadScenarios, runScenarios, renderReport, exitStatus
│   ├── cli.ts                       # + test subcommand
│   ├── instance/handle.ts           # + fireEvent
│   └── scenario/
│       ├── load.ts                  # find files, parse YAML, map issues to lines
│       ├── run.ts                   # runScenarios: targets, queue, parallel, time limit
│       ├── scenario.ts              # one scenario's lifecycle (data-model §2)
│       ├── prepare.ts               # stand-ins, absent actions, clock, starting states
│       ├── record.ts                # WebSocket subscriptions, Recorded[]
│       ├── expect.ts                # evaluate expectations against handle and record (R9)
│       ├── outcome.ts               # harness errors → causes, results
│       └── report.ts                # build, render, exit status, scrub
├── companion/custom_components/domusops_sandbox/
│   ├── __init__.py                  # + register actions/absent
│   └── actions.py                   # absent-action wrapper (R6)
├── fixtures/scenario-config/        # synthetic configuration + scenarios/ (reference suite)
├── docs/scenarios.md                # how to write and run scenarios; example CI workflow block
└── test/
    ├── scenario-load.test.ts        # positions, tags refused, path order, names
    ├── scenario-expect.test.ts      # fake handle + recorded events
    ├── scenario-run.test.ts         # lifecycle, outcomes, time limit, parallel (fake start)
    ├── scenario-report.test.ts      # rendering, SC-009 size, SC-007 secrets
    ├── scenario-cli.test.ts         # options, exit status, --check
    ├── scenario-example.test.ts     # docs block == CI job commands (FR-021a)
    ├── fixtures/scenarios-*/        # invalid, failing, could-not-run cases
    ├── scenario-facts.container.test.ts        # verification before building
    ├── scenario-reference.container.test.ts    # reference suite passes (SC-008)
    ├── scenario-standins.container.test.ts     # US2
    ├── scenario-time.container.test.ts         # US3, SC-006
    └── scenario-determinism.container.test.ts  # SC-004

packages/sandbox/scripts/supported-versions.mjs  # --gate also reads scenario reports
.github/workflows/ci.yml             # matrix legs run the suite; gate reads reports; scenario-example job
.changeset/                          # schema minor, sandbox minor
CLAUDE.md                            # Current focus
```

**Structure Decision**: The format is in `@domusops/schema/src/scenario`, the runner in
`@domusops/sandbox/src/scenario`. Only `scenario/scenario.ts` touches an instance, and only
through a `Sandbox` handle and its connection; the rest is pure and unit-tested. The reference
suite gets its own fixture so the smoke check's fixture and meaning do not change (FR-029).

## Verification before building

The five facts at the end of [research.md](./research.md) are checked by
`scenario-facts.container.test.ts` on all three channels before `actions.py`, `record.ts`,
`expect.ts` and `prepare.ts` are written.

## Decisions to confirm at review

1. **A fresh instance per scenario** (R1), based on 10–14 s ready times measured on CI. If a real
   suite outgrows SC-005, `--parallel` is the lever, not shared instances.
2. **Default date 2026-04-15, a Wednesday, and default time 12:00** (R8). Fixed in the format
   version: changing them later changes results, so it would need a new format version.
3. **Absent actions wrap a Home Assistant internal** (R6), probed per release like the clock; the
   matrix catches a release that changes it, and only scenarios that declare absent actions are
   affected.
4. **Exit status ranks failed (1) above could not run (3)** (R12).
5. **The gate is extended rather than adding a required check** (R13): no change to branch
   protection is needed.
6. **`brightness_pct` derived for lights** (R10), so the SEED expectation reads as written; no
   other derived attribute.
7. **Branch length (§9)**: PR-A (format) and PR-B (runner and gate) form the first increment;
   each later story is its own pull request from a short branch off `main`.
8. **Automations are off while the starting point is applied** (R16), so writing `given` fires
   nothing; they are turned on again before the first step.

## Complexity Tracking

No constitution violations to justify.
