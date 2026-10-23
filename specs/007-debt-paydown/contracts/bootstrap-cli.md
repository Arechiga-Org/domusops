# Contract delta: `@domusops/bootstrap` CLI (US4)

This document amends [004 cli.md](../../004-ha-bootstrap/contracts/cli.md) and
[generated-files.md](../../004-ha-bootstrap/contracts/generated-files.md). Everything not listed
here is unchanged.

## `secrets add-key` / `secrets remove-key`

The existing checks still come first: the key format, already present, last recipient. Then the
record state of `sops-config` is computed (R17):

| State                 | Behaviour                                                        |
| --------------------- | ---------------------------------------------------------------- |
| `current`, `outdated` | As today: rewrite `.sops.yaml`, `sops updatekeys`, update record |
| `edited`              | Refuse; exit `1` (`EXIT_PROBLEMS`); no file changed              |
| `missing`             | As today (`add-key` refuses: there is no recipient list to edit) |

Refusal text, on standard error:

```text
.sops.yaml was changed outside DomusOps, so it is left as it is. To change its recipients, edit the `age` list in .sops.yaml by hand, then run: sops updatekeys secrets.sops.yaml
```

There is no option to override this.

## `init`, when `.sops.yaml` already lists recipients

- With `--apply`, the local age key is resolved, and created if absent. In a preview it is only
  looked up. The summary's `key` field is filled whenever a key is found or created.
- When the local public key is not one of the recipients, `next_steps` gains:

  ```text
  Your key cannot decrypt secrets.sops.yaml yet. Ask an existing recipient to run: npx --yes @domusops/bootstrap@<release> secrets add-key <your public key>
  ```

- When `.sops.yaml` was changed outside DomusOps (state `edited`), `add-key` would refuse, so the
  line points to the manual path instead:

  ```text
  Your key cannot decrypt secrets.sops.yaml yet. .sops.yaml was changed outside DomusOps, so ask an existing recipient to add <your public key> to its `age` list by hand and run: sops updatekeys secrets.sops.yaml
  ```

- In a preview, a key lookup that fails (an unreadable identity, a failing `SOPS_AGE_KEY_CMD`)
  adds no line and does not fail the run. With `--apply`, the key is resolved before any file of
  the `sops-config` step is written, so a key that cannot be read stops the run with that step
  untouched.
- In a preview with no local key:

  ```text
  You have no age key yet; init --apply creates one so a recipient can add you.
  ```

- Neither case is a stop; the exit code is unchanged. The summary format
  `domusops.bootstrap-summary/0.1` is unchanged.

## Generated files

Every command named in a generated file uses the pinned form
`npx --yes @domusops/bootstrap@<release> …`. This now includes:

- the `.sops.yaml` comment about add-key and remove-key;
- the comment about `validate`.

The changed template text makes previously generated, unedited copies of `.sops.yaml`
`outdated`. The next `init --apply` refreshes them. `.domusops/placeholders.yaml` belongs to the
user and is never rewritten, so only a newly created copy has the pinned comment; an existing one
keeps the old wording until the user edits it.
