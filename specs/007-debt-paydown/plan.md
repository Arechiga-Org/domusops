# Implementation Plan: debt paydown — Close the Gaps Left After the 0.1.0 Release

**Branch**: `007-debt-paydown` (spec), then one branch per story | **Date**: 2026-10-22 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-debt-paydown/spec.md`

## Summary

Six independent fixes, one pull request each:

- **US1** makes `ha_trace` fail fast and never leave a request hanging:
  - `getTraces` stops on the first failed read, and `HaClient.close()` rejects what is pending;
  - independent reads run together;
  - `standard` stops reading as soon as a partial encoding proves the result is too large, which
    is sound because the encoding never shrinks as runs are added (property-tested).
- **US2** publishes without a stored secret:
  - npm trusted publishing through the existing changesets flow, with npm ≥ 11.5.1 on the
    runner, no `.npmrc`, and no token fallback;
  - every action on its node24 major, with the release workflow SHA-pinned;
  - `src/` shipped so source maps resolve, a schema README, and a test of what each package
    publishes.
- **US3** hardens the sandbox:
  - a device state file in the container lets attached handles add devices;
  - a per-user random machine identifier replaces the host name for ownership, with the 0.1.0
    rule kept for old labels;
  - the companion probes the Home Assistant internals that time control needs and reports
    `time_unavailable` instead of failing to load;
  - hass-virtual is pinned by commit and verified by a content digest;
  - the redaction test uses a token that only the specific redaction removes.
- **US4** makes bootstrap safe on rare paths:
  - generated comments use the pinned `npx` form;
  - add-key and remove-key refuse a `.sops.yaml` in the record's `edited` state;
  - `init` reports when the local key is not a recipient.
- **US5** removes duplication and dead code in `@domusops/mcp` with no output change.
- **US6** updates `CLAUDE.md`'s current focus.

## Technical Context

**Language/Version**:

- TypeScript 5.9, strict, with the shared `tsconfig.base.json`, on Node 22 or later.
- The sandbox companion is Python and runs inside Home Assistant's interpreter.

**Primary Dependencies**:

- No new runtime dependencies.
- Existing: `@modelcontextprotocol/sdk` (mcp), `tar` (sandbox), `yaml` (bootstrap), Node
  built-ins.
- CI and release:
  - actions/checkout v7, actions/setup-node v7, actions/upload-artifact v7,
    actions/download-artifact v8, pnpm/action-setup v6, changesets/action v2 (all node24,
    research R6);
  - npm CLI 11.5.1 or later on the release runner (R5).

**Storage**:

- New: one per-user file, `$XDG_STATE_HOME/domusops/machine-id` (data-model §1).
- New: one file inside each sandbox container, `/config/.domusops_sandbox/devices.json` (§3).
- The hass-virtual cache moves to extracted files under a commit-named directory (§4).

**Testing**:

- Vitest, with the existing split between unit tests and `*.container.test.ts`.
- New: a repository-level `scripts/test/` suite (package contents, R8), included in
  `vitest.config.ts` and type-checked through `scripts/tsconfig.test.json`.
- New: a property test of the standard trace encoding's monotonicity (R4). It uses seeded random
  subsets of the existing fixtures, so no new library is needed.

**Target Platform**: macOS and Linux developer machines, and GitHub-hosted `ubuntu-latest` and
`macos-latest` runners.

**Project Type**: The existing pnpm workspace of four library and CLI packages, plus CI workflows.

**Performance Goals**:

- `ha_trace` with independent reads takes about one round trip instead of the sum (SC-003).
- A `standard` request whose result is too large is refused after reading fewer than half of the
  selected runs (SC-004).
- Connection close settles everything within one second (SC-002).

**Constraints**:

- No `@domusops/schema` format or export changes (FR-032).
- No tool output changes from US1 or US5, except the too-large wording "would be more than"
  when the refusal is early (contracts/mcp-behaviour.md).
- Never contact a real instance (FR-033).
- Patch bumps only (R22), so the `~0.1` skill pin holds.
- Each story ships in its own branch from `main` and merges green (FR-030).

**Scale/Scope**:

- About 25 source files touched across four packages, plus three workflows, one Python module,
  one new test suite and one README.
- Six pull requests.

All unknowns are resolved in [research.md](./research.md), and no `NEEDS CLARIFICATION` remains.
The resolved unknowns are the npm trusted-publishing prerequisites and the pnpm path, the current
action majors and their breaking changes, the approach to source maps, the ownership identifier,
the early-stop soundness, the time-control probe, and the integrity scheme.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                              | Pre-research | Post-design                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only                     | All artifacts in English                          | PASS         | PASS. Code, messages, README, workflow comments, changesets                                                                                                                                                                     |
| §2 Spec precedes implementation     | Spec, plan, tasks; analyze before implement       | PASS         | PASS. Tasks and analyze come next                                                                                                                                                                                               |
| §3 MCP holds no procedure           | Workflow lives in skills                          | PASS         | PASS. US1 and US5 change how reads are scheduled and code is organised, not what a tool decides. The early stop applies the existing size rule sooner                                                                           |
| §4 Compression is a contract        | Tools returning instance data are compressed      | PASS         | PASS. Outputs are unchanged, so the compression floors are unchanged (SC-012). Refusing earlier strengthens the size limit rather than relaxing it                                                                              |
| §5 Public schema, private judgement | Schema stable, depends on nothing                 | PASS         | PASS. The schema gains a README and shipped sources only. The escape-shape helper is deliberately not exported (R19)                                                                                                            |
| §6 Trademark hygiene                | No HA branding                                    | PASS         | PASS. The schema README says "for Home Assistant" nominatively; new labels, files and codes say DomusOps                                                                                                                        |
| §7 Destructive operations opt-in    | Mutating operations default to safe               | PASS         | PASS. add-key and remove-key become more conservative (refuse an edited file). No MCP tool mutates                                                                                                                              |
| §8 Version support proven           | CI matrix, generated table                        | PASS         | PASS. A release without time control is reported `failed`, never `passed` (FR-017). The matrix and table generation are unchanged                                                                                               |
| §9 Trunk-based, changesets          | Short branches, changeset per user-visible change | PASS         | PASS:<br>• one branch per story, each under three days;<br>• patch changesets for US1 to US4, none for US5 and US6;<br>• independent versions;<br>• the release ordering in R23 keeps `main` releasable through the OIDC switch |
| §10 Sell convenience, not secrecy   | No value in hidden source                         | PASS         | PASS. Shipping `src/` in the tarballs is consistent with it                                                                                                                                                                     |

No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/007-debt-paydown/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── mcp-behaviour.md
│   ├── sandbox-api.md
│   ├── bootstrap-cli.md
│   └── release.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
.github/workflows/
├── ci.yml                       # US2: action majors
└── release.yml                  # US2: OIDC, npm ≥ 11.5.1, changesets/action v2, SHA pins

packages/mcp/src/
├── ha/client.ts                 # US1: close() settles pending; US5: COMMANDS table, haCode
├── ha/trace.ts                  # US1: getTraces stop flag; US5: exported refOf
├── ha/logbook.ts                # US5: unknown_command by haCode
├── errors.ts                    # US1: "would be more than"; US5: ToolError.haCode
├── tools/ha-trace.ts            # US1: concurrent reads, chunked standard reads with early stop
├── trace/select.ts              # US5: shared refOf, dead branch removed
├── trace/context-id.ts          # US5: one pattern in parseContextId
├── trace/values.ts              # US5: shared comparator and isObject
├── logbook/selectors.ts         # US5: per-entity memo in selectRows
├── logbook/encode-standard.ts   # US5: shared comparator and pad; paired comment on the escape check
├── server.ts                    # US5: one asToolResult helper
└── util/{order,json}.ts         # US5: new shared helpers

packages/sandbox/
├── companion/custom_components/domusops_sandbox/clock.py   # US3: lazy probe, time_unavailable
├── src/errors.ts                # US3: time_unavailable code
├── src/devices/fetch.ts         # US3: commit pin, content digest, extracted cache
├── src/devices/virtual.ts       # US3: state file, resume, revision check
├── src/config/pack.ts           # US3: skip the .domusops_sandbox state directory
├── src/instance/manage.ts       # US3: attach resumes devices
├── src/instance/handle.ts       # US3: message for no device support; time error mapping
├── src/instance/start.ts        # US3: owner-machine label
├── src/runtime/labels.ts        # US3: owner-machine label
├── src/runtime/reaper.ts        # US3: decision table
├── src/runtime/machine-id.ts    # US3: new
├── src/smoke/steps.ts           # US3: time step message
└── test/smoke.test.ts           # US3: non-JWT token in the teardown redaction test

packages/bootstrap/src/
├── baseline/templates.ts        # US4: pinned npx form in comments
├── commands/secrets.ts          # US4: edited-state refusal
└── commands/init.ts             # US4: key resolution and membership next step

packages/*/package.json          # US2: "src" in files
packages/schema/README.md        # US2: new
packages/schema/src/logbook/expand.ts   # US5: comment pairing isEscape with the MCP encoder
scripts/test/package-contents.test.ts, scripts/tsconfig.test.json   # US2: new
vitest.config.ts, package.json (typecheck)                          # US2: include scripts/test
CLAUDE.md                        # US6
.changeset/*.md                  # US1–US4
```

**Structure Decision**: No new packages or directories, except `packages/mcp/src/util/` and
`scripts/test/`. Each story touches one package's sources, or for US2 the release surface, so the
story branches do not conflict.

## Delivery order

Order: US1, then US2, then US3, US4, US5 and US6, one branch each from `main`
(`007-us1-mcp-correctness`, `007-us2-release`, `007-us3-sandbox`, `007-us4-bootstrap`,
`007-us5-mcp-internals`, `007-us6-housekeeping`).

- The spec artifacts merge first, on the `007-debt-paydown` branch.
- US1's "Version Packages" pull request is held until US2 is merged and the trusted publishers
  are set, so the first OIDC release publishes a real change (R23).
- US5 follows US1 because both touch `tools/ha-trace.ts` and `ha/client.ts`.
- After each pull request: `/code-review`, fix its findings, and the maintainer merges.

## Complexity Tracking

None.
