# Quickstart: validating ha_system_log

## Prerequisites

- `pnpm install` and `pnpm build` at the repository root.
- Docker running and the pinned releases available locally, for §4 only.

## 1. The format and its decoder

```sh
pnpm exec vitest run packages/schema/test/system-log-expand.test.ts packages/mcp/test/system-log-json-schema.test.ts packages/mcp/test/system-log-roundtrip.test.ts
```

Expected: `expandSystemLog` returns, in the document's order, every entry the document was built
from, with its level, logger, integration and where it came from, source, count, first and last
occurrence, messages and traceback text rebuilt exactly from `parts` (data-model §5); every
document of the tests is valid against `systemLogJsonSchema`.

## 2. On the simulated instance

```sh
pnpm exec vitest run packages/mcp/test/system-log.test.ts packages/mcp/test/system-log-encode.test.ts packages/mcp/test/system-log-redaction.test.ts
```

Expected:

- with no input, every entry of the log is returned, oldest last occurrence first, and two calls
  on an unchanged log give the same text (User Story 1, SC-001, SC-005);
- an entry's integration comes from its logger, or from its source for a library logger, which
  the entry marks; custom integrations are listed in `custom` (FR-003, research R3);
- `integrations` and `exclude` select by domain and pattern; an entry with no integration is kept
  only without `integrations` (FR-004);
- `level` keeps entries at that level or above, and `start` the entries whose last occurrence is at
  or after it; a future `start` is a `window_invalid` error and nothing is read (FR-005, FR-006);
- a result above `DOMUSOPS_SYSTEM_LOG_MAX_BYTES` is a `too_large` error with the entry count
  (FR-010, SC-003);
- `summary` gives the counts per integration and level, and a row for entries without an
  integration (User Story 3, FR-012);
- an empty log and a query that matches nothing are valid documents with their notes (FR-011);
- without `system_log` in the loaded components, a `system_log_unavailable` error (FR-013);
- the seeded token, credentials, e-mail addresses and coordinates are absent from every message and
  traceback, and no seeded root of the installation, configuration or Python library directory
  appears, while every file name and line number does (SC-004);
- after the handshake, only `auth/current_user`, `get_config` and one `system_log/list` with no
  parameter are received, on one connection (FR-014);
- a `compression_ratio` of at least 1.8 on the reference fixture (FR-017, SC-002).

## 3. Through the MCP server

```sh
pnpm exec vitest run packages/mcp/test/tool.test.ts packages/mcp/test/ping.test.ts packages/mcp/test/readme.test.ts packages/mcp/test/client.test.ts
```

Expected: `ha_system_log` is listed with the title, description, input schema and annotations of
[contracts/ha_system_log.tool.json](./contracts/ha_system_log.tool.json); the requirements table
has its row and `ha_ping` reports it ready on a healthy instance; the README's decoding example
decodes a system log document with `expandSystemLog`; the client refuses `system_log/list` with any
parameter.

## 4. Against real releases (§8)

```sh
DOMUSOPS_CONTAINER_TESTS=1 DOMUSOPS_SANDBOX_CHANNEL=stable DOMUSOPS_SANDBOX_RELEASE=2026.10.0 \
  pnpm exec vitest run packages/sandbox/test/mcp.container.test.ts
```

Expected: on a sandbox instance with a synthetic custom integration that logs on demand,
`ha_system_log` returns its entries with their counts, messages and tracebacks; a library logger's
entry belongs to the integration through its source; frame paths start with `{config}/`, `{ha}/` or
`{python}/`; the seeded e-mail address, URL credentials and coordinates are redacted; `summary`
counts match `standard`; and the `compression_ratio` is above 1. Repeat with 2026.9.4; CI runs
stable, previous stable and beta.

## 5. The gate

```sh
pnpm lint && pnpm typecheck && pnpm test
```
