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

`ha_snapshot`, `ha_logbook_query`, `ha_trace` and the `ha-bootstrap` skill are merged.
Current feature: `@domusops/sandbox` part 1, the ephemeral harness
(specs/005-sandbox-harness/), backlog item 3 of docs/SEED.md §6. The scenario and assertion
DSL is a later feature. Nothing else lands until the harness works end to end.
