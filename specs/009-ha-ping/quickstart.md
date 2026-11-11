# Quickstart: validating ha_ping

## Prerequisites

- `pnpm install` and `pnpm build` at the repository root.
- Docker running and the pinned releases available locally, for §3 only.

## 1. On the simulated instance

```sh
pnpm exec vitest run packages/mcp/test/ping.test.ts packages/mcp/test/ping-json-schema.test.ts
```

Expected:

- a healthy instance: `admin` true, `instance.supported` true, the integrations loaded,
  every tool `ready`, no `next_steps`, and the server's name and version equal to the handshake's
  (spec User Story 1);
- a user who is not an administrator, an instance without `trace`, an instance below the
  minimum: each named in `reasons` of exactly the affected tools, with one sentence each in
  `next_steps` (User Story 2);
- an unreachable address, a refused token, a timeout, a missing variable: an error result with
  the existing kind and text, and no document (clarification 1);
- only `auth/current_user` and `get_config` received after the handshake (FR-008);
- the document valid against `pingJsonSchema`, under 2,000 bytes in the worst case of research
  R8, with a `compression_ratio` of at least 3 on the reference fixture (FR-013, SC-003);
- no token, address, coordinates, location name or user name in the text (FR-010).

## 2. Through the MCP server

```sh
pnpm exec vitest run packages/mcp/test/tool.test.ts packages/mcp/test/readme.test.ts
```

Expected: `ha_ping` is listed with the title, description, input schema and annotations of
[contracts/ha_ping.tool.json](./contracts/ha_ping.tool.json); the README's decoding example
returns a ping document as it is.

## 3. Against real releases (§8)

```sh
DOMUSOPS_CONTAINER_TESTS=1 DOMUSOPS_SANDBOX_RELEASE=2026.10.0 \
  pnpm exec vitest run packages/sandbox/test/mcp.container.test.ts
```

Expected: on a sandbox instance with `default_config`, `ha_ping` reports the release's version as
supported, an administrator, the integrations loaded, every tool ready, a time zone, and a
`compression_ratio` of at least 3. Repeat with the previous stable release; CI runs stable,
previous stable and beta.

## 4. The gate

```sh
pnpm lint && pnpm typecheck && pnpm test
```
