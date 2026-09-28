---
name: ha-bootstrap
description: Brings an existing Home Assistant configuration directory to a GitOps baseline — a repository, an exclusion list for runtime files, packages/ loading, SOPS/age encryption of secrets.yaml, light pre-commit checks, and a GitHub Actions workflow that runs the instance's own configuration validator. Use when a Home Assistant configuration directory has never been put under version control, or to check it against the baseline again.
---

# ha-bootstrap

The deterministic steps live in `@domusops/bootstrap`, a CLI (`domusops-bootstrap`). This skill's
job is the judgement around it: show the user what would happen, explain what was found, ask
before changing anything, apply, then report the result in plain language. It never edits the
user's files itself and never invokes any command other than `domusops-bootstrap` (constitution
§3: the CLI holds the mechanism, the skill holds the workflow).

## What it produces

Twelve elements, listed in full in `packages/bootstrap/README.md` and
`specs/004-ha-bootstrap/data-model.md` §1: a git repository; a marked block in `.gitignore` that
excludes the instance's runtime files (databases, logs, `.storage/`, installed custom
integrations); `packages/` with its loading line in `configuration.yaml`; `secrets.yaml` encrypted
into `secrets.sops.yaml` with the user's own age key; a git pre-commit hook; a GitHub Actions
workflow that runs the same checks plus the instance's own configuration validator; and the
instance version the workflow validates against.

## Running it

1. **Preview first, always.** Run:

   ```sh
   npx --yes @domusops/bootstrap@~0.0 init --dir <configuration directory> --json
   ```

   This changes nothing. Read its `elements` list, `findings`, and `stop` (if any).

2. **Explain the preview to the user**, in their language, before doing anything:
   - Which elements are `missing` (would be created) versus already `current`.
   - Every finding: paths already tracked that the baseline would now exclude
     (`tracked_excluded`), possible secrets written inline instead of through `secrets.yaml`
     (`inline_secrets`, values never shown), custom integrations (not schema-checked by
     `validate`), nested `secrets.yaml` files outside the root (not encrypted), UI-mode
     dashboards (not versioned), and whether a remote other than GitHub is configured.
   - Any `stop`: see `reference/troubleshooting.md` for what each reason means and how to resolve
     it before trying again. A run-scope stop (`native_windows`, `missing_prerequisite`,
     `not_config_dir`) means nothing at all was changed; an element listed as `"blocked"` means
     only that one element was skipped and every other one still applied.

3. **Ask before applying.** Never pass `--apply` without the user's explicit go-ahead on this
   specific run's preview. If the directory is already a repository with the user's own
   uncommitted changes, say so and make clear the summary lists only the skill's own changes.

4. **Apply:**

   ```sh
   npx --yes @domusops/bootstrap@~0.0 init --dir <configuration directory> --apply --json
   ```

5. **Report the result and its `next_steps` in plain language.** If a key was just created
   (`key.created`), the single most important thing to say is to back up that key file: losing it
   means losing access to every encrypted secret. Point out `git status`/`git diff` for review and
   suggest the first commit once the user is ready.

6. **If anything is `"blocked"` or the run itself stopped**, walk the user through
   `reference/troubleshooting.md` for that reason, then re-run the preview.

## After the baseline is in place

- Editing secrets: `domusops-bootstrap secrets decrypt` (add `--force` to overwrite local edits
  that differ) to get a plaintext `secrets.yaml`, edit it, then
  `domusops-bootstrap secrets encrypt` to put it back. Never suggest committing the plaintext
  file; the pre-commit hook blocks that on its own regardless.
- Adding a second machine that should be able to decrypt secrets (typically the instance's own
  host): generate an age key there, then run
  `domusops-bootstrap secrets add-key <its public key>` from the repository. `remove-key` works
  the same way and refuses to remove the last recipient.
- Checking the current state again without changing anything: re-run the preview (step 1). A
  second run with nothing to do reports every element `"current"` and changes no file.
- Validating the full configuration locally (needs Docker or Podman): `domusops-bootstrap
validate`. The same check runs in the generated GitHub Actions workflow on every push.

## Constraints this skill respects

- Never runs on native Windows; on WSL it behaves exactly as it does on Linux.
- Never restructures existing configuration, moves inline secrets, or reorganises anything into
  `packages/` beyond enabling the loading line — that is `ha-migrate` (paid), not this skill.
- Never creates a commit, a remote, or a branch protection rule; committing is always the user's
  own decision.
- Every prerequisite this skill or the CLI needs (`git`, `sops`, `age-keygen`, and `docker` or
  `podman` for `validate`) is checked before anything changes, and reported with per-OS install
  instructions when missing.
