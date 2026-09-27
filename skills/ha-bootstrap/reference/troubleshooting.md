# Troubleshooting ha-bootstrap

One section per stop reason (`specs/004-ha-bootstrap/data-model.md` §1.2). A run-scope stop means
nothing at all was changed; an element-scope stop means only that one element was skipped and
every other one still applied.

## `native_windows` (run-scope)

`domusops-bootstrap` refuses to run on native Windows. Install WSL (Windows Subsystem for Linux)
and run the exact same command from inside it — the configuration directory is reachable there,
typically under `/mnt/c/...` (or whichever drive letter holds it). Inside WSL the tool behaves
exactly as it does on Linux.

## `missing_prerequisite` (run-scope)

One or more of `git`, `sops`, `age-keygen`, or (for `validate` only) a container runtime is not on
`PATH`. The stop's `details` list each missing program with an install line for macOS and for
Debian/Ubuntu. Install what is listed and run the command again; nothing was changed by the
attempt that stopped.

## `not_config_dir` (run-scope)

No `configuration.yaml` was found in the directory. Point `--dir` at the actual Home Assistant
configuration directory — the one that holds `configuration.yaml` directly.

## `version_unknown` (element-scope: `instance-version` only)

Neither an existing `.domusops/instance-version` nor `.HA_VERSION` was found, and
`--instance-version` was not given. Ask the user for their instance's version (visible in Home
Assistant under Settings → About), then re-run with `--instance-version <YYYY.M.P>`, for example
`--instance-version 2026.9.3`. Every other element still applied on the run that reported this.

## `secrets_exposed` (element-scope: `sops-config` and `encrypted-secrets`)

`secrets.yaml` is currently tracked by git, or appears anywhere in the repository's history. Its
values must be treated as compromised: help the user rotate every credential in it (new
passwords, new tokens, new API keys) before proceeding. This skill never rewrites git history —
that is a separate concern (`ha-secrets-audit`, a paid skill). Once the secrets are rotated,
re-running still will not encrypt automatically until the exposed file is removed from history by
some other means; encrypting a file whose old values are still recoverable from history would be
misleading.

## `packages_elsewhere` (element-scope: `packages-loading` only)

The `homeassistant:` key in `configuration.yaml` is declared as an `!include` or as a flow mapping
(`homeassistant: { ... }`) rather than an ordinary block. The skill will not guess which file to
edit. Add `packages: !include_dir_named packages` inside it yourself, wherever it actually lives,
then re-run — the element will then report `"current"`.

## `hooks_conflict` (element-scope: `hooks-path` only)

Either `core.hooksPath` is already set to something other than `.githooks`, or
`.git/hooks/pre-commit` already exists. The skill never overwrites an existing hook setup. Add
this line to the user's existing pre-commit hook instead:

```sh
npx --yes @domusops/bootstrap check --staged
```

## `roundtrip_mismatch` (element-scope: `encrypted-secrets` only)

After encrypting `secrets.yaml`, decrypting the result back did not reproduce the original
content exactly. This should not happen; if it does, the newly written `secrets.sops.yaml` is
removed automatically and nothing else changes. Ask the user to check for anything unusual in
`secrets.yaml` (embedded control characters, mixed line endings) and try again; if it persists,
this is worth reporting as a bug.

## A key was just created

Whenever `key.created` is true in the summary, the single most important thing to tell the user is
to back up the key file at the path given. There is no recovery if it is lost: the encrypted
secrets become permanently unreadable. A password manager or a separate encrypted backup, never
inside this repository, is the right place for it.
