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
skills/ — Claude Code skills
specs/ — Spec Kit feature specs

## Current focus

`ha_snapshot` (specs/001-ha-snapshot/) is done and merged. `ha_logbook_query`
(specs/002-ha-logbook-query/) is implemented and in review (PR #3).
Current feature: `ha_trace` (specs/003-ha-trace/), backlog item 1 of docs/SEED.md §6, second
half. Nothing else lands until it works end to end.
