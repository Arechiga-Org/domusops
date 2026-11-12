# Quickstart: validating ha_history

## Prerequisites

- `pnpm install` and `pnpm build` at the repository root.
- Docker running and the pinned releases available locally, for §4 only.

## 1. The format and its decoder

```sh
pnpm exec vitest run packages/schema/test/history-expand.test.ts packages/mcp/test/history-json-schema.test.ts packages/mcp/test/history-roundtrip.test.ts
```

Expected: `expandHistory` returns, in entity-ID order, every entry the document was built from:
the start state, then each change with its state, its full attributes (redacted and, with
`attributes`, trimmed), `last_updated` to the second and `last_changed` restored from the sequence
(data-model §6); every document of the tests is valid against `historyJsonSchema`.

## 2. On the simulated instance

```sh
pnpm exec vitest run packages/mcp/test/history.test.ts packages/mcp/test/history-encode.test.ts packages/mcp/test/history-redaction.test.ts
```

Expected:

- named entities over a window return every recorded change, attribute-only ones included, in
  time order, after each entity's start state, and two calls over a past window give the same
  text (User Story 1, SC-001, SC-005);
- `entities`, patterns and `exclude` select exactly the expected entities; an entity named by
  exact ID that did not change shows its start state only, one matched by a pattern is left out
  (data-model §5);
- `attributes` keeps only the listed attributes, leaves out the changes in which neither the state
  nor a listed attribute changed, and counts them in `skipped` (FR-006);
- `significant_only` sends `significant_changes_only: true` and lists only what the instance
  returns;
- a window longer than 10 days is a `window_invalid` error and no history is read (FR-004);
- a `standard` result above `DOMUSOPS_HISTORY_MAX_BYTES` is a `too_large` error with the entity
  and change counts (FR-011, SC-003);
- `summary` without `entities` gives the counts per domain and stays under 4,000 bytes with 100
  domains; with `entities` it adds the rows per entity (User Story 3, FR-013);
- an exact ID with no recorded history is named in a note; an empty selection and a selection
  with no change are valid documents with their notes (FR-012);
- without `history` in the loaded components, a `history_unavailable` error (FR-014);
- the seeded secrets, e-mail addresses and coordinates are absent from every change (SC-004);
- after the handshake, only `auth/current_user`, `get_config`, `get_states` (only for a pattern or
  no `entities`) and one `history/history_during_period` with every flag explicit are received, on
  one connection (FR-015);
- a `compression_ratio` of at least 5 on the reference fixture and on its noisiest sensor (FR-018,
  SC-002).

## 3. Through the MCP server

```sh
pnpm exec vitest run packages/mcp/test/tool.test.ts packages/mcp/test/ping.test.ts packages/mcp/test/readme.test.ts packages/mcp/test/client.test.ts
```

Expected: `ha_history` is listed with the title, description, input schema and annotations of
[contracts/ha_history.tool.json](./contracts/ha_history.tool.json); the requirements table has its
row and `ha_ping` reports it ready on a healthy instance; the README's decoding example decodes a
history document with `expandHistory`; the client refuses `history/history_during_period` with a
missing or extra parameter.

## 4. Against real releases (§8)

```sh
DOMUSOPS_CONTAINER_TESTS=1 DOMUSOPS_SANDBOX_CHANNEL=stable DOMUSOPS_SANDBOX_RELEASE=2026.10.0 \
  pnpm exec vitest run packages/sandbox/test/mcp.container.test.ts
```

Expected: on a sandbox instance with a virtual light switched a few times, `ha_history` returns the
light's start state and changes in order, a `summary` whose counts match the `standard` result,
the start state of an entity named by exact ID that did not change, and a `compression_ratio`
above 1. Repeat with 2026.9.4; CI runs stable, previous stable and beta.

## 5. The gate

```sh
pnpm lint && pnpm typecheck && pnpm test
```
