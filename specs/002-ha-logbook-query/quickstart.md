# Quickstart: validating ha_logbook_query

Runnable scenarios that prove the feature end to end. The format and error kinds are defined in
[data-model.md](./data-model.md) and [contracts/ha_logbook_query.md](./contracts/ha_logbook_query.md);
they are not repeated here.

## Prerequisites

- Node 22 LTS and pnpm 9.15 (repository root, `pnpm install` done).
- For scenarios 3 and 4: a reachable Home Assistant instance (2025.1.0 or later) with the
  `logbook` integration loaded (it is part of `default_config`), and a long-lived access token of
  an **administrator** user.

## 1. Automated suite (SC-001 to SC-006)

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green. The suite covers, against fixtures and the fake instance:

| Check                                                                                                                        | Proves          |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `standard` ratio ≥ 5 on the 24-hour reference fixture                                                                        | SC-001, FR-018  |
| `expandLogbook(standard) == projectLogbook(rows)`, in order, for every selector mode                                         | SC-002, FR-007  |
| No six-character fragment of any planted secret, coordinate, or e-mail address, at both detail levels                        | SC-003          |
| 1,000 entities and 10,000 events in 24 hours complete in under 5 s                                                           | SC-004          |
| Each shared failure mode, plus `window_invalid`, `selector_invalid`, `history_unavailable`, `too_large`: own kind, no events | SC-005          |
| The fake instance receives only allowlisted read commands, for every parameter combination                                   | SC-006          |
| `ha_snapshot` is still advertised and its tests pass unchanged                                                               | FR-001          |
| Identical input gives byte-identical output                                                                                  | data-model §3.4 |

## 2. Tool listing

```bash
pnpm build
npx @modelcontextprotocol/inspector --cli node packages/mcp/dist/cli.js --method tools/list
```

Expected: two tools, `ha_snapshot` and `ha_logbook_query`, the latter with the input schema and
annotations of [ha_logbook_query.tool.json](./contracts/ha_logbook_query.tool.json).

## 3. Live instance (SC-007)

```bash
pnpm build
npx @modelcontextprotocol/inspector --cli \
  -e DOMUSOPS_HA_URL=http://homeassistant.local:8123 \
  -e DOMUSOPS_HA_TOKEN="$DOMUSOPS_HA_TOKEN" \
  node packages/mcp/dist/cli.js \
  --method tools/call --tool-name ha_logbook_query
```

Expected: a single text block holding a `domusops.logbook/0.1` document with `"detail":"standard"`,
the last 24 hours, and a `compression_ratio`. Then run:

1. `--tool-arg detail=summary` (counts only).
2. `--tool-arg 'entities=["automation.<one of yours>","light.*"]'` (one automation's run and
   the lights it drives).
3. `--tool-arg start=<a date 7 days ago>` without `entities`: expected `too_large` on a busy
   instance, with the event count.

Record, in the pull request description only: `ha_version`, the event count of the 24-hour window
(from `summary`), the `standard` compression ratio of the 24-hour and the single-automation
queries, and their wall-clock times. Never paste response content: even redacted, a logbook
describes a household's daily routine. A 24-hour ratio below 5 blocks release
([research R7](./research.md#r7-compression-floor-and-reference-fixture)).

## 4. Failure smoke test

With the same command as scenario 3:

| Change                                    | Expected error kind |
| ----------------------------------------- | ------------------- |
| Remove `-e DOMUSOPS_HA_TOKEN=…`           | `config_missing`    |
| Use a token of a non-administrator user   | `not_admin`         |
| `--tool-arg start=2026-13-01`             | `window_invalid`    |
| `--tool-arg 'entities=["Light.Hallway"]'` | `selector_invalid`  |
| `-e DOMUSOPS_LOGBOOK_MAX_BYTES=1000`      | `too_large`         |
| `-e DOMUSOPS_LOGBOOK_MAX_BYTES=zero`      | `config_invalid`    |

Each returns `isError: true`, a message with a next step, no events, and no token in the text.
`history_unavailable` is covered by the automated suite only (it needs an instance without the
logbook).
