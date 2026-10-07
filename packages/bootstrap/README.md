# @domusops/bootstrap

The CLI behind the `ha-bootstrap` skill (`skills/ha-bootstrap/`). Brings an existing Home
Assistant configuration directory to an opinionated GitOps baseline. Compatible with Home
Assistant; not affiliated with or endorsed by it.

The skill holds the judgement (what to ask, how to explain a stop); this package holds every
deterministic step, so it can be called directly by a pre-commit hook and by CI, not only by an
agent. Full design: `specs/004-ha-bootstrap/`.

## Commands

| Command                                   | Does                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init [--apply] [--instance-version <v>]` | Computes the state of all 12 baseline elements; writes them only with `--apply`. Without it, nothing changes (a preview).                             |
| `check (--staged \| --all) [--ci]`        | Runs the five pre-commit rules against staged or every tracked file. `--ci` skips the local-secret-value check, since no plaintext file exists there. |
| `validate [--ci]`                         | Runs the instance's own configuration validator, in a container, at the recorded instance version, with placeholder secrets. Needs Docker or Podman.  |
| `secrets decrypt [--force]`               | Writes `secrets.yaml` from `secrets.sops.yaml`, mode 0600. Refuses to overwrite local edits unless `--force`.                                         |
| `secrets encrypt`                         | Re-encrypts `secrets.yaml` into `secrets.sops.yaml`, with a round-trip check.                                                                         |
| `secrets add-key <age public key>`        | Adds a recipient (for example, a key generated on the instance's host) and re-encrypts for it.                                                        |
| `secrets remove-key <age public key>`     | Removes a recipient and re-encrypts. Refuses to remove the last one.                                                                                  |

Every command accepts `--dir <path>` (default: the current directory) and `--json` (machine-
readable output). Full contract, including exit codes and the JSON shapes: `specs/004-ha-bootstrap/contracts/cli.md`.

## Exit codes

| Code | Meaning                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 0    | Done — every element applied cleanly, or `check`/`validate` found nothing                             |
| 1    | `check`/`validate` found problems, or `init` finished with an element blocked or differing            |
| 2    | A run-scope stop: nothing was changed (missing prerequisite, native Windows, no `configuration.yaml`) |
| 64   | Usage error                                                                                           |

## Environment variables

| Variable                                                | Effect                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`, `SOPS_AGE_KEY_FILE`, `SOPS_AGE_KEY_CMD` | Honoured exactly as SOPS itself honours them, for identity resolution           |
| `DOMUSOPS_CONTAINER`                                    | `docker` or `podman`, to force which runtime `validate` uses                    |
| `DOMUSOPS_BOOTSTRAP_CLI`                                | Development only: the generated pre-commit hook runs this path instead of `npx` |

## The baseline

Twelve elements — a repository, a marked `.gitignore` block, `packages/` and its loading line,
SOPS/age encryption of `secrets.yaml`, placeholder secrets for validation, the recorded instance
version, a pre-commit hook, `core.hooksPath`, a GitHub Actions workflow, and the generation record
that tracks all of the skill-owned ones. Full list with ownership and states:
`specs/004-ha-bootstrap/data-model.md` §1.

Every skill-owned file (the `.gitignore` block, `packages/README.md`, `.sops.yaml`, the hook, the
workflow) is deterministic and tracked by content hash in `.domusops/generated.json`: a re-run
changes nothing when there is nothing to do, upgrades a file the user never edited when a newer
release changed its template, and never touches one the user has edited by hand.

## Encryption

SOPS with age, values only — key names in `secrets.sops.yaml` stay readable (that is what lets CI
validate without any real secret or key), values do not. The user's own age identity is resolved
the same way SOPS itself resolves it; one is created only when none is found. See
`skills/ha-bootstrap/reference/troubleshooting.md` for what to do about an exposed `secrets.yaml`,
a `core.hooksPath` conflict, and every other stop reason.
