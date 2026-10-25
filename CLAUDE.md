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
Current feature: the debt paydown after the 0.1.0 release (specs/007-debt-paydown/), one pull
request per user story. Next feature: the scenario and assertion DSL (006), not yet specified.
