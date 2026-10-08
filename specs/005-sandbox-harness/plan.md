# Implementation Plan: sandbox harness — A Throwaway Home Assistant for Safe Testing

**Branch**: `005-sandbox-harness` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-sandbox-harness/spec.md`

## Summary

Turn the `@domusops/sandbox` stub into a library-first package with a thin CLI,
`domusops-sandbox`. It resolves a release channel from the package index, starts one container
per instance from the official image with the instance process as the container's main process,
streams a filtered copy of a configuration directory into it (no host files, no runtime files, no
real secrets), completes onboarding through the instance's own HTTP API, and hands back a
loopback address and a per-instance long-lived token. A small companion integration installed
only into sandbox instances provides time control and self-teardown: at a deadline, or 15 seconds
after the owning process's connection drops, the instance stops and the container removes itself.
Virtual devices come from `twrecked/hass-virtual`, pinned and configured by file. A fixed
eight-step smoke check exercises everything, including the existing `ha_snapshot` tool, on every
release in the CI matrix; a gate job blocks merges on stable failures only; the README table is
rendered from a committed results document regenerated from a named CI run.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, same `tsconfig.base.json` as the other packages),
Node 22+. The companion integration is Python, running inside the instance's own interpreter; no
Python toolchain on the host.

**Primary Dependencies**: `tar` 7.x (new, streaming filtered archives, research R5);
`@domusops/mcp` (workspace) and `@modelcontextprotocol/sdk` for the smoke check's MCP step
(R12). Node built-ins: `fetch`, `WebSocket`, `node:child_process`, `node:crypto`. External
programs: `docker` or `podman` only (FR-021). Reused integration: `twrecked/hass-virtual`
`v0.9.3`, downloaded and SHA-256-verified (R7). The `@domusops/schema` dependency of the stub is
removed (R16).

**Storage**: None persistent beyond the device-integration cache (`$XDG_CACHE_HOME/domusops/sandbox`)
and `docs/supported-versions.json` in the repository. Instance state lives only in its container.

**Testing**: Vitest. Unit tests in the default `pnpm test`; container tests
(`*.container.test.ts`) excluded by default and run by the `sandbox-matrix` legs with
`DOMUSOPS_CONTAINER_TESTS=1`, like `bootstrap-validate` (R15).

**Target Platform**: macOS and Linux with Docker or Podman; CI on `ubuntu-latest`. Native Windows
is not supported by this feature (WSL works as Linux).

**Project Type**: Library plus CLI package in the existing pnpm workspace, plus CI workflow
changes and one repository script.

**Performance Goals**: Ready instance under 3 minutes with the image present (SC-001; readiness
limit 150 s). Time-triggered automation observed in under 10 s (SC-004). Tied teardown after
`SIGKILL` within 25 s. A matrix leg under 10 minutes including the image pull.

**Constraints**: Never contact an address the sandbox did not create (FR-019): no URL input
anywhere, loopback-only ports, MCP step environment built from scratch. Never write to the source
directory (FR-006). Never read real secrets unless named (FR-008). Token never logged (FR-005).
Never touch unlabelled containers (FR-018).

**Scale/Scope**: A handful of concurrent instances per machine; configuration directories of up to
a few thousand files. One package (≈ 20 source files), one companion (≈ 4 Python files), one
fixture configuration, two CI jobs changed or added, one script.

All unknowns (how the instance runs, runtime access, release resolution, onboarding, loading,
teardown and time control, virtual devices, secrets, validation, interfaces, clients, smoke
check, CI and the table, results format, tests, package shape) are resolved in
[research.md](./research.md). No `NEEDS CLARIFICATION` remains.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                                    | Pre-research | Post-design                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only                     | All artifacts in English                                | PASS         | PASS. Code, Python companion, messages, results, README block (FR-027)                                                                                                          |
| §2 Spec precedes implementation     | Spec, plan, tasks; analyze before implement             | PASS         | PASS. Plan done; tasks and analyze next                                                                                                                                         |
| §3 MCP holds no procedure           | Workflow lives in skills                                | PASS         | PASS. `@domusops/mcp` is unchanged; the sandbox only spawns it as a client would                                                                                                |
| §4 Compression is a contract        | Tools returning instance data are compressed            | N/A          | N/A. No MCP tool is added; run results carry step names and counts only, never instance data                                                                                    |
| §5 Public schema, private judgement | Schema never depends on other packages                  | PASS         | PASS. Schema untouched; the sandbox drops its unused schema dependency. Result and table formats are versioned strings inside the sandbox package                               |
| §6 Trademark hygiene                | No HA branding                                          | PASS         | PASS. Package, binary, companion domain (`domusops_sandbox`), labels, and container names say DomusOps; the description uses "for Home Assistant"-style nominative wording only |
| §7 Destructive operations opt-in    | Mutations of a live instance default to dry run         | N/A          | PASS in spirit. The sandbox mutates only instances it created; it cannot address any other (FR-019). No MCP mutating tool is added                                              |
| §8 Version support proven           | CI runs stable, previous stable, beta; generated README | PASS         | PASS. This feature is what implements §8: matrix, gate, generated table, hand-edit check (R13)                                                                                  |
| §9 Trunk-based                      | Short-lived branch, changesets                          | PASS         | PASS with a risk: branch cut 2026-10-06. Scope exceeds one day; tasks must make US1+US2 a mergeable increment. Changeset takes the package to `0.1.0`                           |
| §10 Convenience, not secrecy        | No telemetry, no obfuscation                            | PASS         | PASS. Apache-2.0, plain source; the companion is readable Python; nothing phones home (the release index and image registry are fetched, nothing is sent)                       |

**Result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-sandbox-harness/
├── spec.md
├── plan.md                    # this file
├── research.md                # Phase 0: R1–R16
├── data-model.md              # Phase 1: channel, instance, lifecycle, labels, reaper, results, errors
├── quickstart.md              # Phase 1: ten validation scenarios
├── contracts/
│   ├── library-api.md         # the primary interface
│   ├── cli.md                 # commands, options, exit codes
│   ├── companion.md           # the in-instance integration's commands and behaviour
│   └── run-result.md          # result JSON and the README block
├── checklists/
│   └── requirements.md
└── tasks.md                   # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/sandbox/
├── package.json                    # bin domusops-sandbox; deps tar, @domusops/mcp, MCP SDK; files dist, companion, fixtures, schema
├── tsconfig.json / tsconfig.test.json
├── README.md
├── src/
│   ├── index.ts                    # public exports (contracts/library-api.md)
│   ├── cli.ts                      # argument parsing, output, exit codes (contracts/cli.md)
│   ├── errors.ts                   # SandboxError and codes (data-model §7)
│   ├── release/
│   │   ├── versions.ts             # parse and order YYYY.M.P[bN]
│   │   └── resolve.ts              # package index → channels (R3)
│   ├── runtime/
│   │   ├── docker.ts               # the only module that spawns the container runtime (R2)
│   │   ├── labels.ts               # label names, build, parse
│   │   └── reaper.ts               # reaper decisions (data-model §2) and cleanup
│   ├── instance/
│   │   ├── start.ts                # lifecycle orchestration, failure → teardown
│   │   ├── onboard.ts              # onboarding and long-lived token (R4)
│   │   ├── ready.ts                # readiness and check_config (R9)
│   │   ├── handle.ts               # Sandbox handle, ownership checks, exit handlers
│   │   └── list.ts                 # list, attach, stop
│   ├── config/
│   │   ├── pack.ts                 # filtered tar stream (R5)
│   │   └── secrets.ts              # !secret scan, typed placeholders (R8)
│   ├── devices/
│   │   ├── fetch.ts                # download, verify, cache hass-virtual (R7)
│   │   └── virtual.ts              # device file, config flow, reload, services
│   ├── ha/
│   │   ├── rest.ts                 # fetch wrapper bound to a handle
│   │   └── ws.ts                   # minimal WebSocket client and companion commands (R11)
│   ├── smoke/
│   │   ├── steps.ts                # the eight steps (R12)
│   │   └── run.ts                  # runSmoke, result assembly
│   └── results/
│       ├── result.ts               # RunResult type and writer (R14)
│       └── table.ts                # renderSupportedVersions, README block replace
├── companion/custom_components/domusops_sandbox/
│   ├── manifest.json
│   ├── __init__.py                 # setup, info/attach/detach, owner watch, deadline
│   └── clock.py                    # freeze/advance/resume/now
├── fixtures/reference-config/      # configuration.yaml + packages/smoke.yaml (03:00 automation)
├── schema/run-result.schema.json
├── scripts/supported-versions.mjs  # `pnpm sandbox:table --run <id>` (R13)
└── test/
    ├── versions.test.ts / resolve.test.ts      # recorded package-index fixture
    ├── pack.test.ts                            # exclusions, links, byte-identity
    ├── secrets.test.ts                         # placeholders, types, caller file
    ├── labels.test.ts / reaper.test.ts         # fake runtime
    ├── cli.test.ts                             # parsing, output, exit codes, token only in `env`
    ├── result.test.ts                          # schema
    ├── readme-table.test.ts                    # README block == rendering (FR-024)
    ├── smoke.test.ts                           # MCP step environment built from scratch (FR-019)
    ├── virtual.test.ts                         # device validation, device file rendering
    ├── support/                                # fake runtime, channel helper
    ├── onboard.container.test.ts               # R1 and R4 verification on each channel
    ├── virtual.container.test.ts               # R7 verification
    ├── time.container.test.ts
    ├── teardown.container.test.ts              # normal, SIGKILL, deadline, concurrent, foreign id
    ├── config.container.test.ts                # invalid config, placeholders
    └── mcp.container.test.ts                   # existing MCP tool and WebSocket (US5)

docs/supported-versions.json        # generated (R13)
README.md                           # "Supported Home Assistant versions": markers + generated block
.github/workflows/ci.yml            # sandbox-matrix replaced, sandbox-gate added, weekly schedule
package.json                        # sandbox:table script; typecheck + packages/sandbox/tsconfig.test.json
tsconfig.json                       # unchanged (already references packages/sandbox)
vitest.config.ts                    # unchanged (container-test exclusion already generic)
.changeset/sandbox-*.md             # one per PR; the first takes @domusops/sandbox to 0.1.0
CLAUDE.md                           # "Current focus" updated
```

**Structure Decision**: Everything lives in the existing `packages/sandbox` stub. Only
`runtime/docker.ts` spawns the container runtime; only `ha/` talks to an instance, and only
through a handle. The companion and fixtures ship in the package because the library installs
them into every instance.

## Verification before building

Three facts from research are confirmed against the real image on all three channels by the first
container tests, before the code that depends on them is written: the onboarding step bodies (R4),
the `hass-virtual` config-flow field names (R7), and that the container exits when the instance
stops under `--entrypoint python` with `--init` (R1). If any fails, research is updated before
continuing.

## Decisions to confirm at review

1. **SC-006 wording.** The README table reflects the CI run it was regenerated from, linked per
   row (`pnpm sandbox:table --run <id>`), not automatically the latest run. Automatic updates
   would need a bot pull request with a personal or app token, because pull requests opened with
   the workflow token never trigger checks (R13). Confirmed 2026-10-06: SC-006 now reads "every
   row links to the recorded CI run result that produced it".
2. **Required check.** `sandbox-gate` must be added to the branch protection's required checks by
   the maintainer (repository settings); until then FR-025 is reported but not enforced.
3. **Matrix on every pull request.** Three instance starts per pull request (about 5–10 minutes,
   in parallel with `verify`). Path filters were rejected because a required check that never runs
   blocks merging.
4. **A companion integration in Python** (R6). It is the only way to get deterministic time
   control and self-teardown without a host daemon. Time control relies on instance internals; the
   matrix catches breakage per release. Recorder timestamps keep real time.
5. **`hass-virtual` pinned at v0.9.3** (R7), last released 2025-08-13. Whether it loads on the
   2026 releases is exactly what the first container test answers.
6. **Branch length (§9).** Order tasks so US1 + US2 (start, onboard, teardown, crash safety) are a
   mergeable increment; US3–US6 follow.

## Complexity Tracking

No constitution violations to justify.
