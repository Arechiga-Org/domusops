# Quickstart: ha-bootstrap validation scenarios

Runnable scenarios proving the feature end to end. Contracts: [cli.md](./contracts/cli.md),
[generated-files.md](./contracts/generated-files.md). States and output:
[data-model.md](./data-model.md).

## Prerequisites

- Node 22+, pnpm 9, git.
- `sops` 3.13.x and `age` 1.2.x on `PATH` (macOS: `brew install sops age`; Debian/Ubuntu: `age`
  from apt, `sops` from its release page).
- Docker (or Podman) for scenarios 7 and 8 only.
- Build: `pnpm install && pnpm build`. `CLI=$PWD/packages/bootstrap/dist/cli.js`.
- A throwaway age key, so no real key is touched:
  `export SOPS_AGE_KEY_FILE=$(mktemp -d)/keys.txt` (scenario 1 creates it).
- The reference fixture: `node packages/bootstrap/test/fixtures/build-reference.mjs <dir>` writes
  a configuration directory with `configuration.yaml`, `automations.yaml`, `secrets.yaml` (fake
  values), a database and its journal files, a log, `.storage/`, `.HA_VERSION`,
  `custom_components/example/`, `www/community/`, and one inline `api_key`.

Automated equivalents live in `packages/bootstrap/test/`; `pnpm test` runs all but scenarios 7 and
8, which run in the `bootstrap-validate` CI job.

## 1. Preview, then apply (User Stories 1 and 2; SC-001, SC-008)

```sh
node $CLI init --dir $FX            # preview
git -C $FX status --porcelain       # fails: not a repository yet — nothing was written
node $CLI init --dir $FX --apply
```

Expected: the preview lists every element as `would create` and changes nothing. After
`--apply`: `.git/` exists; the key file exists at `$SOPS_AGE_KEY_FILE` with mode 0600; summary
lists each element `created`, findings list the inline `api_key` (no value shown) and
`custom_integrations: ["example"]`, and next steps start with backing up the key.

Then:

```sh
git -C $FX add -A && git -C $FX status --porcelain
```

Expected: no `*.db*`, `*.log`, `.storage/`, `.HA_VERSION`, `secrets.yaml`, `custom_components/`,
or `www/community/` path is staged; `grep -rF <each fake secret value>` over the staged files
finds nothing; every pre-existing file except `configuration.yaml` is byte-identical to the
fixture, and `configuration.yaml` differs by the packages lines only.

## 2. Round trip of secrets (FR-012, FR-013)

```sh
rm $FX/secrets.yaml && node $CLI secrets decrypt --dir $FX
diff <(sort $FX/secrets.yaml) <(sort <fixture original>)
```

Expected: identical keys and values; mode 0600.

## 3. Re-run is a no-op (User Story 4; SC-002)

```sh
node $CLI init --dir $FX --apply && git -C $FX status --porcelain
```

Expected: every element `unchanged`; no file modified.

## 4. Edited and outdated elements (FR-022, FR-029; SC-003)

Edit a line of `.github/workflows/domusops.yml`; delete `packages/README.md`; run `init --apply`.
Expected: the workflow is `differs` and untouched; the README is `created`. The automated test
also simulates an older release (record `release` and hashes of an older template) and expects
`updated` for unedited elements only.

## 5. Blocked commits (User Story 3; SC-005)

```sh
export DOMUSOPS_BOOTSTRAP_CLI="node $CLI"
```

In `$FX`, stage and commit each separately: a YAML file with a bad indent; `secrets.yaml` (force-add);
a file containing one fake secret value; a file containing `AGE-SECRET-KEY-1...`; a
`secrets.sops.yaml` with one plain value. Expected: each commit is blocked with
`<path>:<line>: <rule>` and no secret or key in the message. A clean change commits.

## 6. Secrets already exposed (FR-014)

Commit `secrets.yaml` in a fresh copy of the fixture before bootstrapping, then `init --apply`.
Expected: `sops-config` and `encrypted-secrets` are `blocked` with `secrets_exposed` and the
rotation message; the other elements apply; no history is rewritten (`git log` unchanged).

## 7. Full validation passes (FR-018, FR-027; SC-004, SC-007)

```sh
node $CLI validate --dir $FX
```

Expected: exit 0 on the reference fixture; the `example` custom integration appears as a warning,
not an error. **Verifies**: the container entrypoint override (research R9), that an empty
`packages/` validates (R5), and typed placeholders (R7). The same fixture validated before
bootstrapping gives the same result.

## 8. Full validation fails with the validator's message

Inject an unknown key under a built-in integration in `configuration.yaml`; run `validate`.
Expected: exit 1 and the validator's own error text. Remove Docker from `PATH`: exit 2, the
guidance message, and no change.

## 9. Keys (FR-028)

Generate a second key with `age-keygen`; `secrets add-key <its public key>`; decrypt with only
the second key (`SOPS_AGE_KEY_FILE` pointing to it). Expected: success. `secrets remove-key` of
the first key succeeds; removing the second, now last, key is refused. `init --apply` afterwards
reports `.sops.yaml` as `unchanged`, not `differs`.

## 10. Stops (FR-004, FR-030)

- Directory without `configuration.yaml`: exit 2, `not_config_dir`, nothing written.
- `PATH` without `sops`: exit 2, `missing_prerequisite` with install lines for macOS and Linux.
- Platform forced to `win32` in the unit test: exit 2, `native_windows`, WSL guidance.
