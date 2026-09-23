---
name: ha-bootstrap
description: Scaffold an opinionated GitOps repository layout for a Home Assistant instance — packages/ layout, SOPS/age secrets, .gitignore, pre-commit, CI. Use when starting version control for a Home Assistant configuration from zero.
---

# ha-bootstrap

Not yet implemented. Tracked as backlog item 2 in `01-SEED.md` §6, after
`ha_snapshot` ships (see repo `CLAUDE.md` — "Current focus").

Planned scope:
- Repository layout for HA config as code (`packages/`-style split).
- Secrets via SOPS + age, never plaintext.
- `.gitignore` tuned for Home Assistant (`.storage/`, `secrets.yaml`, etc).
- Pre-commit hooks: `hass --script check_config`, yamllint.
- GitHub Actions CI wired to `@domusops/sandbox` once that exists.
