---
description: "Task list for the ha-bootstrap feature"
---

# Tasks: ha-bootstrap — From Zero to a GitOps Baseline

**Input**: Design documents from `specs/004-ha-bootstrap/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Requested. The spec's acceptance scenarios and measurable outcomes (SC-001 to SC-008)
are proven by tests against real `git`, `sops`, and `age` binaries (plan, Testing). Within each
story, write the tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested as
an increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US4, from spec.md)

## Path Conventions

New pnpm workspace package `packages/bootstrap/` (the CLI) and a new skill `skills/ha-bootstrap/`
(replacing its placeholder `SKILL.md`). Sources live in `packages/bootstrap/src/`, tests in
`packages/bootstrap/test/`. All paths are relative to the repository root. Section references
(`data-model §1`, `research R6`) point into this feature's [data-model.md](./data-model.md) and
[research.md](./research.md). Code of features 001 to 003 is on this branch, which was cut from
`003-ha-trace` (PR #4, unmerged).

---

## Phase 1: Setup

**Purpose**: Commit the specification and scaffold the new package

- [x] T001 Commit `specs/004-ha-bootstrap/` and the "Current focus" update already made to
      `CLAUDE.md` together on the existing branch `004-ha-bootstrap`, as
      `docs: add ha-bootstrap spec, plan, and tasks`, after the maintainer confirms. `main` is
      protected (constitution §9). The branch is cut from `003-ha-trace` (PR #4, unmerged); its
      pull request targets that branch until #4 merges, then is rebased onto `main` (plan,
      Decisions to confirm at review, item 6).
- [x] T002 [P] Scaffold `packages/bootstrap/`: `package.json` (`@domusops/bootstrap`, private
      false, `"type": "module"`, `"bin": { "domusops-bootstrap": "./dist/cli.js" }`,
      `"files": ["dist"]`, `"scripts": { "build": "tsc -b", "test": "vitest run --root ../.. packages/bootstrap/" }`, so the package runs under the root `vitest.config.ts` and its exclusions,, one dependency `"yaml": "^2.6.0"`,
      following `packages/sandbox/package.json` as the closest existing example); `tsconfig.json`
      (extends `../../tsconfig.base.json`, `outDir: dist`, `rootDir: src`, no reference to
      `../schema`, following `packages/mcp/tsconfig.json`'s shape minus the schema reference);
      `tsconfig.test.json` (`noEmit`, `composite: false`, includes `src` and `test`, following
      `packages/mcp/tsconfig.test.json`); an empty `src/` and `test/` directory. Add
      `{ "path": "packages/bootstrap" }` to the root `tsconfig.json` references. Add
      `tsc -p packages/bootstrap/tsconfig.test.json` to the root `package.json` `typecheck` script.
      No change to `eslint.config.js` or `pnpm-workspace.yaml`: both already match `packages/*`.
- [x] T003 [P] Update `vitest.config.ts`: add `**/*.container.test.ts` to `test.exclude` unless
      the environment variable `DOMUSOPS_CONTAINER_TESTS` is set
      (`packages/bootstrap/test/validate.container.test.ts`, added in T037, needs a real container
      runtime and is not part of the default `pnpm test` run). Add a `test:bootstrap:container`
      script to `packages/bootstrap/package.json`:
      `DOMUSOPS_CONTAINER_TESTS=1 vitest run --root ../.. packages/bootstrap/test/validate.container.test.ts`
      (used by the `bootstrap-validate` CI job added in T048). Verify that
      `pnpm --filter @domusops/bootstrap test` does not collect the container test, and that the
      root `pnpm test` still collects every other package's tests.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The environment helpers, the YAML parser, the baseline engine, the CLI skeleton, and
the test fixtures every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Create `packages/bootstrap/src/env/platform.ts`: `isNativeWindows()` returns
      `process.platform === "win32"` (WSL reports `linux`, research R14); `nativeWindowsStop()`
      returns the `native_windows` stop object of data-model §1.2 with the WSL guidance text.
- [x] T005 [P] Create `packages/bootstrap/src/env/exec.ts`: `run(cmd, args, opts)` wraps
      `node:child_process` `execFile`/`spawnSync`, returns `{ code, stdout, stderr }` or throws on
      `ENOENT`; accepts `input` for stdin and `env` overrides; never logs `args` or output when
      `opts.sensitive` is true (used by every command that touches a secret value or key).
- [x] T006 Create `packages/bootstrap/src/env/prereqs.ts` (depends on T005): `checkPrerequisites(names)`
      probes each of `git`, `sops`, `age-keygen`, and (only when asked) `docker`/`podman` by
      running `<name> --version`; returns the missing ones with install lines for macOS (`brew`)
      and Debian/Ubuntu (`apt`, or the tool's release page when it has no package), per
      spec edge case "the encryption tool or the key tool is not installed" and FR-004.
      `missingPrerequisiteStop(missing)` builds the `missing_prerequisite` stop object of
      data-model §1.2.
- [x] T007 [P] Create `packages/bootstrap/src/env/git.ts` (depends on T005): `isRepo(dir)`, `init(dir)`,
      `lsFilesTracked(dir, patterns)` (which of the given glob patterns are tracked, for FR-007),
      `lsFilesAll(dir)` and `lsFilesUntrackedNotIgnored(dir)` (for `validate`'s temp copy, R9),
      `diffCachedNames(dir)` and `showStagedBlob(dir, path)` (for `check --staged`, R8),
      `logAllTouching(dir, path)` (for the exposure check, FR-014), `getLocalConfig`/
      `setLocalConfig(dir, key, value)` (for `core.hooksPath`).
- [x] T008 Create `packages/bootstrap/src/yaml/ha-yaml.ts`: parse with the `yaml` package,
      registering `!include`, `!include_dir_list`, `!include_dir_named`,
      `!include_dir_merge_list`, `!include_dir_merge_named`, `!secret`, `!env_var`, and `!input`
      as opaque tags (research R3); `parse(text)` returns the document plus an error list of
      `{ line, column, message }` (1-based) on a syntax error or a duplicate key; `findTopKey(doc,
key)` and `findChildKey(mapping, key)` return the node and its position, used by
      `packages.ts` (T020) and `findings.ts` (T021) to locate `homeassistant:`, `packages:`, and
      `!secret` references without re-serialising the document.
- [x] T009 [P] Create `packages/bootstrap/src/baseline/templates.ts`: `sha256(content)` (hex
      digest); one deterministic render function per skill-owned element listed in
      [generated-files.md](./contracts/generated-files.md) (`renderGitignoreBlock()`,
      `renderPackagesReadme()`, `renderSopsConfig(recipients)`, `renderHook(release)`,
      `renderWorkflow(release)`), each producing byte-identical output for the same input, no
      timestamp or machine path (research R12). Cover it in
      `packages/bootstrap/test/templates.test.ts`: rendering twice gives identical bytes; no
      output contains a Spanish diacritic or inverted punctuation mark (FR-024, constitution §1:
      the character class of "Signal 1" in `.claude/hooks/guard-language.sh`, written in the test
      as Unicode escapes so the test file itself passes the hook); and "Home Assistant" appears only in the nominative form "for Home Assistant"
      (FR-024, constitution §6).
- [x] T010 Create `packages/bootstrap/src/baseline/record.ts` (depends on T009): `readRecord(dir)`
      (parses `.domusops/generated.json`; a missing file, invalid JSON, or a `format` other than
      `"domusops.bootstrap/0.1"` returns `null`, data-model §2); `writeRecord(dir, record)`
      (pretty-printed, sorted keys, trailing newline, so a re-run writes identical bytes, FR-021);
      `elementState(recordEntry, recordedRelease, currentContent, actualContent)` returns
      `"missing" | "current" | "outdated" | "edited"` per data-model §1.1 (no record ⇒ `edited`
      when `actualContent` differs from `currentContent`, else `current`; matches the recorded
      hash but not the current template ⇒ `outdated`; matches neither ⇒ `edited`).
- [x] T011 Create `packages/bootstrap/src/baseline/elements.ts` (depends on T007, T009, T010):
      `BASELINE_ELEMENTS`, the ordered list of the 12 elements of data-model §1 (id, owner,
      requirement ids); a registry `registerElement(id, computeFn)` where `computeFn(ctx)` returns
      `{ state, path, action, reason }` for one element, plus `applyOrder`, the fixed order of
      [cli.md](./contracts/cli.md) "Order of application"; `runElements(ctx, mode)` runs every
      registered computer, in `applyOrder` for apply and any order for preview, and collects a
      run-scope stop if any computer returns one. Concrete computers are registered by later
      tasks (T021, T028, T036); this task only builds the orchestrator and a stub computer that
      always reports `missing`; the orchestrator is first exercised end to end by T023, and its
      state logic by T039.
- [x] T012 [P] Create `packages/bootstrap/src/report/summary.ts`: `buildSummary(mode, release,
target, stop, elements, findings, key, nextSteps)` and `printSummary(summary, json)` per
      data-model §3 (human form: `<verb padded> <path>  <reason>` per element, then findings, then
      numbered next steps; JSON form verbatim); `buildCheckResult(hits)` and
      `printCheckResult(result, json)` per data-model §4. No function here ever receives a secret
      value or private key; callers pass only paths, key names, and the public key.
- [x] T013 Create `packages/bootstrap/src/cli.ts` (depends on T004, T006): argument parsing for
      `--dir`, `--json`, `--version`, `--help`; the exit codes of [cli.md](./contracts/cli.md)
      (0, 1, 2, 64); a `runScopeGuard(dir, needs)` helper that checks, in order, `native_windows`
      (T004) then the prerequisites the command needs (T006), returning early with exit 2 and no
      side effect on any failure (FR-004, FR-030); a command dispatch table with placeholders for
      `init`, `check`, `validate`, and `secrets`, wired to their real implementations in T022,
      T034, T035, and T029.
- [x] T014 [P] Create `packages/bootstrap/test/support/tmp.ts`: `makeTempDir()` and its cleanup;
      `makeThrowawayAgeKey()` runs `age-keygen` into a temp file and returns its path and public
      key, for tests that must never touch the developer's real key; `withoutOnPath(names, fn)`
      runs `fn` with a `PATH` that hides the named binaries, for prerequisite-missing tests.
- [x] T015 [P] Create `packages/bootstrap/test/fixtures/build-reference.mjs`: builds the reference
      configuration directory of quickstart.md "Prerequisites" (`configuration.yaml` with one
      inline `api_key`, `automations.yaml`, `secrets.yaml` with fake values, `home-assistant_v2.db`
      plus `-shm`/`-wal`, `home-assistant.log`, `.storage/` with one `lovelace` file,
      `.HA_VERSION`, `custom_components/example/manifest.json` with a `version` key,
      `www/community/`) and named variant builders for the spec's edge cases: already a
      repository, an existing `.gitignore` with user entries, an existing `packages:` declaration,
      no `secrets.yaml`, a `secrets.yaml` in a subdirectory, `secrets.yaml` already tracked or in
      history, a `homeassistant:` block mapping with other keys, custom components already
      tracked, and one with a configuration error for the validator (scenario 8).
- [x] T016 Create `packages/bootstrap/test/ha-yaml.test.ts` (depends on T008): parses every custom
      tag without error; reports a syntax error and a duplicate key with line and column; the five
      branches of research R5's `homeassistant`/`packages` table, each returning the right located
      node or "leave as is" result.

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Put my configuration under version control safely (Priority: P1)

**Goal**: An existing configuration directory becomes a repository whose first commit excludes
runtime files, with `packages/` ready to use, and a summary of what changed (spec User Story 1).

**Independent Test**: Run `init --apply` on the reference fixture, `git add -A`, and inspect what
would be committed (quickstart scenario 1).

### Tests for User Story 1

- [x] T017 [P] [US1] Create `packages/bootstrap/test/gitignore.test.ts`: the block is appended and
      marked (research R4); an existing `.gitignore` keeps its own entries (US1 acceptance
      scenario 4); each excluded path already tracked is reported with its `git rm --cached`
      command and none is untracked automatically (FR-007); `custom_components/` and
      `www/community/` are left out of the block when the user already tracks files under them
      (spec edge case).
- [x] T018 [P] [US1] Create `packages/bootstrap/test/packages.test.ts`: the five branches of
      research R5 (no `homeassistant` key, block mapping without `packages`, any existing
      `packages` key, an `!include`d or flow-mapping `homeassistant`, and the base case); every
      other byte of `configuration.yaml` is unchanged in each case (SC-008).

### Implementation for User Story 1

- [x] T019 [P] [US1] Create `packages/bootstrap/src/baseline/gitignore.ts` (depends on T007, T009):
      `computeGitignoreBlock(dir)` and `applyGitignoreBlock(dir)` implementing research R4's entry
      list and the marked-block insertion; `findTrackedExcludedPaths(dir)` using
      `lsFilesTracked` (T007) against the block's patterns, for `findings.tracked_excluded`
      (data-model §3).
- [x] T020 [US1] Create `packages/bootstrap/src/baseline/packages.ts` (depends on T008, T009):
      `computePackagesLoading(dir)` and `applyPackagesLoading(dir)` implementing the research R5
      table by text-level insertion only (never re-serialising the document); `computePackagesReadme(dir)`
      and `applyPackagesReadme(dir)` using `renderPackagesReadme()` (T009).
- [x] T021 [US1] Create `packages/bootstrap/src/baseline/findings.ts` (depends on T008): `findCustomIntegrations(dir)`
      (directory names under `custom_components/`); `hasUiDashboards(dir)` (true when
      `.storage/lovelace` or any `.storage/lovelace.*` file exists, for the run summary note that UI-mode dashboards are not
      versioned, spec edge case); `findNestedSecretsFiles(dir)` lists every `secrets.yaml` below
      the configuration root (excluding `.storage/`, `custom_components/`, and `deps/`), for
      `findings.nested_secrets_files`, reported and never encrypted (research R6);
      `findRemote(dir)` returns `"none"`, `"github"` (any remote URL whose host is `github.com`),
      or `"other"`, for `findings.remote` (data-model §3). Register the `repository`, `gitignore-block`,
      `packages-loading`, and `packages-readme` computers in `elements.ts` (T011), using T019 to
      T021 and `env/git.ts` `init`/`isRepo` (T007) for `repository`.
- [x] T022 [US1] Create `packages/bootstrap/src/commands/init.ts` (depends on T011, T012, T013):
      `init(dir, { apply, instanceVersion, json })` runs `runScopeGuard` (T013) with `not_config_dir`
      added (no `configuration.yaml`), then `runElements` (T011) over every element registered so
      far, writes `.domusops/generated.json` for the skill-owned elements it applied (T010), and
      prints the run summary (T012). Wire `init` into the `cli.ts` dispatch table (T013).
- [x] T023 [US1] Create `packages/bootstrap/test/init.test.ts` (depends on T014, T015, T022):
      quickstart scenario 1 for the elements built so far — preview writes nothing; `--apply`
      creates the repository, the `.gitignore` block, `packages/README.md`, and the packages
      loading line; the summary's `findings.custom_integrations` and `findings.tracked_excluded`
      are populated; `not_config_dir` on a directory without `configuration.yaml` changes nothing.
      On the nested-secrets variant (T015), `findings.nested_secrets_files` names the file and the
      file is left untouched. With no remote, `findings.remote` is `"none"` and the next steps say
      the workflow only runs on GitHub. SC-008: the SHA-256 of every file the fixture wrote is
      recorded before `--apply`; afterwards every one is identical except `configuration.yaml`,
      whose diff is exactly the packages lines of research R5. This file is extended by later stories (T030, T038, T042); do not run it in parallel with
      those tasks.

**Checkpoint**: User Story 1 is independently functional — a configuration directory becomes a
safe, packages-ready repository

---

## Phase 4: User Story 2 - Secrets are encrypted, never plaintext in the repository (Priority: P1)

**Goal**: `secrets.yaml` is encrypted with the user's own age key into `secrets.sops.yaml`, and
further keys (such as the instance host's) can be added without ever moving a private key (spec
User Story 2).

**Independent Test**: Run `init --apply` on a fixture with a plaintext `secrets.yaml`, confirm
`secrets.sops.yaml` decrypts to the same values, and that no secret value appears in any file
version control would include (quickstart scenario 2; SC-001).

### Tests for User Story 2

- [x] T024 [P] [US2] Create `packages/bootstrap/test/secrets.test.ts`: the round trip (encrypt
      then decrypt reproduces the original keys and values, FR-012); key creation when none
      exists versus reuse of an existing one (US2 acceptance scenarios 2 and 3); the exposure
      check stops `sops-config` and `encrypted-secrets` with `secrets_exposed` and rewrites no
      history when `secrets.yaml` is tracked or in history (quickstart scenario 6, FR-014);
      `add-key` lets a second key decrypt without the first key's private material ever being
      read, and `remove-key` refuses to remove the last recipient (quickstart scenario 9, US2
      acceptance scenario 4, FR-028); `secrets.yaml` and the age key file are written with mode 0600.

### Implementation for User Story 2

- [x] T025 [P] [US2] Create `packages/bootstrap/src/env/sops.ts` (depends on T005): `encrypt(dir,
srcPath, destPath)`, `decrypt(dir, srcPath)` returning content, `updateKeys(dir, sopsPath)`;
      `parseEncType(value)` reads the `type:` field of a SOPS `ENC[AES256_GCM,data:…,type:…]`
      string (research R6, aes/cipher.go), used later by `validate.ts` (T035) to type placeholder
      values (research R7). Every call passes `opts.sensitive: true` to `exec.run` (T005).
- [x] T026 [P] [US2] Create `packages/bootstrap/src/env/age.ts` (depends on T005):
      `resolveIdentity()` follows the lookup order of research R6 (`SOPS_AGE_KEY`,
      `SOPS_AGE_KEY_FILE`, `SOPS_AGE_KEY_CMD`, then the per-OS user config directory); `keygen(path)`
      runs `age-keygen -o` at mode 0600, never overwriting an existing file; `parsePublicKey(text)`
      validates the `age1` prefix and 58-character body (FR-028), used by `secrets add-key`.
- [x] T027 [US2] Create `packages/bootstrap/src/baseline/secrets.ts` (depends on T007, T025, T026):
      `checkExposure(dir)` (`logAllTouching` plus a tracked check via `lsFilesTracked`, T007) for
      FR-014; `encryptWithRoundtrip(dir)` (encrypts, decrypts back to memory, compares parsed
      mappings, deletes the new file and returns the `roundtrip_mismatch` stop on a mismatch,
      FR-012); `findInlineSecrets(dir)` using `ha-yaml.ts` (T008) to flag literal scalar values
      under keys matching `password|passwd|token|api_key|apikey|secret|client_secret|private_key`
      (case-insensitive) that are not `!secret` references (FR-015, data-model §3
      `findings.inline_secrets`), never including the value itself.
- [x] T028 [US2] Register the `sops-config` and `encrypted-secrets` element computers in
      `elements.ts` (T011), using T025 to T027; on `--apply`, resolve or create the key (T026),
      populate the summary's `key` object (data-model §3), run the exposure check before
      encrypting, and extend `commands/init.ts` (T022) to call `findInlineSecrets` (T027) into
      `findings.inline_secrets`.
- [x] T029 [US2] Create `packages/bootstrap/src/commands/secrets.ts` (depends on T025, T026,
      T027): `decrypt` (writes `secrets.yaml` atomically at mode 0600; refuses with `--force`
      required when the file exists and differs, FR-013); `encrypt` (re-runs
      `encryptWithRoundtrip`); `add-key <age-public-key>` and `remove-key <age-public-key>` (edit
      `.sops.yaml`'s recipients, run `sops updatekeys`, update the `sops-config` record entry so
      it is not reported as user-edited, refuse removing the last recipient, FR-028). Wire
      `secrets <sub>` into the `cli.ts` dispatch table (T013).
- [x] T030 [US2] Extend `packages/bootstrap/test/init.test.ts` (T023; sequential, same file):
      `secrets.sops.yaml` and `.sops.yaml` appear in the summary as `created`; `key.found`/
      `key.created`/`key.public` are correct in both the no-key and existing-key cases;
      `findings.inline_secrets` names the file, line, and key of the fixture's inline `api_key`
      without its value. SC-001: after `--apply`, `git add -A`; no staged file contains any of the
      fixture's fake secret values or `AGE-SECRET-KEY-1`, and no staged path is excluded by the
      block.

**Checkpoint**: User Stories 1 and 2 (both P1) together are the mergeable increment: a first
commit is both clean of runtime files and clean of secrets (plan, Decisions to confirm at review,
item 6)

---

## Phase 5: User Story 3 - Mistakes are caught before they land (Priority: P2)

**Goal**: Light pre-commit checks block malformed YAML, plaintext secrets, and keys; continuous
integration additionally runs the instance's own full validator, with no real secret or key
available to it; the same full validation is available locally when Docker is present (spec User
Story 3).

**Independent Test**: Commit malformed YAML and a plaintext secret separately (both blocked); push
an invalid configuration (CI fails with the validator's own message); run `validate` locally
(quickstart scenarios 5, 7, 8; SC-004, SC-005, SC-007).

### Tests for User Story 3

- [x] T031 [P] [US3] Create `packages/bootstrap/test/check.test.ts`: each of the five rules of
      research R8 (`yaml-syntax`, `plaintext-secrets`, `unencrypted-sops`, `secret-value` at the
      8-character threshold, `private-key`) blocks its staged case and a clean change does not
      (quickstart scenario 5, SC-005); no hit message contains the secret value or key material,
      only the file, line where there is one, and the rule id (data-model §4). On a fixture with 200
      staged YAML files, `check --staged` completes in under 3 s (plan, Performance Goals).
- [x] T032 [P] [US3] Create `packages/bootstrap/test/validate.test.ts`, with the container runtime
      mocked via `DOMUSOPS_CONTAINER`: placeholder values are typed from each SOPS `ENC` type per
      research R7's table; a `.domusops/placeholders.yaml` override replaces a default; a
      malformed `.domusops/placeholders.yaml` is reported as a `validate` error naming the file
      (data-model §5); no container runtime found exits 2 with the guidance message and writes
      nothing (FR-027).

### Implementation for User Story 3

- [x] T033 [P] [US3] Create `packages/bootstrap/src/env/container.ts` (depends on T005): detect
      `docker` then `podman` on `PATH`, or honour `DOMUSOPS_CONTAINER`; `run(image, mounts, args, opts)`
      running `<runtime> run --rm -v <mount>:/config --entrypoint python <image> -m homeassistant
--script check_config --config /config --json` (research R9); missing runtime returns the
      `missing_prerequisite`-shaped stop for `validate` alone (FR-027), not a run-scope stop.
- [x] T034 [US3] Create `packages/bootstrap/src/commands/check.ts` (depends on T007, T008, T025):
      `check({ staged, all, ci })` reads either `diffCachedNames`/`showStagedBlob` or
      `lsFilesAll`/file contents (T007), applies the five rules of research R8 (`yaml-syntax` via
      T008; `unencrypted-sops` via `parseEncType`, T025, failing when a value is not `ENC[...]`),
      skips `secret-value` when `--ci` (no plaintext `secrets.yaml` exists there), and prints via
      `buildCheckResult`/`printCheckResult` (T012). Wire `check` into `cli.ts` (T013).
- [x] T035 [US3] Create `packages/bootstrap/src/commands/validate.ts` (depends on T010, T025,
      T033): copies `lsFilesAll` plus `lsFilesUntrackedNotIgnored` (T007) into a temporary
      directory; builds the placeholder `secrets.yaml` from `secrets.sops.yaml`'s keys, typed by
      `parseEncType` (T025) per research R7's table, overridden by `.domusops/placeholders.yaml`
      when present (data-model §5); runs the container (T033) at the version in
      `.domusops/instance-version`; maps its `--json` output (`total_errors`, `errors`,
      `total_warnings`, `warnings`) to exit 0 or 1, grouped by component, noting that a missing
      custom integration is a warning and its section is not schema-checked (research R9); `--ci`
      also prints `::error file=…`/`::warning file=…` annotation lines.
- [x] T036 [US3] Register the `hook`, `hooks-path`, `workflow`, `instance-version`, and
      `placeholders` element computers in `elements.ts` (T011): the hook and workflow render from
      `templates.ts` (T009) at the current package release; `hooks-path` sets `core.hooksPath` to
      `.githooks` unless it is already set elsewhere or `.git/hooks/pre-commit` exists, in which
      case it is `blocked` with `hooks_conflict` and the existing setting is left untouched;
      `instance-version` is written from `.HA_VERSION` when missing, or is `blocked` with
      `version_unknown` (element-scope only) when neither it nor `--instance-version` is
      available; `placeholders` is created empty with its explanatory comment when missing.
      Extend `commands/init.ts` (T022) to accept `--instance-version` (T013's argument parser)
      and pass it through.
- [x] T037 [US3] Create `packages/bootstrap/test/validate.container.test.ts` (depends on T035; run
      only by the `bootstrap-validate` CI job added in T048, per T003's exclusion): quickstart
      scenarios 7 and 8 — `validate` exits 0 on the reference fixture, reporting the
      `example` custom integration as a warning (SC-004); exits 1 with the validator's own error
      text on the fixture with an injected configuration error (SC-007). The instance image is
      pinned in the test as the constant `PINNED_INSTANCE_VERSION = "2026.9.3"` and written to the
      fixture's `.domusops/instance-version`; bumping it is a deliberate one-line change.
- [x] T038 [US3] Extend `packages/bootstrap/test/init.test.ts` (T030; sequential, same file): the
      hook file, `core.hooksPath`, the workflow, `.domusops/instance-version`, and
      `.domusops/placeholders.yaml` appear in the summary as `created`; an existing, unrelated
      `core.hooksPath` blocks only `hooks-path` with `hooks_conflict` and is left unchanged;
      absence of both `.HA_VERSION` and `--instance-version` blocks only `instance-version` with
      `version_unknown` while every other element still applies. The generated
      `.github/workflows/domusops.yml` parses as YAML; it has exactly the jobs `checks` and
      `validate`; `validate.needs` is `checks`; both call `@domusops/bootstrap@<release>` with the
      record's release; the file contains no `secrets.` expression (FR-018, FR-019, FR-020).

**Checkpoint**: FR-016 to FR-020, FR-026, and FR-027 are all covered — a bootstrapped repository
catches broken YAML, secrets, and (in CI, or locally with Docker) an invalid configuration

---

## Phase 6: User Story 4 - Safe to run again (Priority: P2)

**Goal**: A second run changes nothing when nothing changed; a user's edit to a generated file
survives a re-run; a removed baseline element is restored; an unedited file from an older release
is upgraded (spec User Story 4).

**Independent Test**: Run `init --apply` twice (no change on the second run); edit a generated
file and re-run (edit survives, reported as differing); simulate an older release and re-run
(unedited files upgrade) (quickstart scenarios 3 and 4; SC-002, SC-003).

### Tests for User Story 4

- [ ] T039 [P] [US4] Create `packages/bootstrap/test/record.test.ts`: `elementState` (T010)
      distinguishes an unedited file from an edited one; a bumped `release` with an unchanged
      template reports the recorded entries as `outdated` and, on apply, rewrites them and updates
      the record (FR-022); a missing or unparsable `.domusops/generated.json` treats every
      differing skill-owned element as `edited` (FR-029); re-running `secrets add-key`/`remove-key`
      updates the `sops-config` record entry so it is not later reported as edited (data-model §2).

### Implementation for User Story 4

- [ ] T040 [US4] Complete `packages/bootstrap/src/baseline/record.ts` and `elements.ts` (T010,
      T011) with the two behaviours not yet exercised by the happy-path stories above: `outdated`
      → rewrite for any skill-owned element (not only the ones touched in T028/T036), and
      `missing` → recreate for any element the user removed after a previous run (FR-022,
      restore-on-re-run for User Story 4 acceptance scenario 3).
- [ ] T041 [US4] Finish `packages/bootstrap/src/commands/init.ts` (T022, T028, T036): run every
      one of the 12 registered elements together in the `applyOrder` of
      [cli.md](./contracts/cli.md); confirm a run with nothing to do performs zero writes
      (SC-002).
- [ ] T042 [US4] Extend `packages/bootstrap/test/init.test.ts` (T038; sequential, same file) with
      the full quickstart scenarios 3, 4, and 10 across all 12 elements: a second run on an
      unchanged directory changes nothing; an edited generated file is reported as `differs` and
      untouched while a simulated older release upgrades every unedited one; each of the three
      run-scope stops (`native_windows`, `missing_prerequisite`, `not_config_dir`) writes nothing.
      `init --apply` on the reference fixture completes in under 10 s, excluding key creation
      (plan, Performance Goals). After `--apply`, `git rev-list --all` is empty and `git remote`
      prints nothing (FR-005); during the whole run, `exec.run` (T005) is spied on and invokes no
      program other than `git`, `sops`, and `age-keygen` (FR-025).

**Checkpoint**: Every acceptance scenario and SC-001 to SC-008 has a passing test; `init` is
feature-complete

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The skill itself, documentation, packaging, and CI for the new package

- [ ] T043 [P] Replace the placeholder `skills/ha-bootstrap/SKILL.md` with the real skill:
      run `npx --yes @domusops/bootstrap@~<major.minor> init` (no `--apply`) for the preview,
      explain the findings and any stop to the user in plain language, ask before re-running with
      `--apply`, report the summary's next steps afterwards, and point to
      `reference/troubleshooting.md` for any `blocked` element or stop reason (research R16).
- [ ] T044 [P] Create `skills/ha-bootstrap/reference/troubleshooting.md`: one section per stop
      reason of data-model §1.2 (`native_windows`, `missing_prerequisite`, `not_config_dir`,
      `version_unknown`, `secrets_exposed`, `packages_elsewhere`, `hooks_conflict`,
      `roundtrip_mismatch`), each with what it means and the recovery step, including the key
      backup reminder of FR-011.
- [ ] T045 [P] Create `packages/bootstrap/test/skill.test.ts`: the `npx --yes
@domusops/bootstrap@~X.Y` range in `SKILL.md` matches `packages/bootstrap/package.json`'s
      major and minor version (research R16), so a minor bump fails this test until the skill is
      updated.
- [ ] T046 [P] Create `packages/bootstrap/README.md`: every command and flag of
      [cli.md](./contracts/cli.md), the exit codes, the environment variables, and a link to
      `skills/ha-bootstrap/SKILL.md`.
- [ ] T047 [P] Add `.changeset/ha-bootstrap-package.md`: `"@domusops/bootstrap": minor` (0.0.0 →
      0.1.0, the package's first release), describing the CLI and its commands, following the
      style of the existing changesets in `.changeset/`.
- [ ] T048 [P] Update `.github/workflows/ci.yml`: install `sops` 3.13.x and `age` 1.2.x (pinned)
      before `pnpm test` in the existing `verify` job, since `packages/bootstrap/test/` needs
      them; add a `bootstrap-macos` job (`macos-latest`, `brew install sops age`, then
      `pnpm --filter @domusops/bootstrap test`, research R14); add a `bootstrap-validate` job
      (`ubuntu-latest`, which has Docker preinstalled, same `sops`/`age` install, then
      `pnpm --filter @domusops/bootstrap run test:bootstrap:container`, T003).
- [ ] T049 [P] Add a short "ha-bootstrap" section to the root `README.md`: what the skill does, the
      command it runs, and a link to `packages/bootstrap/README.md` (SEED §7: the article itself
      is drafted outside this repository).
- [ ] T050 Run `pnpm lint && pnpm typecheck && pnpm test` (the default, non-container set) and fix
      anything left. Confirm every test of features 001 to 003 is unchanged in behaviour.
- [ ] T051 Install `sops` and `age` locally (`brew install sops age`) and run
      `pnpm --filter @domusops/bootstrap run test:bootstrap:container` once against the pinned
      instance image, to catch a container-specific failure before CI does.
- [ ] T052 Live check (SC-006): with the maintainer's consent, run
      `node packages/bootstrap/dist/cli.js init` (preview only, no `--apply`; the local build,
      because `@domusops/bootstrap` is not on npm until the release after merge) against a
      disposable copy of `mi-ha-config`. Record in the pull request
      description only: the element states found, the findings counts (tracked-excluded paths,
      inline secrets, custom integrations), and the wall-clock time of the preview. Never paste
      configuration or secret content, per the confidentiality rule used for the `ha_trace` live
      test.
- [ ] T053 Open the pull request from `004-ha-bootstrap`, after the maintainer confirms, with base
      `003-ha-trace` until PR #4 merges (then rebase onto `main`; if #4 is squashed,
      `git rebase --onto main <old base> 004-ha-bootstrap`), title
      `feat: add the ha-bootstrap skill`, with a summary of the design decisions of plan.md
      "Decisions to confirm at review" and the results of T052. Wait for CI (`verify`, the sandbox
      matrix, `bootstrap-macos`, and `bootstrap-validate`) to pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)** and **US2 (Phase 4)**: after Foundational. Independent of each other (different
  files), both P1.
- **US3 (Phase 5)**: after US1 (needs the baseline that makes a first commit meaningful, spec
  User Story 3 "Why this priority").
- **US2 acceptance scenario 5** (a commit containing a secret value is blocked) needs the
  pre-commit hook of US3: it is proven by T031, not within Phase 4. US2 alone guarantees
  encryption and exclusion; the commit-time guard arrives with US3.
- **US4 (Phase 6)**: after US1, US2, and US3 (proves idempotence across all 12 elements).
- **Polish (Phase 7)**: after every story it documents or packages.

### Within Foundational

- T004, T005 have no dependencies. T006, T007 need T005. T008 is independent. T009 is independent.
- T010 needs T009. T011 needs T007, T009, T010. T012 is independent. T013 needs T004, T006.
- T014, T015 are independent of the source changes. T016 needs T008.

### Within a Story

- Tests are written first and must fail. Then the pure/env modules, then the element computers,
  then the command that wires them into `init.ts` or its own file, then the extension to
  `init.test.ts`.
- `init.test.ts` (T023, T030, T038, T042) is one file extended across four stories: those four
  tasks are sequential, never run in parallel with each other.

### Parallel Opportunities

- Foundational: T004, T005, T007, T008, T009, T012, T014, T015 together; T006 after T005; T010
  after T009; T011 after T007/T009/T010; T013 after T004/T006; T016 after T008.
- US1 tests: T017, T018 together. US1 modules: T019, T020 together.
- US2: T024 alone; T025, T026 together.
- US3: T031, T032 together; T033 alone (needed by T035).
- Polish: T043 to T049 together.

```bash
# Foundational, independent modules together:
Task: "platform detection in packages/bootstrap/src/env/platform.ts"
Task: "process wrapper in packages/bootstrap/src/env/exec.ts"
Task: "git helpers in packages/bootstrap/src/env/git.ts"
Task: "YAML parser in packages/bootstrap/src/yaml/ha-yaml.ts"
Task: "deterministic templates in packages/bootstrap/src/baseline/templates.ts"
Task: "run summary in packages/bootstrap/src/report/summary.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Phase 1 and Phase 2 (package scaffold, environment helpers, YAML parser, baseline engine,
   fixtures).
2. Phase 3: US1. A configuration directory becomes a clean, packages-ready repository.
3. Phase 4: US2. Secrets are encrypted and proven to round-trip. **Only now** is the baseline safe
   to recommend: without it, User Story 1 alone would tell a user to commit a directory that still
   contains a plaintext `secrets.yaml`.
4. **Stop and validate**: `pnpm lint && pnpm typecheck && pnpm test`.

US1 and US2 are both P1 and, together, release-blocking, the same pattern as `ha_trace`'s US1 and
US2 (plan, Decisions to confirm at review, item 6).

### Incremental Delivery

1. Setup + Foundational.
2. US1 + US2, the MVP; merge once green.
3. US3, pre-commit checks and full validation. Before it, nothing catches a broken configuration
   before the instance loads it.
4. US4, idempotence across the whole baseline, including upgrades across a DomusOps release.
5. Polish: the skill itself, README, changesets, CI wiring, live check.

Constitution §9 limits feature branches to three days. With 12 baseline elements, 5 check rules,
and 7 CLI commands, this feature is larger than `ha_trace`; if the scope does not fit, merge US1
and US2 first (the skill can already recommend a safe first commit) and deliver US3 and US4 on a
short follow-up branch. Never publish the skill before US2: FR-014's exposure check and FR-012's
round-trip proof are what keep a first bootstrap from encrypting nothing useful or silently
corrupting a secret.

---

## Notes

- Constitution §2: run `/speckit-analyze` on spec, plan, and tasks **before** `/speckit-implement`.
- Commit after each task or logical group, after the maintainer confirms. Every commit and
  artifact is in English (§1; the `guard-language` hook enforces it).
- Never hand-edit `pnpm-lock.yaml`; T002 adds one new dependency (`yaml`) via `pnpm add`, not by
  editing the lockfile directly.
- Decisions carried from the plan (see plan.md, "Decisions to confirm at review"). Changing one
  changes the named tasks:
  - a CLI package, not loose scripts (T002, and every task under `packages/bootstrap/`);
  - git's own hooks, not the `pre-commit` framework (T036, T043's `SKILL.md` prerequisite list);
  - values-only SOPS encryption (T025, T027, T035);
  - custom integrations validate as warnings, not errors (T035, T037);
  - the `secret-value` threshold of 8 characters (T031, T034);
  - the branch base and the pull request target (T001, T053).
- `sops` and `age` are not installed on the maintainer's machine yet; T051 is also where that gap
  is closed, before relying on CI to find a problem first.
