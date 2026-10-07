# Implementation Plan: ha-bootstrap — From Zero to a GitOps Baseline

**Branch**: `004-ha-bootstrap` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-ha-bootstrap/spec.md`

## Summary

Ship the first DomusOps skill. `skills/ha-bootstrap/SKILL.md` holds the judgement: it previews,
explains, asks, and applies. A new package, `@domusops/bootstrap`, holds every deterministic step
behind one CLI, `domusops-bootstrap`, with commands `init` (preview by default, `--apply` to
write), `check`, `validate`, and `secrets decrypt|encrypt|add-key|remove-key`. `init` brings an
existing configuration directory to a baseline of twelve elements: repository, a marked
`.gitignore` block, `packages/` and its loading line, SOPS/age encryption of `secrets.yaml` into
`secrets.sops.yaml` (values only, round-trip proven), placeholder overrides, the instance version,
a git pre-commit hook, `core.hooksPath`, a GitHub workflow, and a generation record. The record
stores the hash and release of every skill-owned element, so a re-run creates what is missing,
upgrades what the user never edited, and leaves edited files alone. Pre-commit checks are light and
never print a secret. Full validation runs the instance's own `check_config` in its official
container at the recorded version, with typed placeholder secrets derived from the encrypted
file's readable keys, in CI and optionally locally.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ES2023 target, NodeNext modules. Same as the other packages.

**Primary Dependencies**: `yaml` 2.x (new; zero transitive dependencies; custom tags and line
positions, research R3). Node 22 built-ins (`node:child_process`, `node:crypto`, `node:fs`). No
dependency on `@domusops/schema` or `@domusops/mcp`. External programs, found on `PATH`: `git`,
`sops` 3.13.x, `age-keygen` 1.2.x, and `docker` or `podman` for `validate` only.

**Storage**: Files in the user's configuration directory; the age key at SOPS's default location
outside it (research R6).

**Testing**: Vitest 2.1 against temporary directories, with real `git`, `sops`, and `age`
binaries (installed pinned in CI). A fixture builder creates the reference configuration at test
time (research R15). One CI job runs `validate` with a pinned instance image.

**Target Platform**: macOS and Linux, and Windows inside WSL; native Windows stops (FR-030). CI
matrix `ubuntu-latest`, `macos-latest`.

**Project Type**: CLI package (`@domusops/bootstrap`) plus a skill (`skills/ha-bootstrap/`) in the
existing pnpm workspace.

**Performance Goals**: `init --apply` on the reference fixture under 10 s, excluding key creation
prompts and first `npx` download; `check --staged` on 200 staged YAML files under 3 s; SC-006 (10
minutes to a reviewed first commit) is dominated by the user's review.

**Constraints**: Never commit, push, add remotes, untrack, or rewrite history. Never print or
version a private key or secret value. No network except what installing prerequisites and the
`npx` fetch require (FR-025). Deterministic templates (research R12). Byte-identical existing
files except the packages line (SC-008).

**Scale/Scope**: One configuration directory per run; typical 50–500 YAML files. Twelve baseline
elements, five check rules, seven CLI commands. One new package, one skill, one CI job.

All unknowns (script location, hook runner, YAML parsing, exclusions, packages insertion, SOPS
usage and key lookup, placeholders, check rules and thresholds, validation in a container, CI
shape, version recording, upgrade detection, preview, operating systems, tests, skill-to-CLI
version drift) are resolved in [research.md](./research.md). No `NEEDS CLARIFICATION` remains.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Article                             | Gate                                            | Pre-research | Post-design                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 English-only                     | All artifacts in English                        | PASS         | PASS. Generated files are English (FR-024; contracts/generated-files.md)                                                                                                      |
| §2 Spec precedes implementation     | Spec, plan, tasks; analyze before implement     | PASS         | PASS. Plan done; tasks and analyze are next                                                                                                                                   |
| §3 MCP holds no procedure           | Workflow lives in skills                        | PASS         | PASS. This is the workflow side: judgement in `SKILL.md`, steps in a CLI; `@domusops/mcp` is untouched                                                                        |
| §4 Compression is a contract        | Tools returning instance data are compressed    | N/A          | N/A. Nothing is read from a live instance (FR-025)                                                                                                                            |
| §5 Public schema, private judgement | Schema never depends on other packages          | PASS         | PASS. `@domusops/bootstrap` depends on nothing internal; the schema is untouched. Its own formats (record, summary) are versioned strings inside the package                  |
| §6 Trademark hygiene                | No HA branding                                  | PASS         | PASS. Package, binary, workflow, and block names say DomusOps; the instance is named only nominatively. The container image is referenced by its official name, not rebranded |
| §7 Destructive operations opt-in    | Mutations of a live instance default to dry run | N/A          | PASS in spirit. No instance is touched; `init` previews by default and writes only with `--apply`, and the skill always shows the preview first (research R13)                |
| §8 Version support proven           | No hand-written support claims                  | PASS         | PASS. No version matrix is claimed; the user's CI validates at the user's recorded version; our CI proves the reference fixture at one pinned version                         |
| §9 Trunk-based                      | Short-lived branch, changesets                  | PASS         | PASS with a risk: branch cut 2026-09-26 from `003-ha-trace` (PR #4 open). Scope is larger than one feature-day; see Decisions 6. New package starts at `0.1.0` via changeset  |
| §10 Convenience, not secrecy        | No telemetry, no obfuscation                    | PASS         | PASS. Apache-2.0, plain TypeScript, no telemetry                                                                                                                              |

**Result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-ha-bootstrap/
├── spec.md
├── plan.md                     # this file
├── research.md                 # Phase 0
├── data-model.md               # Phase 1: elements, states, record, summary, check result
├── quickstart.md               # Phase 1: validation scenarios
├── contracts/
│   ├── cli.md                  # commands, flags, exit codes, environment
│   └── generated-files.md      # every file written into the user's repository
├── checklists/
│   └── requirements.md
└── tasks.md                    # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
skills/ha-bootstrap/
├── SKILL.md                         # judgement: preview → explain → ask → apply → next steps
└── reference/
    └── troubleshooting.md           # stop reasons, conflicts, key backup and recovery

packages/bootstrap/
├── package.json                     # @domusops/bootstrap, bin domusops-bootstrap, dep yaml
├── tsconfig.json / tsconfig.test.json
├── README.md
├── src/
│   ├── cli.ts                       # argument parsing, exit codes, text/JSON output
│   ├── env/
│   │   ├── platform.ts              # native Windows stop (FR-030)
│   │   ├── prereqs.ts               # PATH lookup, install lines per OS (FR-004)
│   │   ├── exec.ts                  # child process wrapper; never logs secret-bearing args or output
│   │   ├── git.ts                   # init, ls-files, log, diff --cached, show, config
│   │   ├── sops.ts                  # encrypt, decrypt, updatekeys; ENC type parsing
│   │   ├── age.ts                   # identity lookup order, keygen, public key parsing
│   │   └── container.ts             # docker/podman detection and run
│   ├── yaml/
│   │   └── ha-yaml.ts               # parser with instance tags, positions, !secret refs, homeassistant section
│   ├── baseline/
│   │   ├── elements.ts              # element list, owners, state computation (data-model §1)
│   │   ├── record.ts                # generation record read/validate/write (§2)
│   │   ├── templates.ts             # deterministic templates (contracts/generated-files.md)
│   │   ├── gitignore.ts             # block find/insert/replace; tracked-path findings
│   │   ├── packages.ts              # text-level insertion (research R5)
│   │   ├── secrets.ts               # exposure check, encrypt with round-trip proof, keys
│   │   └── findings.ts              # inline secrets, custom integrations, nested secrets files
│   ├── commands/
│   │   ├── init.ts
│   │   ├── check.ts                 # rules R8
│   │   ├── validate.ts              # temp copy, placeholders, container run, result mapping
│   │   └── secrets.ts               # decrypt, encrypt, add-key, remove-key
│   └── report/
│       └── summary.ts               # run summary, human and JSON
└── test/
    ├── fixtures/build-reference.mjs # reference and variant configuration directories
    ├── support/tmp.ts               # temp dirs, throwaway age keys, PATH shaping
    ├── ha-yaml.test.ts
    ├── gitignore.test.ts
    ├── packages.test.ts             # every row of research R5; byte-identity
    ├── record.test.ts               # states, upgrade, damaged record
    ├── secrets.test.ts              # round trip, exposure, keys, modes
    ├── check.test.ts                # every rule; no secret in output
    ├── init.test.ts                 # preview writes nothing; apply; re-run no-op; stops
    ├── validate.test.ts             # placeholders; container command shape (runtime mocked)
    ├── validate.container.test.ts   # real container; run by the bootstrap-validate CI job only
    └── skill.test.ts                # SKILL.md version range matches package major.minor (R16)

.github/workflows/ci.yml             # + sops/age install, macOS matrix, bootstrap-validate job
.changeset/*.md                      # @domusops/bootstrap initial release (minor → 0.1.0)
tsconfig.json                        # + reference to packages/bootstrap
package.json                         # typecheck script + packages/bootstrap/tsconfig.test.json
eslint.config.*                      # unchanged (glob already covers packages/*)
```

**Structure Decision**: One new package beside `schema`, `mcp`, and `sandbox`, because the steps
need the repository's test and release tooling and an exact release number (research R1). The
skill folder already exists with a placeholder `SKILL.md`, which is replaced. Only `env/` runs
external programs; only `baseline/` and `commands/` write files.

Housekeeping, also in scope:

- `CLAUDE.md` "Current focus": `ha-bootstrap`.
- Root README: a short `ha-bootstrap` section.
- The `sandbox-matrix` placeholder job in `ci.yml` stays as is.

## Decisions to confirm at review

1. **A CLI package, not loose scripts** (research R1). Adds `@domusops/bootstrap` to npm; the
   skill and the user's hook and CI fetch it with `npx`. The user's machine needs Node 22.
2. **Git's own hooks, not the `pre-commit` framework** (R2). No Python; the local
   `core.hooksPath` setting must be restored after a fresh clone, which a re-run does.
3. **Values-only encryption** (R6). Secret key names (such as `wifi_password`) are readable in the
   repository; values are not. This is what lets CI validate without a key.
4. **Custom integrations validate as warnings** (R9). Their configuration is not schema-checked in
   CI; the summary says so. Versioning `custom_components/` remains the user's choice.
5. **`secret-value` threshold of 8 characters** (R8). Shorter values (PINs, short words) are not
   searched for, to avoid blocking commits on common strings.
6. **Branch length (§9).** `004-ha-bootstrap` was cut on 2026-09-26 from `003-ha-trace`. With
   twelve elements, five rules, and seven commands, implementation may not fit the three-day
   window. Tasks should be ordered so User Stories 1 and 2 (P1) form a mergeable increment on
   their own.
7. **Local prerequisites for development.** `sops` and `age` are not installed on the
   maintainer's machine yet (`brew install sops age`); Docker is.

## Complexity Tracking

No constitution violations to justify.
