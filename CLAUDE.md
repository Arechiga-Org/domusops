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

Published: `@domusops/mcp` and `@domusops/schema` 0.2.0, `@domusops/sandbox` 0.1.3 and
`@domusops/bootstrap` 0.1.1. Phase 2 of the roadmap is done: the server has `ha_snapshot`,
`ha_logbook_query`, `ha_trace` and the four 0.2.0 read tools, `ha_ping` (009), `ha_state` (010),
`ha_history` (011) and `ha_system_log` (012).
Next: the scenario and assertion DSL (006), not yet specified.
