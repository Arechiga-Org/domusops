# DomusOps

GitOps toolkit for Home Assistant. TypeScript, pnpm workspace, Spec Kit.

## Non-negotiable

Read `.specify/memory/constitution.md` before any write. §1 (English-only
artifacts) is enforced by a PreToolUse hook and cannot be waived.

## Commands

pnpm lint | pnpm typecheck | pnpm test | pnpm exec changeset

## Layout

packages/schema — snapshot + assertion contract (public, stable)
packages/mcp — MCP server
packages/sandbox — ephemeral HA test harness
packages/bootstrap — CLI behind the ha-bootstrap skill
skills/ — Claude Code skills
specs/ — Spec Kit feature specs

## Current focus

`ha_snapshot` (specs/001-ha-snapshot/) is done and merged. `ha_logbook_query`
(specs/002-ha-logbook-query/, PR #3) and `ha_trace` (specs/003-ha-trace/, PR #4) are
implemented and in review.
Current feature: the `ha-bootstrap` skill (specs/004-ha-bootstrap/), backlog item 2 of
docs/SEED.md §6: a skill in skills/ha-bootstrap/ backed by a new CLI package,
packages/bootstrap. Nothing else lands until it works end to end.
