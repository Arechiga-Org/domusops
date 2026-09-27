# Feature Specification: ha-bootstrap — From Zero to a GitOps Baseline

**Feature Branch**: `004-ha-bootstrap`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: `docs/SEED.md` §6, backlog item 2: "`ha-bootstrap` skill — the free
funnel", with the §2.2 contract "zero to an opinionated baseline: repository layout, `packages/`,
secrets via SOPS/age, correct `.gitignore` for HA, pre-commit hooks, CI." The placeholder in
`skills/ha-bootstrap/SKILL.md` lists the same scope.

## Clarifications

### Session 2026-09-26

- Q: Which starting points are in scope: only unversioned directories, any existing configuration
  directory bootstrapped in place, or that plus reorganising it into packages? → A: Any existing
  configuration directory, already a repository or not, bootstrapped in place without moving
  existing configuration. Reorganising is `ha-migrate` (FR-002, FR-003).
- Q: How do decrypted secrets reach the running instance? → A: The skill documents the commands to
  decrypt and re-encrypt, which work wherever the repository is checked out; getting files onto
  the instance is out of scope (FR-013).
- Q: Does full configuration validation run before every local commit, or only in continuous
  integration? → A: Pre-commit checks stay light (YAML, secrets, keys) and need neither the
  instance's software nor a container runtime. Full validation runs in continuous integration,
  and locally through an optional command when a container runtime is available (FR-016, FR-018,
  FR-027).
- Q: How many keys can decrypt the secrets: only the user's, or others too (such as one on the
  instance's host)? → A: The user's key at bootstrap, plus a documented command to add or remove
  keys and re-encrypt, so no private key is ever copied between machines (FR-011, FR-028).
- Q: When a newer DomusOps release improves the baseline, what happens on a re-run to generated
  files the user never edited? → A: They are updated. The skill keeps a versioned record of what
  it generated, so it can tell an unedited file from an older release apart from a file the user
  edited; edited files are never touched and are reported (FR-021, FR-022, FR-029).
- Q: Which operating systems must the skill and its scripts support? → A: macOS and Linux. On
  Windows, only inside WSL; on native Windows the skill stops with no change made and explains how
  to use WSL (FR-030).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Put my configuration under version control safely (Priority: P1)

A Home Assistant user who has never versioned their configuration asks their coding agent to
"set this up properly". The agent runs the `ha-bootstrap` skill against the user's configuration
directory. When it finishes, the directory is a version-controlled repository with an
opinionated baseline: files the instance writes at runtime (databases, logs, internal storage,
caches) are excluded from version control, the configuration is ready for `packages/`-style
splitting, and nothing secret can be committed. The user reviews what was added and makes their
first commit knowing that it contains configuration only.

**Why this priority**: This is the funnel. Every later DomusOps capability (diffing, the sandbox,
migration) assumes the configuration already lives in a repository. A user who cannot get there
safely never reaches the rest of the toolkit.

**Independent Test**: Run the skill against a sample configuration directory containing a
typical mix of configuration files, runtime files, and a plaintext secrets file; then list what
version control would include in the first commit. Delivers value on its own: a clean,
committable repository.

**Acceptance Scenarios**:

1. **Given** a configuration directory that is not yet a repository, **When** the skill runs,
   **Then** the directory becomes a repository and the first commit would include configuration
   files only: no database, log, internal storage, cache, or plaintext secrets file.
2. **Given** a configuration directory whose main configuration file does not yet load packages,
   **When** the skill runs, **Then** a `packages/` directory exists, the main configuration loads
   every file in it, and the instance's configuration validation still passes.
3. **Given** the skill has run, **When** the user inspects the result, **Then** a short summary
   lists every file the skill created or changed and why, and nothing else was touched.
4. **Given** a configuration directory that already has an exclusion list for version control,
   **When** the skill runs, **Then** the user's existing entries are kept and only the missing
   baseline entries are added.

---

### User Story 2 - Secrets are encrypted, never plaintext in the repository (Priority: P1)

The user's configuration references secrets (passwords, tokens, API keys) through the instance's
secrets file. The skill sets up encryption so that the secrets are stored in the repository only
in encrypted form, readable by the user's own key, and the plaintext secrets file never enters
version control. The user can still edit secrets and the instance can still read them.

**Why this priority**: A leaked credential in a public or shared repository is the single most
damaging mistake a new GitOps user can make. SEED §4 makes "plaintext secrets never reach the
repository" a technical constraint.

**Independent Test**: Run the skill against a directory with a plaintext secrets file; confirm
that an encrypted copy exists, that no plaintext secret value appears in any file version control
would include, and that decrypting the encrypted copy with the user's key reproduces the original
values.

**Acceptance Scenarios**:

1. **Given** a plaintext secrets file with values, **When** the skill runs, **Then** an encrypted
   secrets file exists that decrypts, with the user's key, to exactly the same keys and values,
   and the plaintext file is excluded from version control.
2. **Given** the user has no encryption key yet, **When** the skill runs, **Then** it creates one
   stored outside the repository, tells the user where it is, and warns that losing it means
   losing access to the encrypted secrets.
3. **Given** the user already has an encryption key, **When** the skill runs, **Then** it uses
   that key and does not create another.
4. **Given** a second machine (such as the instance's host) with its own key, **When** the user
   adds that machine's public key with the documented command, **Then** that machine can decrypt
   the secrets without the user's private key ever leaving the user's machine (FR-028).
5. **Given** the baseline is in place, **When** the user tries to commit a file that contains a
   plaintext secrets file or a value from it, **Then** the commit is blocked with a message naming
   the file.
6. **Given** the encrypted secrets file in the repository, **When** the user needs the plaintext
   secrets file for the instance, **Then** a single documented command recreates it from the
   encrypted copy, wherever the repository is checked out. How the files reach the running
   instance is the user's choice and out of scope (FR-013).

---

### User Story 3 - Mistakes are caught before they land (Priority: P2)

After the baseline is in place, the user edits YAML by hand or with their agent. Before each
commit, light checks run automatically: the YAML is well formed and no plaintext secret or key is
being committed. When the user pushes, continuous integration repeats those checks and validates
the full configuration with the instance's own validator, so a broken configuration is visible
before the instance ever loads it.

**Why this priority**: Catching errors before they reach the instance is the core promise of
GitOps, but it needs the P1 baseline first and is useful without the sandbox, which does not exist
yet (backlog item 3).

**Independent Test**: On a bootstrapped repository, commit a file with a YAML syntax error and a
file with a plaintext secret; both commits are blocked. Push a change with an invalid
configuration; continuous integration fails and names the problem.

**Acceptance Scenarios**:

1. **Given** a bootstrapped repository, **When** the user commits malformed YAML, **Then** the
   commit is blocked and the message names the file and line.
2. **Given** a bootstrapped repository, **When** the user pushes a configuration the instance
   would reject, **Then** continuous integration fails with the instance's own validation message.
   The pre-commit checks stay light (FR-016) and do not run full validation.
3. **Given** a bootstrapped repository on a machine with a container runtime, **When** the user
   runs the documented optional command, **Then** the same full validation as continuous
   integration runs locally; without a container runtime the command says what is missing
   (FR-027).
4. **Given** a bootstrapped repository hosted on the supported code hosting service, **When** the
   user pushes, **Then** continuous integration runs the local checks that need no plaintext
   secrets file, plus full validation, and fails the run on any error (FR-018).
5. **Given** continuous integration runs, **When** it needs the secrets to validate the
   configuration, **Then** it validates without access to the user's decryption key and without
   any real secret value.

---

### User Story 4 - Safe to run again (Priority: P2)

The user runs the skill a second time: after a DomusOps update, after changing something by hand,
or by accident. The skill recognises what is already in place, adds only what is missing, and
never overwrites the user's own changes.

**Why this priority**: Users will re-run it. A bootstrap that clobbers customised files on a
second run destroys trust in the whole toolkit.

**Independent Test**: Run the skill twice on the same directory; the second run changes nothing.
Customise one generated file, run again; the customisation survives and the skill reports that
the file differs from the baseline.

**Acceptance Scenarios**:

1. **Given** a directory the skill has already bootstrapped and nothing changed since, **When**
   the skill runs again, **Then** no file is changed and the summary says the baseline is already
   in place.
2. **Given** a generated file the user has since edited, **When** the skill runs again, **Then**
   the file is left untouched and the summary reports that it differs from the baseline.
3. **Given** a baseline element was removed by the user, **When** the skill runs again, **Then**
   it is restored and the summary says so.
4. **Given** a directory bootstrapped by an earlier DomusOps release whose baseline has since
   changed, **When** the skill runs again, **Then** every generated file the user never edited is
   updated to the current baseline, every edited one is left untouched, and the summary lists
   both (FR-022, FR-029).

---

### Edge Cases

- **The plaintext secrets file is already in version control history.** The skill does not
  rewrite history. It stops before encrypting, tells the user the secrets are already exposed in
  history and should be rotated, and points to history scanning as a separate concern (the paid
  `ha-secrets-audit`, backlog item 6).
- **The directory is not a configuration directory** (no main configuration file). The skill
  stops and says what it expected to find; it does not create a configuration from nothing.
- **The main configuration already declares packages** in a different form (another directory, a
  different loading style). The skill keeps the user's declaration, creates nothing that conflicts
  with it, and reports what it found.
- **The main configuration already has a `homeassistant:` section** with other keys. Package
  loading is added to that section without changing or reordering the other keys.
- **No secrets file exists.** Encryption is still set up, with an empty encrypted secrets file, so
  the first secret the user adds is protected from the start.
- **The skill is started on native Windows** (outside WSL). It stops with no change made and
  explains how to run it inside WSL (FR-030).
- **The encryption tool or the key tool is not installed.** The skill stops before changing
  anything and says exactly what to install, per operating system.
- **The directory is already a repository with uncommitted changes.** The skill works on top of
  them but lists its own changes separately so the user can review them apart from their own.
- **The repository has no remote, or a remote on a code hosting service other than the supported
  one.** The continuous integration definition is still written; the summary says it only runs on
  the supported service.
- **Custom components or community-managed front-end resources are present.** They are treated as
  installed artefacts, not configuration, and excluded, unless the user already versions them.
- **Secret values appear directly in a configuration file** (not referenced through the secrets
  file). The skill does not move them (that is restructuring, not bootstrapping) but lists each
  file and key where it suspects one, so the user can move it.

## Requirements _(mandatory)_

### Functional Requirements

**Scope and entry point**

- **FR-001**: The skill MUST be a DomusOps skill (instructions plus scripts in `skills/`), not a
  tool of the MCP server (constitution §3). Any deterministic step (writing files, checking the
  environment, encrypting) MUST be a script the instructions call; judgement (asking the user,
  interpreting what was found) lives in the instructions.
- **FR-002**: The skill MUST operate on one existing configuration directory, identified by the
  presence of the instance's main configuration file, whether or not it is already a repository.
  The directory is bootstrapped in place; no existing configuration is moved (FR-003).
- **FR-003**: The skill MUST NOT move, rename, split, or rewrite existing configuration content.
  Its only change to existing configuration files is enabling package loading in the main
  configuration file (FR-008). Restructuring an existing configuration is `ha-migrate` (SEED §2.2,
  paid) and out of scope.
- **FR-004**: Before changing anything, the skill MUST check that every external program it needs
  is installed and that the directory is a configuration directory; if any check fails it MUST
  stop with no change made and name what is missing and how to install it.
- **FR-030**: The skill and every command it documents MUST work on macOS and Linux, and on
  Windows inside WSL. On native Windows the skill MUST stop before any change and explain how to
  run it inside WSL. Both supported systems are part of the skill's own test matrix.

**Repository and exclusions**

- **FR-005**: If the directory is not a repository, the skill MUST initialise one. It MUST NOT
  create commits, push, or configure remotes; committing is the user's decision.
- **FR-006**: The skill MUST ensure an exclusion list that keeps out of version control at least:
  the plaintext secrets file, the instance's databases and their journal files, logs, the
  instance's internal storage directory, cloud and SSH credential directories, caches, run locks,
  the recorded version marker, text-to-speech output, and installed custom components and
  community front-end resources. Existing entries MUST be kept; only missing entries are added,
  grouped under a clearly marked DomusOps section.
- **FR-007**: The skill MUST verify, after writing the exclusion list, that no excluded path is
  already tracked by version control, and MUST report each one it finds with the command to stop
  tracking it. It MUST NOT untrack files itself.

**Packages**

- **FR-008**: The skill MUST create a `packages/` directory and ensure the main configuration
  loads every file in it as a package. If package loading is already declared, it MUST be left as
  is and reported.
- **FR-009**: The `packages/` directory MUST contain a short explanatory file so the directory is
  versioned while empty and a new user knows what goes there. The explanation MUST NOT be a file
  the instance would load as a package.

**Secrets**

- **FR-010**: The skill MUST set up encryption of the secrets file with the user's own key, so the
  repository holds only an encrypted secrets file. The encryption configuration MUST be committed;
  the private key MUST NOT be written anywhere inside the repository.
- **FR-011**: If the user has no key, the skill MUST create one outside the repository, report its
  location, and state that it must be backed up. If a key exists, the skill MUST use it. At
  bootstrap the user's key is the only one that can decrypt the secrets.
- **FR-012**: The encrypted secrets file MUST decrypt to exactly the keys and values of the
  plaintext secrets file at the time the skill ran.
- **FR-013**: The skill MUST provide one documented command to recreate the plaintext secrets
  file from the encrypted file, and one to re-encrypt after the user edits secrets. Both work
  wherever the repository is checked out (on the instance's host or elsewhere). Getting
  configuration or secrets onto the running instance is out of scope.
- **FR-014**: If the plaintext secrets file is tracked in version control or appears in its
  history, the skill MUST stop before encrypting and tell the user the values are exposed and
  should be rotated. It MUST NOT rewrite history.
- **FR-015**: The skill MUST report, without changing them, configuration files that appear to
  contain secret values inline rather than referencing the secrets file.

**Pre-commit checks**

- **FR-016**: The skill MUST install checks that run before every commit and block it when: a
  YAML file is malformed; the plaintext secrets file, or an unencrypted variant of the encrypted
  secrets file, is staged; a staged file contains a value of the plaintext secrets file; or a
  private key is staged. These checks MUST NOT require the instance's software or a container
  runtime; full configuration validation is not part of them (FR-018, FR-027).
- **FR-017**: Check messages MUST name the file (and line, where applicable) and the rule that
  failed.

**Continuous integration**

- **FR-018**: The skill MUST write a continuous integration definition for the supported code
  hosting service that runs, on every push and pull request, the pre-commit checks that need no
  plaintext secrets file (all but the staged-value check of FR-016) plus a full validation of the configuration by the instance's own validator, at the
  instance version the repository records (FR-026).
- **FR-019**: Continuous integration MUST validate without the user's decryption key: every secret
  the configuration references is replaced by a placeholder value for validation only. No real
  secret value and no key is needed in the code hosting service.
- **FR-020**: The continuous integration definition MUST be written so the sandbox (backlog item 3)
  can later add a job to it without the user rewriting it.

**Idempotence and reporting**

- **FR-021**: Running the skill again on a bootstrapped directory MUST change no file when nothing
  is missing and the baseline has not changed since the recorded release.
- **FR-022**: A generated file the user has edited MUST NOT be overwritten; the skill MUST report
  that it differs from the baseline. A missing baseline element MUST be restored and reported. A
  generated file the user has not edited, produced by an older release, MUST be updated to the
  current baseline and reported as updated.
- **FR-029**: The skill MUST keep, in a versioned file in the repository, a record of each file
  (or DomusOps-owned section of a shared file, such as the exclusion list) it generated: its
  content fingerprint and the DomusOps release that produced it. This record is how FR-022 tells
  an unedited file from an edited one. If the record is missing or damaged, every generated file
  that differs from the current baseline is treated as edited.
- **FR-023**: At the end of every run the skill MUST print a summary listing each file created,
  changed, left as is, or found to differ, with a one-line reason, followed by the user's next
  steps (for example: back up the key, review, first commit).

**Hygiene**

- **FR-024**: Every file the skill generates MUST be in English (constitution §1) and MUST NOT use
  the Home Assistant name or logo as DomusOps branding (constitution §6). Nominative references
  ("for Home Assistant") are allowed.
- **FR-025**: The skill MUST NOT contact the running instance or any network service other than
  what installing its listed prerequisites requires. It works on files only.

**Version**

- **FR-026**: The skill MUST record the instance version in a versioned file, read from the
  instance's own version marker at bootstrap time (the marker itself stays excluded, FR-006). The
  user updates the recorded version when they upgrade; continuous integration validates at it.
- **FR-027**: The skill MUST provide one documented, optional command that runs locally the same
  full configuration validation as continuous integration (same version, same placeholder
  secrets). It needs a container runtime; without one, it fails with a message saying so and
  changes nothing. The skill MUST NOT require a container runtime for anything else.

**Keys**

- **FR-028**: The skill MUST provide one documented command to add a public key (for example, one
  generated on the instance's host) as a further key that can decrypt the secrets, and one to
  remove a key; both re-encrypt the encrypted secrets file so the change takes effect at once.
  Removing the last key MUST be refused. Neither command ever needs a private key other than the
  user's own.

### Key Entities _(include if feature involves data)_

- **Configuration directory**: The directory the instance loads its configuration from; contains
  the main configuration file. The unit the skill operates on.
- **Baseline**: The set of elements the skill guarantees: exclusion list entries, `packages/`
  directory and its loading, encryption configuration, encrypted secrets file, pre-commit checks,
  continuous integration definition. Each element is present, missing, or differs.
- **Plaintext secrets file**: The instance's own secrets file. Read by the instance; never
  versioned.
- **Encrypted secrets file**: The versioned, encrypted counterpart of the plaintext secrets file.
- **Encryption key**: A private key that can read the encrypted secrets file. The user's own key
  always; further keys (such as the instance host's) only when the user adds them (FR-028). Private
  keys live outside the repository; only their public halves are recorded in it.
- **Generation record**: The versioned list of generated files and sections, each with its
  content fingerprint and the release that produced it (FR-029).
- **Run summary**: The per-run report of what the skill did to each baseline element and why.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the reference fixture (a configuration directory with runtime files, a plaintext
  secrets file, and custom components), the first commit after bootstrapping contains zero
  runtime files, zero plaintext secret values, and zero private keys, verified by searching every
  file version control would include for each secret value.
- **SC-002**: A second run on an unchanged bootstrapped directory changes zero files.
- **SC-003**: A user edit to any generated file survives a re-run in 100% of cases on the
  reference fixture, and every unedited file generated by an earlier release is updated by a
  re-run with a newer release.
- **SC-004**: On the reference fixture, the configuration passes the instance's own validation
  after bootstrapping exactly when it passed before.
- **SC-005**: Each of the blocked-commit cases in FR-016 is blocked on the reference fixture, and
  a clean commit is not.
- **SC-006**: A user with the prerequisites installed goes from an unversioned configuration
  directory to a reviewed first commit in under 10 minutes, following only the skill's summary.
- **SC-007**: The generated continuous integration run passes on the reference fixture and fails,
  naming the problem, on the fixture with an injected configuration error, without any real secret
  or key available.
- **SC-008**: Every existing configuration file on the reference fixture is byte-identical after
  bootstrapping, except the main configuration file, whose only difference is the package loading
  line.

## Assumptions

- The user runs the skill through a coding agent that supports DomusOps skills, on their own
  machine (SEED §1: not a hosted service), running macOS, Linux, or Windows with WSL (FR-030).
- The supported code hosting service for continuous integration is GitHub; others are out of
  scope for this feature (SEED §2.2 names CI; the project itself uses GitHub).
- The encryption scheme is the one SEED §4 fixes: SOPS with age keys.
- The encryption tool, the key tool, version control, and Node 22 (which runs the skill's scripts
  and the pre-commit checks) are installed by the user; the skill checks for them and explains how
  to install them, but does not install them. The pre-commit checks use version control's own
  hooks, so no separate hook runner is needed (plan, research R2).
- Continuous integration uses the instance's own configuration validator, run from the official
  published distribution of the instance software at the version the repository records
  (FR-026). If the instance's version marker is missing, the skill asks the user for the version.
- The sandbox (backlog item 3) does not exist yet; this feature only leaves room for it (FR-020).
- The skill is published in this public repository under Apache-2.0, as the free funnel (SEED
  §2.2).
- Publishing the skill requires an article (SEED §7); drafting it is outside this repository.

### Out of Scope

- Reorganising existing configuration into packages, or moving inline secrets into the secrets
  file (`ha-migrate`).
- Scanning or rewriting version control history for leaked secrets (`ha-secrets-audit`).
- Scenario tests against an ephemeral instance (`@domusops/sandbox`).
- Deploying configuration or decrypted secrets to the running instance (copying, syncing, or
  pulling on the instance's host).
- Creating remotes, commits, or pushes; configuring the code hosting service (branch protection,
  repository secrets).
- Code hosting services other than GitHub.
- Native Windows (outside WSL).
- Any MCP tool; the skill uses none of the existing tools.
