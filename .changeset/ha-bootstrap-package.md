---
"@domusops/bootstrap": minor
---

Add the `@domusops/bootstrap` package: the CLI behind the `ha-bootstrap` skill. `init` brings an existing Home Assistant configuration directory to a GitOps baseline (a repository, an excluded-files block, `packages/` loading, SOPS/age encryption of `secrets.yaml`, a pre-commit hook, a GitHub Actions workflow, and the recorded instance version), previewing by default and writing only with `--apply`. `check` runs light pre-commit rules (malformed YAML, plaintext secrets, unencrypted `.sops.yaml`, a leaked secret value, a private key). `validate` runs the instance's own configuration validator in a container, with placeholder secrets, at the recorded version. `secrets decrypt|encrypt|add-key|remove-key` manage the encrypted file directly. Every skill-owned file is tracked by content hash, so a re-run changes nothing when there is nothing to do and never overwrites a user's edit.
