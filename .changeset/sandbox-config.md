---
"@domusops/sandbox": minor
---

Load a Home Assistant configuration directory into a sandbox instance with `config: { dir, secretsFile? }` or `domusops-sandbox start --config <dir> [--secrets-file <file>]`. The directory is read, never written: it is packed in memory and copied into the container, leaving out runtime state, caches, logs, `.git`, `secrets.yaml`, `secrets.sops.yaml` and age keys, and skipping links that leave the directory. Secrets referenced with `!secret` get placeholders (typed from SOPS markers when present) unless a plaintext secrets file is named. A configuration the instance rejects, including one that starts it in recovery mode, ends the start with `config_invalid` and the validation errors, and the container is removed. The start reports what was loaded, what was left out and which secrets were used.
