---
"@domusops/sandbox": minor
---

Load a Home Assistant configuration directory into a sandbox instance with `config: { dir, secretsFile? }` or `domusops-sandbox start --config <dir> [--secrets-file <file>]`. The directory is read, never written: it is packed in memory and copied into the container, leaving out runtime state, media, caches, logs, `.git`, `node_modules`, `secrets.yaml`, `secrets.sops.yaml` and age keys, skipping links that leave the directory or point at something left out, and refusing a directory of more than 256 MiB. Secrets referenced with `!secret` get placeholders (typed from SOPS markers when present) unless a plaintext secrets file is named. A configuration the instance rejects, including one that starts it in recovery mode, ends the start with `config_invalid` and the validation errors, and the container is removed. The start reports what was loaded, what was left out and which secrets were used.
