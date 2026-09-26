# Quickstart: validating ha_snapshot

Runnable scenarios that prove the feature end to end. Formats and error kinds are defined in
[data-model.md](./data-model.md) and [contracts/ha_snapshot.md](./contracts/ha_snapshot.md); they
are not repeated here.

## Prerequisites

- Node 22 LTS and pnpm 9.15 (repository root, `pnpm install` done).
- For scenario 2: Docker.
- For scenario 3: a reachable Home Assistant instance (version 2025.1.0 or later) and a
  long-lived access token of an **administrator** user (Profile → Security → Long-lived access
  tokens).

## 1. Automated suite (SC-001 to SC-006)

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green. The suite covers, against fixtures and a fake instance:

| Check                                                                                                                                                       | Proves                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `standard` ratio ≥ 5 on the 500-entity reference fixture                                                                                                    | SC-001, FR-023         |
| `expand(standard) == project(full)`; every entity ID present                                                                                                | SC-002, FR-008, FR-009 |
| No six-character fragment of any planted secret, at every detail level                                                                                      | SC-003                 |
| 1,000-entity fixture served by the fake instance completes in under 5 s                                                                                     | SC-004                 |
| Missing config, bad URL, unreachable, timeout, old version, invalid auth, non-admin, single failed retrieval: each gives its own error kind and no snapshot | SC-005                 |
| The fake instance receives only allowlisted read commands, for every `detail` value                                                                         | SC-006                 |
| Identical input gives byte-identical output                                                                                                                 | data-model §3.3        |

The same suite runs in the `verify` CI job on every pull request.

## 2. Clean-machine start (SC-007)

Build and pack both packages, then start the server in a container that has only Node 22:

```bash
pnpm build
mkdir -p /tmp/domusops-pkgs
# pnpm@9.15's `pack` does not support `--filter` directly (it errors with
# "Unknown option: 'recursive'"); run it through `exec` in each package instead.
pnpm --filter @domusops/schema exec pnpm pack --pack-destination /tmp/domusops-pkgs
pnpm --filter @domusops/mcp exec pnpm pack --pack-destination /tmp/domusops-pkgs

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"quickstart","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| docker run --rm -i -v /tmp/domusops-pkgs:/pkgs node:22-slim sh -c \
  'set -- /pkgs/domusops-schema-*.tgz /pkgs/domusops-mcp-*.tgz
   npx --yes --package="$1" --package="$2" domusops-mcp'
```

Expected: the response to `id: 2` lists exactly one tool, `ha_snapshot`, with the input schema and
annotations from [ha_snapshot.tool.json](./contracts/ha_snapshot.tool.json). Nothing besides Node
is installed in the image.

The literal `npx @domusops/mcp` form additionally requires the packages to be published to npm.
That is a release step outside this feature ([research R10](./research.md#r10-distribution-npx-domusopsmcp)).

## 3. Live instance (SC-008)

Run the built server against the maintainer's instance with the MCP Inspector CLI (fetched on
demand; it is not a project dependency):

```bash
pnpm build
npx @modelcontextprotocol/inspector --cli \
  -e DOMUSOPS_HA_URL=http://homeassistant.local:8123 \
  -e DOMUSOPS_HA_TOKEN="$DOMUSOPS_HA_TOKEN" \
  node packages/mcp/dist/cli.js \
  --method tools/call --tool-name ha_snapshot --tool-arg detail=standard
```

Expected: a single text block holding a `domusops.snapshot/0.1` document with
`"detail":"standard"` and a `compression_ratio`. Repeat with `detail=summary` and `detail=full`.

Record, in the pull request description only: the instance's `ha_version`, its entity count (from
`summary`), the `standard` compression ratio, and the wall-clock time. Never paste snapshot
content: even redacted, it describes a private home. A ratio below 5 blocks release (see
[research R9](./research.md#r9-test-strategy-and-fixtures)).

## 4. Failure smoke test

With the same command as scenario 3:

| Change                                   | Expected error kind |
| ---------------------------------------- | ------------------- |
| Remove `-e DOMUSOPS_HA_TOKEN=…`          | `config_missing`    |
| Use a revoked or random token            | `auth_invalid`      |
| Point `DOMUSOPS_HA_URL` at a closed port | `unreachable`       |
| Use a token of a non-administrator user  | `not_admin`         |

Each returns `isError: true`, a message with a next step, no snapshot, and no token in the text.
