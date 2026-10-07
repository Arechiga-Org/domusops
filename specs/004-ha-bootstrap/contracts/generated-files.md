# Contract: Files Generated in the User's Repository

What `init --apply` writes. Ownership and states are in [data-model.md](../data-model.md) §1;
rationale in [research.md](../research.md). Every generated file is English (FR-024), names
DomusOps as its author, and refers to the instance nominatively ("for Home Assistant") only.
Templates contain no timestamp, user name, or machine path, so they render to identical bytes for
the same inputs (research R12).

## `.gitignore` block

```text
# >>> DomusOps baseline (managed by ha-bootstrap; edit outside this block) >>>
# Runtime files written by the instance, credentials, and installed artefacts.
secrets.yaml
*.db
*.db-shm
*.db-wal
*.log
*.log.*
.storage/
.cloud/
.ssh/
.cache/
__pycache__/
deps/
tts/
.HA_VERSION
.ha_run.lock
.uuid
ip_bans.yaml
.google.token
custom_components/
www/community/
# <<< DomusOps baseline <<<
```

`custom_components/` and `www/community/` are left out when the user already tracks files under
them. The block is appended after the user's content, separated by one blank line.

## `configuration.yaml`

Only the line `packages: !include_dir_named packages`, placed as in research R5; or the two lines
`homeassistant:` / `  packages: !include_dir_named packages` appended at the end, preceded by a
newline if the file does not end with one.

## `packages/README.md`

States that each `*.yaml` file in the directory is a package named after the file, loaded by the
line above; shows one short example package (an `input_boolean` and an automation using it); and
says that non-YAML files, such as this one, are ignored by the loader.

## `.sops.yaml`

```yaml
# Encryption rules for secrets.sops.yaml, managed by ha-bootstrap.
# Add or remove keys with: domusops-bootstrap secrets add-key|remove-key <age public key>
creation_rules:
  - path_regex: (^|/)secrets\.sops\.yaml$
    age: >-
      age1...,
      age1...
```

## `secrets.sops.yaml`

SOPS output for `secrets.yaml`: keys readable, values `ENC[...]`, plus the `sops` metadata
section. Never hand-written by the CLI.

## `.domusops/placeholders.yaml`

```yaml
# Placeholder values used only to validate the configuration in CI and with
# `domusops-bootstrap validate`. They are not your secrets and must never be.
# Add an entry when a default placeholder fails validation, for example:
#   weather_api_url: https://placeholder.invalid/api
{}
```

## `.domusops/instance-version`

One line, the instance version, for example `2026.9.3`.

## `.githooks/pre-commit`

```sh
#!/bin/sh
# Pre-commit checks for this configuration, managed by ha-bootstrap.
if [ -n "$DOMUSOPS_BOOTSTRAP_CLI" ]; then
  exec "$DOMUSOPS_BOOTSTRAP_CLI" check --staged
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "DomusOps pre-commit: npx not found. Install Node 22 or later to run these checks." >&2
  exit 1
fi
exec npx --prefer-offline --yes @domusops/bootstrap@<release> check --staged
```

Mode 0755. A missing `npx` blocks the commit with the message above rather than skipping the
checks silently.

## `.github/workflows/domusops.yml`

```yaml
# Checks and validation for this configuration, managed by ha-bootstrap.
name: domusops
on:
  push:
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes @domusops/bootstrap@<release> check --all --ci
  validate:
    needs: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes @domusops/bootstrap@<release> validate --ci
```

The job ids `checks` and `validate` are stable (FR-020): a later sandbox job declares
`needs: validate`. No repository secret is referenced.

## `.domusops/generated.json`

As in data-model §2.
