# Quickstart: validating ha_state

## Prerequisites

- `pnpm install` and `pnpm build` at the repository root.
- Docker running and the pinned releases available locally, for §4 only.

## 1. The format and its decoder

```sh
pnpm exec vitest run packages/schema/test/state-expand.test.ts packages/mcp/test/state-json-schema.test.ts packages/mcp/test/state-roundtrip.test.ts
```

Expected: `expandState` returns, in entity-ID order, the redacted states the document was built
from, times equal to the second in local form and context IDs full (data-model §6); every
document of the tests is valid against `stateJsonSchema`.

## 2. On the simulated instance

```sh
pnpm exec vitest run packages/mcp/test/state.test.ts packages/mcp/test/state-encode.test.ts
```

Expected:

- `light.*` returns every light with its state, attributes, times and context, in object-ID
  order, and two calls give the same text (User Story 1);
- `domain`, `state`, `entities` and `exclude`, alone and combined, select exactly the expected
  entities, in the order of research R2; `attributes` trims attributes without changing the
  selection (User Story 2, FR-006);
- an exact ID that does not exist is named in a note; an empty selection is a valid document
  with a note (FR-013);
- a `standard` result above `DOMUSOPS_STATE_MAX_BYTES` is a `too_large` error with the entity
  count, and `summary` is never refused (FR-012);
- `summary` gives the counts per domain and stays under 4,000 bytes with 120 domains
  (User Story 3, FR-014);
- the seeded secrets, e-mail addresses and coordinates are absent, and names remain (FR-010,
  FR-011, SC-005);
- only `auth/current_user`, `get_config` and `get_states` are received after the handshake, on
  one connection (FR-016);
- a `compression_ratio` of at least 2 on the whole reference fixture (FR-019, SC-002).

## 3. Through the MCP server

```sh
pnpm exec vitest run packages/mcp/test/tool.test.ts packages/mcp/test/ping.test.ts packages/mcp/test/readme.test.ts
```

Expected: `ha_state` is listed with the title, description, input schema and annotations of
[contracts/ha_state.tool.json](./contracts/ha_state.tool.json); the requirements table has its
row and `ha_ping` reports it ready on a healthy instance; the README's decoding example decodes
a state document with `expandState`.

## 4. Against real releases (§8)

```sh
DOMUSOPS_CONTAINER_TESTS=1 DOMUSOPS_SANDBOX_CHANNEL=stable DOMUSOPS_SANDBOX_RELEASE=2026.10.0 \
  pnpm exec vitest run packages/sandbox/test/mcp.container.test.ts
```

Expected: on a sandbox instance with `default_config`, `ha_state` returns `zone.home` with its
coordinates redacted, a `summary` whose counts match the full `standard` result, and a
`compression_ratio` at the bound research R10 records for the full instance. Repeat with 2026.9.4; CI runs stable,
previous stable and beta.

## 5. The gate

```sh
pnpm lint && pnpm typecheck && pnpm test
```
