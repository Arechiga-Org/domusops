# Data Model: ha-bootstrap

Phase 1 output for [plan.md](./plan.md). Names are the ones the code and the CLI's JSON output
use. Research references are to [research.md](./research.md).

## 1. Baseline elements

The baseline (spec Key Entities) is a fixed, ordered list of elements. Each has an owner: **skill**
elements are tracked by the generation record and upgraded when unedited; **user** elements are
created once if missing and never rewritten.

| Id                  | Path                              | Owner | Content                                                             | Requirement    |
| ------------------- | --------------------------------- | ----- | ------------------------------------------------------------------- | -------------- |
| `repository`        | `.git/`                           | user  | `git init` when absent; never commits, pushes, or adds remotes      | FR-005         |
| `gitignore-block`   | `.gitignore`, marked block        | skill | Exclusion entries (R4); text outside the block is the user's        | FR-006, FR-007 |
| `packages-loading`  | `configuration.yaml`, one line    | user  | `packages: !include_dir_named packages` under `homeassistant:` (R5) | FR-003, FR-008 |
| `packages-readme`   | `packages/README.md`              | skill | What goes in `packages/`, one example                               | FR-009         |
| `sops-config`       | `.sops.yaml`                      | skill | One creation rule; recipients list (R6)                             | FR-010, FR-028 |
| `encrypted-secrets` | `secrets.sops.yaml`               | user  | Encrypted from `secrets.yaml`, or an encrypted empty mapping        | FR-010, FR-012 |
| `placeholders`      | `.domusops/placeholders.yaml`     | user  | Comment and no entries (R7)                                         | FR-019         |
| `instance-version`  | `.domusops/instance-version`      | user  | One line, from `.HA_VERSION` or `--instance-version` (R11)          | FR-026         |
| `hook`              | `.githooks/pre-commit`            | skill | Shell shim calling `check --staged` at the exact release (R2)       | FR-016         |
| `hooks-path`        | local git config `core.hooksPath` | user  | `.githooks`; not a file, restored on re-run                         | FR-016, FR-021 |
| `workflow`          | `.github/workflows/domusops.yml`  | skill | Jobs `checks` and `validate` (R10)                                  | FR-018, FR-020 |
| `record`            | `.domusops/generated.json`        | skill | The generation record itself (§2); not listed inside itself         | FR-029         |

`packages-loading` and `encrypted-secrets` are user-owned because their content is the user's
configuration and secrets; the skill only checks that they are present.

### 1.1 Element states and actions

Computed per element on every run, in both preview and apply (R12, R13):

| State      | Condition                                                                              | Action with `--apply` | Summary verb |
| ---------- | -------------------------------------------------------------------------------------- | --------------------- | ------------ |
| `missing`  | Absent                                                                                 | create                | `created`    |
| `current`  | Present; for skill elements, hash equals record and current template                   | none                  | `unchanged`  |
| `outdated` | Skill element; hash equals record, differs from current template                       | rewrite               | `updated`    |
| `edited`   | Skill element; hash differs from record, or no usable record and differs from template | none                  | `differs`    |
| `blocked`  | Cannot be applied safely (stop reason below)                                           | none                  | `blocked`    |

A user element that is present is always `current`. Transitions happen only on `--apply`; preview
reports the verb it would use, prefixed `would`.

### 1.2 Stop reasons

A stop reason blocks one element (element scope) or the whole run (run scope). Run-scope stops
happen before any write (FR-004).

| Reason                 | Scope   | Cause                                                                                                              |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `native_windows`       | run     | `process.platform === "win32"` (FR-030)                                                                            |
| `missing_prerequisite` | run     | `git`, `sops`, or `age-keygen` not found; `details` lists each with install lines per OS                           |
| `not_config_dir`       | run     | No `configuration.yaml` in the target directory                                                                    |
| `version_unknown`      | element | No `.domusops/instance-version`, no `.HA_VERSION`, no `--instance-version` (R11); blocks `instance-version` only   |
| `secrets_exposed`      | element | `secrets.yaml` tracked or in history (FR-014); blocks `encrypted-secrets` and `sops-config`                        |
| `packages_elsewhere`   | element | `homeassistant:` is an include or a flow mapping (R5)                                                              |
| `hooks_conflict`       | element | `core.hooksPath` set elsewhere, or `.git/hooks/pre-commit` exists (R2)                                             |
| `roundtrip_mismatch`   | element | Decrypted content differs from `secrets.yaml` (FR-012); the new file is discarded, the previous one kept           |
| `sops_failed`          | element | `sops` failed while encrypting, decrypting, or re-wrapping keys; `secrets.sops.yaml` and `.sops.yaml` are restored |

## 2. Generation record

`.domusops/generated.json`, pretty-printed with sorted keys and a trailing newline, so a re-run
writes identical bytes (FR-021).

```json
{
  "format": "domusops.bootstrap/0.1",
  "release": "0.1.0",
  "elements": {
    "gitignore-block": {
      "path": ".gitignore",
      "sha256": "…",
      "release": "0.1.0"
    },
    "hook": {
      "path": ".githooks/pre-commit",
      "sha256": "…",
      "release": "0.1.0"
    },
    "packages-readme": {
      "path": "packages/README.md",
      "sha256": "…",
      "release": "0.1.0"
    },
    "sops-config": { "path": ".sops.yaml", "sha256": "…", "release": "0.1.0" },
    "workflow": {
      "path": ".github/workflows/domusops.yml",
      "sha256": "…",
      "release": "0.1.0"
    }
  }
}
```

- `release` (top level): the CLI release that last wrote the record; the hook and workflow call
  the CLI at this exact release.
- `sha256`: of the element's bytes as written. For `gitignore-block`, of the block from its first
  marker line to its last, inclusive.
- `sops-config` is rewritten by `secrets add-key` and `remove-key`, which update its entry, so a
  recipient change is not reported as a user edit. Its template input is the recipient list,
  read back from the file.
- Validation: unknown `format`, invalid JSON, or a missing field makes the whole record unusable
  (every differing skill element is `edited`, FR-029), and the summary says the record was
  rebuilt.

## 3. Run summary

Printed at the end of `init` (FR-023). Human text by default; `--json` prints this object, which
the skill reads to explain the result.

```json
{
  "format": "domusops.bootstrap-summary/0.1",
  "mode": "preview",
  "release": "0.1.0",
  "target": "/abs/path/to/config",
  "stop": null,
  "elements": [
    {
      "id": "gitignore-block",
      "path": ".gitignore",
      "state": "missing",
      "action": "would create",
      "reason": "No DomusOps exclusion block"
    }
  ],
  "findings": {
    "tracked_excluded": ["home-assistant_v2.db"],
    "inline_secrets": [
      { "path": "configuration.yaml", "line": 12, "key": "api_key" }
    ],
    "custom_integrations": ["hacs", "localtuya"],
    "nested_secrets_files": [],
    "ui_dashboards": true,
    "remote": "none"
  },
  "key": {
    "found": true,
    "created": false,
    "path": "~/.config/sops/age/keys.txt",
    "public": "age1…"
  },
  "next_steps": [
    "Back up the key file",
    "Review the changes with git status",
    "Make the first commit"
  ]
}
```

- `mode`: `preview` or `apply`.
- `stop`: `null`, or `{ "reason": <§1.2>, "message": <text>, "details": [...] }` for a run-scope
  stop; element-scope stops appear as `state: "blocked"` with the reason in `reason`.
- `findings.inline_secrets` (FR-015): values of keys whose name contains
  `password|passwd|token|api_key|apikey|secret|client_secret|private_key` (case-insensitive,
  substring match, so `backup_password` and `api_key_prod` both count) that
  are literal scalars rather than `!secret`; the value is never included.
- `findings.custom_integrations`: directory names under `custom_components/`, for the note that
  their configuration is not schema-checked in CI (R9).
- `key.path`: shown with `~` for the home directory. The private key is never read beyond parsing
  its public key and is never printed.
- Human form: one line per element, `<verb padded> <path>  <reason>`, then findings, then numbered
  next steps. No colour when stdout is not a terminal.
- `findings.remote`: `none`, `github`, or `other`; anything but `github` adds a next step saying
  the workflow runs only on GitHub (spec edge case).
- The summary lists only baseline elements, so it never mixes the user's own uncommitted changes
  with the skill's (spec edge case "already a repository with uncommitted changes").

## 4. Check result

`check` prints one line per hit and exits 1 if there is any:

```text
<path>:<line>: <rule-id>: <message>
```

`<line>` is omitted when the rule has no line (`plaintext-secrets`). Rule ids and their triggers
are in [research R8](./research.md#r8-pre-commit-checks). With `--json`:
`{ "format": "domusops.bootstrap-check/0.1", "hits": [{ "path", "line", "rule", "message" }] }`.
No message contains a secret value or key material.

## 5. Placeholder secrets

Built in memory, and written only inside the temporary validation directory (R9):

- Keys: every top-level key of `secrets.sops.yaml` except `sops`.
- Value: the override from `.domusops/placeholders.yaml` if present, else the typed default from
  the key's `type:` (R7).
- A `.domusops/placeholders.yaml` that does not parse, or whose top level is not a mapping, is a
  `validate` error naming the file.

## 6. Instance version

`.domusops/instance-version`: `^\d{4}\.\d{1,2}\.\d+(b\d+)?\n$`. Anything else is a `validate`
error naming the file and the expected form.
