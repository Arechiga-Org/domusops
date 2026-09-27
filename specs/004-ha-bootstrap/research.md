# Research: ha-bootstrap

Phase 0 output for [plan.md](./plan.md). Every open question from the Technical Context is
resolved here. Facts about the instance's validator were verified against the
`home-assistant/core` source at tag `2026.9.3` (`homeassistant/scripts/check_config.py`,
`homeassistant/helpers/check_config.py`, `homeassistant/loader.py`), and facts about SOPS against
`getsops/sops` at tag `v3.13.3` (`age/keysource.go`, `aes/cipher.go`), on 2026-09-27. Items marked
**verify** are confirmed by a quickstart scenario during implementation, not assumed.

## R1. Where the deterministic steps live

**Decision**: A new workspace package, `@domusops/bootstrap`, with one CLI, `domusops-bootstrap`.
The skill's instructions (`skills/ha-bootstrap/SKILL.md`) call it through
`npx --yes @domusops/bootstrap@<range>`. Every file write, check, and encryption step is a CLI
command; the instructions hold only judgement (what to ask, how to explain the preview, what to do
when the CLI stops).

**Rationale**: Spec FR-001 asks for scripts the instructions call. A package gives them the
repository's own toolchain (TypeScript strict, Vitest, lint, typecheck, changesets), an exact
release number for the generation record (FR-029), and one code path shared by the skill, the
pre-commit hook, local validation, and CI. Node 22 is already the project's runtime (SEED §4).

**Alternatives considered**:

- _Shell scripts in `skills/ha-bootstrap/scripts/`_: YAML-aware checks (FR-016, FR-017) and the
  generation record need a real parser; portable shell across macOS and Linux (FR-030) is fragile;
  untestable with the project's tooling.
- _Python scripts_: fits the instance's ecosystem, but would add a second language and toolchain
  to the repository against SEED §4.
- _Scripts vendored into the user's repository_: works offline, but puts bundled code the user
  must not edit into their repository and makes upgrades a file-diff problem.

## R2. Pre-commit runner

**Decision**: Plain git hooks. The skill writes `.githooks/pre-commit`, a short POSIX shell shim
that runs `npx --prefer-offline --yes @domusops/bootstrap@<exact release> check --staged`, and sets
the repository's local `core.hooksPath` to `.githooks`. If `core.hooksPath` is already set to
something else, or `.git/hooks/pre-commit` exists, the skill does not replace it: it stops the
hook step, reports the conflict, and prints the line the user can add to their own hook.

**Rationale**: No prerequisite beyond git and Node. The hook file is versioned, so it travels
with the repository; only the one-line local setting must be repeated after a fresh clone, and a
re-run of the skill does it (FR-021: the hook is present, the setting is restored and reported).
`--prefer-offline` uses the cached release once fetched, so commits work without network.

**Alternatives considered**: The `pre-commit` framework (the de facto standard, used by the
instance's own project) needs Python and `pip`, a prerequisite many users of a coding agent lack;
its YAML hooks (`check-yaml`) reject the instance's custom tags unless run in unsafe mode. Husky
needs a `package.json` in the user's configuration directory.

## R3. YAML well-formedness with the instance's tags

**Decision**: Parse with the `yaml` package (eemeli/yaml 2.x), registering the instance's tags as
opaque scalar or sequence tags: `!include`, `!include_dir_list`, `!include_dir_named`,
`!include_dir_merge_list`, `!include_dir_merge_named`, `!secret`, `!env_var`, `!input`. A parse
error is reported with file, line, and column (FR-017). Duplicate keys are errors, as in the
instance's loader. The same parser finds `!secret` references (R7) and the `homeassistant:`
section (R5).

**Rationale**: One new runtime dependency, zero transitive dependencies, precise positions,
round-trip-safe document model, and custom tag support. yamllint enforces style rules that the
instance does not; a style failure blocking a commit would be noise.

## R4. Exclusion list

**Decision**: A marked block appended to `.gitignore` (created if missing):

```text
# >>> DomusOps baseline (managed by ha-bootstrap; edit outside this block) >>>
...entries...
# <<< DomusOps baseline <<<
```

Entries: `secrets.yaml` (at any depth); `*.db`, `*.db-shm`, `*.db-wal`; `*.log`, `*.log.*`;
`.storage/`; `.cloud/`; `.ssh/`; `.cache/`; `__pycache__/`; `deps/`; `tts/`; `.HA_VERSION`;
`.ha_run.lock`; `.uuid`; `ip_bans.yaml`; `.google.token`; `custom_components/` and
`www/community/`, each omitted when the user already tracks files under it (spec edge case). An
entry already matched by a user line outside the block is still written inside it (the block is
self-contained); duplicates are harmless to git.

`ip_bans.yaml` and `.google.token` are additions to the spec's list: the first holds client IP
addresses written at runtime, the second an OAuth token. `known_devices.yaml` is configuration and
stays versioned.

**Rationale**: The block is the unit the generation record tracks (FR-029): the skill owns it, the
user owns everything outside it. FR-007's tracked-path check runs `git ls-files -ci --exclude-from`
on the block's patterns and prints `git rm --cached <path>` for each hit.

**Note for the run summary**: dashboards in UI mode live in `.storage/` and are therefore not
versioned. The summary says so once, pointing to YAML-mode dashboards; converting them is out of
scope.

## R5. Enabling packages

**Decision**: Text-level insertion, never a YAML re-serialisation, so every other byte of
`configuration.yaml` is unchanged (SC-008). The parser (R3) locates the top-level `homeassistant`
key:

| Found                                           | Action                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No `homeassistant` key                          | Append `homeassistant:\n  packages: !include_dir_named packages\n`                                                |
| Block mapping without `packages`                | Insert `packages: !include_dir_named packages` as its first child, at the indentation of the existing first child |
| Any `packages` key                              | Leave as is; report the declared form (FR-008)                                                                    |
| `homeassistant: !include ...` or a flow mapping | Leave as is; stop the packages step and report that the user must add it where the section lives                  |

`packages/README.md` explains the directory (FR-009); `!include_dir_named` loads only `*.yaml`
files, so the README is never loaded. **verify**: an empty `packages/` passes validation.

**Alternatives considered**: `!include_dir_merge_named` (one file may define several packages;
less discoverable for a new user; the user can still switch, and the skill will then leave it).

## R6. Encryption with SOPS and age

**Decision**:

- **Files.** `.sops.yaml` at the repository root with one creation rule,
  `path_regex: (^|/)secrets\.sops\.yaml$`, listing age recipients. The encrypted file is
  `secrets.sops.yaml` beside `secrets.yaml`. Only `secrets.yaml` at the configuration root is
  encrypted; a `secrets.yaml` in a subdirectory is reported, not encrypted (the instance supports
  them, but they are rare and would multiply the rules).
- **Values only.** SOPS's default for YAML: keys stay readable, values are encrypted. Readable
  keys are what lets CI build placeholders without a key (R7), and what makes a diff show which
  secret changed. The key names are not secret; the summary says they are visible.
- **Key location.** SOPS looks for age identities in `SOPS_AGE_KEY`, `SOPS_AGE_KEY_FILE`,
  `SOPS_AGE_KEY_CMD`, then `<user config dir>/sops/age/keys.txt`, where the user config dir is
  `$XDG_CONFIG_HOME` or `~/.config` on Linux and `$XDG_CONFIG_HOME` or
  `~/Library/Application Support` on macOS (`age/keysource.go`, `getUserConfigDir`). The skill
  resolves the same order. If an identity is found, its public key is the recipient (first
  identity if the file holds several; the summary names which). If none, it runs `age-keygen -o`
  on the default path with mode 0600 (FR-011), never overwriting a file.
- **Encrypt, decrypt, re-encrypt.** `secrets encrypt` runs `sops --encrypt` from `secrets.yaml` to
  `secrets.sops.yaml`; `secrets decrypt` writes `secrets.yaml` atomically with mode 0600 (FR-013).
  An empty or missing `secrets.yaml` yields an encrypted empty mapping (**verify**).
- **Keys.** `secrets add-key <age public key>` and `secrets remove-key <key>` edit the recipient
  list in `.sops.yaml` and run `sops updatekeys --yes secrets.sops.yaml`, which needs only the
  user's own identity (FR-028). Removing the last recipient is refused. Both update the
  generation record, so `.sops.yaml` is not reported as user-edited afterwards.
- **Round-trip proof** (FR-012): after encrypting, the skill decrypts to memory and compares the
  parsed mappings; a mismatch deletes the new encrypted file and stops.
- **Exposure check** (FR-014): `git ls-files --error-unmatch secrets.yaml` and
  `git log --all --format=%H -- secrets.yaml` (every path named `secrets.yaml`). Any hit stops the
  secrets step before encrypting, with the rotation message.

## R7. Placeholder secrets for validation

**Decision**: CI and the local `validate` command build a throwaway `secrets.yaml` from the key
names of `secrets.sops.yaml`, typed by the `type:` field SOPS keeps in each encrypted value
(`ENC[AES256_GCM,data:…,iv:…,tag:…,type:str|int|float|bool]`, `aes/cipher.go`):

| SOPS type | Default placeholder                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `str`     | `domusops-placeholder`; if the key contains `url`: `http://placeholder.invalid`; `email`: `placeholder@example.com` |
| `int`     | `1`; if the key contains `port`: `8080`                                                                             |
| `float`   | `0.0`                                                                                                               |
| `bool`    | `false`                                                                                                             |

The user can override any key in `.domusops/placeholders.yaml` (versioned, user-owned, created
with an explanatory comment and no entries). Values there are, by construction, not secrets; the
pre-commit value check (R8) still guards the file. A referenced secret missing from both files is
a real error, and the validator reports it as one.

**Rationale**: FR-019 without any key or real value in the code hosting service. The validator
checks some secrets against schemas (URLs, ports, coordinates); typed defaults pass most, and the
override file handles the rest without weakening the guarantee.

## R8. Pre-commit checks

**Decision**: `check --staged` reads staged blobs (`git diff --cached --name-only -z`, then
`git show :<path>`), not the working tree, and applies:

| Rule id             | Blocks when                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `yaml-syntax`       | A staged `*.yaml`/`*.yml` file does not parse (R3)                                                                                     |
| `plaintext-secrets` | A staged path's basename is `secrets.yaml`                                                                                             |
| `unencrypted-sops`  | A staged `*.sops.yaml` lacks `sops` metadata or has a value that is not `ENC[...]`                                                     |
| `secret-value`      | A staged file contains a value of the local `secrets.yaml` (strings of 8+ characters after trimming; numbers and booleans are skipped) |
| `private-key`       | A staged file contains `AGE-SECRET-KEY-1` or a PEM `PRIVATE KEY` header                                                                |

Messages name file, line (where there is one), and rule id, and **never print the secret or key**
(FR-017): the `secret-value` message names the secret's key instead. `check --all` runs the same
rules on every tracked file; CI runs `check --all --ci`, which skips `secret-value` because no
plaintext file exists there (FR-018). Exit code 1 on any hit.

**Alternatives considered**: a minimum length of 6 (too many false hits on short words and PINs);
entropy scoring (opaque to the user, and a value from the user's own file is a certainty, not a
guess).

## R9. Full validation, local and in CI

**Decision**: One command, `validate`, used by both (FR-027, FR-018):

1. Copy the tracked files (`git ls-files`) plus untracked, not-ignored ones into a temporary
   directory; never mount the user's directory.
2. Write the placeholder `secrets.yaml` (R7).
3. Run `docker run --rm -v <tmp>:/config --entrypoint python
ghcr.io/home-assistant/home-assistant:<recorded version> -m homeassistant --script check_config
--config /config --json` (**verify** the entrypoint override). `podman` is accepted when
   `docker` is absent.
4. Exit with the validator's own code: 1 when it reports errors, 0 otherwise. Print its errors and
   warnings, grouped, with its own messages (User Story 3, scenario 2).

**Verified behaviour** (`check_config.py`, `helpers/check_config.py`): `--json` prints
`total_errors`, `total_warnings`, `errors`, and `warnings`; the exit code is 1 only for errors
unless `--fail-on-warnings`, which is not passed. A missing integration (`IntegrationNotFound`),
which is what an excluded custom component looks like, is a **warning**, so a configuration using
custom integrations still passes; its custom sections are not schema-checked, and the summary says
so. A `!secret` without a value is an error.

Without a container runtime, `validate` exits 2 with the message and changes nothing (FR-027).

## R10. CI definition

**Decision**: `.github/workflows/domusops.yml`, on `push` and `pull_request`, with two jobs:
`checks` (`check --all --ci`) and `validate` (`validate --ci`, needs `checks`, `ubuntu-latest`,
which has Docker). Both install Node 22 with `actions/setup-node` and call the CLI at the exact
release recorded in the generation record. Job ids are part of the contract (FR-020): the
sandbox will add a job with `needs: [validate]` to the same file.

**Rationale**: A separate workflow file leaves any existing user workflow untouched. `ubuntu-latest`
provides Docker without setup.

## R11. Instance version

**Decision**: `.domusops/instance-version`, one line, for example `2026.9.3`. Written from
`.HA_VERSION` when missing; if `.HA_VERSION` is absent too, the `instance-version` element is
blocked with `version_unknown` (the rest of the baseline still applies), and the skill asks the
user, then re-runs with `--instance-version`. The
file is user-owned: the user edits it when they upgrade (FR-026). The CLI validates the format
(`YYYY.M.P`, optional `bN` beta suffix).

## R12. Generation record and upgrades

**Decision**: `.domusops/generated.json` ([data-model §2](./data-model.md#2-generation-record)).
For each owned element: its path (or path plus block id), SHA-256 of its content as generated,
and the release. On each run, per element: absent → create; content hash equals record and equals
current template → unchanged; equals record but not current template → outdated, rewrite (FR-022);
differs from record → edited, leave and report. A missing or unparsable record makes every
differing element "edited" (FR-029). Templates are rendered deterministically (no timestamps, no
machine paths), so the hash of an unedited file is reproducible.

## R13. Preview first

**Decision**: `init` without `--apply` changes nothing and prints the plan: the same per-element
table the summary will show, with the actions it would take. The skill always runs the preview,
shows it, and asks before `--apply`.

**Rationale**: Constitution §7 governs the live instance, not files, but the same rule of consent
fits a tool that edits a user's configuration: the user sees every change first. It also gives
the agent the facts (key found or not, custom components, inline secrets) to ask about before
anything happens.

## R14. Operating systems

**Decision**: macOS and Linux runners in the package's CI matrix (`ubuntu-latest`,
`macos-latest`); Docker-based tests on `ubuntu-latest` only. Native Windows is detected with
`process.platform === "win32"`; WSL reports `linux`. Every command on native Windows exits 2 with
the WSL guidance before any change (FR-030). File modes (0600) are applied on both systems.

## R15. Testing approach

**Decision**: Vitest in `packages/bootstrap/test/`. A fixture builder creates the reference
configuration directory in a temporary directory at test time (runtime files such as logs and
databases cannot be committed under the repository's own `.gitignore`). Tests use real `git`,
`sops`, and `age` binaries; the project CI installs pinned `sops` 3.13.3 and `age` 1.2.x. A
`DOMUSOPS_BOOTSTRAP_CLI` variable points the hook shim at the built CLI instead of `npx`, so
hooks are tested before publishing. One CI job runs `validate` against a pinned instance image on
the reference fixture and on an injected-error fixture (SC-004, SC-007). Tests that need a binary
that is absent fail with a message saying which, rather than skipping silently.

## R16. Skill instructions and version drift

**Decision**: `SKILL.md` calls `npx --yes @domusops/bootstrap@~<major.minor>` (patch updates
allowed). A test asserts that the range in `SKILL.md` matches the package's `major.minor`, so a
minor bump fails CI until the skill is updated.
