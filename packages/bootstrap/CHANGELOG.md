# @domusops/bootstrap

## 0.1.1

### Patch Changes

- 4552668: Safer key handling and pinned commands. `secrets add-key` and `secrets remove-key` now refuse to rewrite a `.sops.yaml` that was changed outside DomusOps, say how to change the recipients by hand, and leave every file as it was. When `.sops.yaml` already lists recipients, `init` now reports this machine's age key (creating it with `--apply`) and, if that key is not a recipient, tells you which `add-key` command a recipient has to run. The comments in the generated `.sops.yaml` and in a newly created `.domusops/placeholders.yaml` now name the pinned `npx --yes @domusops/bootstrap@<release>` form instead of the bare command. A `.sops.yaml` from an earlier release shows as outdated until the next `init --apply`; an existing `placeholders.yaml` is yours and is left as it is.
- b520d21: Every package now ships its TypeScript sources next to `dist`, so the source maps and declaration maps in a package resolve from the package alone. `@domusops/schema` gains a README that says what the package is, how to install it, which formats it exports, and what stability it promises.

## 0.1.0

### Minor Changes

- e298fe3: Add the `@domusops/bootstrap` package: the CLI behind the `ha-bootstrap` skill. `init` brings an existing Home Assistant configuration directory to a GitOps baseline (a repository, an excluded-files block, `packages/` loading, SOPS/age encryption of `secrets.yaml`, a pre-commit hook, a GitHub Actions workflow, and the recorded instance version), previewing by default and writing only with `--apply`. `check` runs light pre-commit rules (malformed YAML, plaintext secrets, unencrypted `.sops.yaml`, a leaked secret value, a private key). `validate` runs the instance's own configuration validator in a container, with placeholder secrets, at the recorded version. `secrets decrypt|encrypt|add-key|remove-key` manage the encrypted file directly. Every skill-owned file is tracked by content hash, so a re-run changes nothing when there is nothing to do and never overwrites a user's edit.
