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

The four packages are published at 0.1.x: `ha_snapshot`, `ha_logbook_query` and `ha_trace`, the
sandbox harness, and the `ha-bootstrap` skill with its CLI.
Current work: phase 2 of the roadmap, the `@domusops/mcp` 0.2.0 read tools, one numbered feature
each, released together. All four are merged: `ha_ping` (009), `ha_state` (010), `ha_history`
(011) and `ha_system_log` (012). Next: the Version Packages pull request (#36), which publishes
`@domusops/mcp` and `@domusops/schema` 0.2.0. Then the scenario and assertion DSL (006), not yet
specified.
