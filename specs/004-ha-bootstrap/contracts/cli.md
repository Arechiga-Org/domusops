# Contract: `domusops-bootstrap` CLI

Package `@domusops/bootstrap`, binary `domusops-bootstrap`. The skill, the pre-commit hook, and the
CI workflow are its only intended callers; the commands are also documented for users (FR-013,
FR-027, FR-028). Output formats are in [data-model.md](../data-model.md) §3 and §4.

Every command runs these run-scope checks first and changes nothing when one fails:
`native_windows`, then the prerequisites the command needs (table below), then `not_config_dir`
for commands that take a directory.

## Global

- `--dir <path>`: the configuration directory. Default: the current directory.
- `--json`: machine-readable output (where a JSON form is defined).
- `--version`, `--help`.

## Exit codes

| Code | Meaning                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done (for `init`: every element `current`, `created`, or `updated`)                                                                 |
| 1    | Checks found problems (`check`, `validate`); or `init` finished with an element `blocked` or `differs` needing the user's attention |
| 2    | Run-scope stop: nothing was changed                                                                                                 |
| 64   | Usage error                                                                                                                         |

## Commands

### `init [--apply] [--instance-version <v>]`

Computes the state of every baseline element (data-model §1) and, with `--apply`, performs the
actions. Without `--apply`, writes nothing (preview, research R13). Prints the run summary.
Prerequisites: `git`, `sops`, `age-keygen`.

Order of application with `--apply`: `repository`, `gitignore-block`, tracked-path findings,
`packages-readme`, `packages-loading`, key resolution or creation, `sops-config`,
`encrypted-secrets` (with round-trip proof), `placeholders`, `instance-version`, `hook`,
`hooks-path`, `workflow`, `record`. An element-scope stop blocks only its element and those
listed with it in data-model §1.2; the rest continue.

Guarantees: never commits, pushes, adds remotes, untracks, or rewrites history; never writes a
private key except when creating a new one at the default location outside the repository;
never contacts the instance (FR-025).

### `check (--staged | --all) [--ci]`

Runs the rules of research R8 on staged blobs or every tracked file. `--ci` skips `secret-value`.
Prerequisites: `git`. Exit 0 or 1.

### `validate [--ci]`

Full validation (research R9) at `.domusops/instance-version` with placeholder secrets.
Prerequisites: `git`, and `docker` or `podman` (exit 2 with guidance when neither is found).
`--ci` only changes output: GitHub annotation lines (`::error file=…`) in addition to text.

### `secrets decrypt`

Writes `secrets.yaml` from `secrets.sops.yaml`, atomically, mode 0600. Refuses (exit 1) when
`secrets.yaml` exists and differs from the decrypted content, unless `--force`; the message says
to run `secrets encrypt` first if the local edits are wanted. Prerequisites: `sops`.

### `secrets encrypt`

Re-encrypts `secrets.yaml` into `secrets.sops.yaml` with the recipients of `.sops.yaml`, with the
round-trip proof. Prerequisites: `sops`.

### `secrets add-key <age-public-key>` / `secrets remove-key <age-public-key>`

Edits the recipients of `.sops.yaml`, runs `sops updatekeys --yes secrets.sops.yaml`, and updates
the record entry of `sops-config` (FR-028). `add-key` rejects a string that is not an age public
key (`age1` plus 58 characters) or is already present; `remove-key` refuses the last recipient.
Prerequisites: `sops`, and the user's own age identity.

## Environment

| Variable                 | Effect                                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| `SOPS_AGE_KEY_FILE` etc. | Honoured as SOPS honours them (research R6)                              |
| `DOMUSOPS_BOOTSTRAP_CLI` | Test and development only: the hook shim runs this path instead of `npx` |
| `DOMUSOPS_CONTAINER`     | `docker` or `podman`, to force a runtime for `validate`                  |

## Skill invocation

`skills/ha-bootstrap/SKILL.md` calls `npx --yes @domusops/bootstrap@~<major.minor> <command>`.
The generated hook and workflow call `@domusops/bootstrap@<exact release>` from the generation
record, so a user's commits and CI do not change behaviour until the user re-runs the skill
(research R2, R16).
