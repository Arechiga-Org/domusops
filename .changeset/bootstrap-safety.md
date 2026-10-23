---
"@domusops/bootstrap": patch
---

Safer key handling and pinned commands. `secrets add-key` and `secrets remove-key` now refuse to rewrite a `.sops.yaml` that was changed outside DomusOps, say how to change the recipients by hand, and leave every file as it was. When `.sops.yaml` already lists recipients, `init` now reports this machine's age key (creating it with `--apply`) and, if that key is not a recipient, tells you which `add-key` command a recipient has to run. The comments in the generated `.sops.yaml` and `.domusops/placeholders.yaml` now name the pinned `npx --yes @domusops/bootstrap@<release>` form instead of the bare command, so a generated `.sops.yaml` from an earlier release shows as outdated until the next `init --apply`.
