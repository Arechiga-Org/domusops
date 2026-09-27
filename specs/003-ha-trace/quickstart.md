# Quickstart: validating ha_trace

Runnable scenarios that prove the feature end to end. The format and error kinds are defined in
[data-model.md](./data-model.md) and [contracts/ha_trace.md](./contracts/ha_trace.md); they are not
repeated here.

## Prerequisites

- Node 22 LTS and pnpm 9.15 (repository root, `pnpm install` done).
- For scenarios 3 and 4: a reachable Home Assistant instance (2025.1.0 or later) with at least
  one automation that has run, and a long-lived access token of an **administrator** user.

## 1. Automated suite (SC-001 to SC-007)

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green. The suite covers, against fixtures and the fake instance:

| Check                                                                                                                                                                          | Proves          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `standard` ratio ≥ 3 on the reference fixture                                                                                                                                  | SC-001, FR-019  |
| `expandTrace(standard)` equals the redacted extended records, for selectors, window, run, and context selection                                                                | SC-002, FR-009  |
| No six-character fragment of any planted secret, coordinate, or e-mail address, at both detail levels                                                                          | SC-003          |
| `summary` of 500 runs over 100 items, and `standard` of one item, each under 5 s                                                                                               | SC-004          |
| Each shared failure mode, plus `window_invalid`, `selector_invalid`, `selection_invalid`, `run_not_found`, `traces_unavailable`, `too_large` at both levels: own kind, no runs | SC-005          |
| The fake instance receives only allowlisted read commands, for every parameter combination; no `trace/debug/*` command                                                         | SC-006          |
| Every fixture run's context has the last 16 characters of its logbook cause; every child reference names the linked run                                                        | SC-007          |
| `no_match`, `no_stored_runs`, `none_in_window`, and `untraceable` are reported distinctly                                                                                      | FR-004          |
| Not-triggered, running, and error traces round-trip with their outcomes                                                                                                        | FR-008, FR-018  |
| `ha_snapshot` and `ha_logbook_query` are still advertised and their tests pass unchanged                                                                                       | FR-001          |
| Identical input gives byte-identical output                                                                                                                                    | data-model §3.4 |

## 2. Tool listing

```bash
pnpm build
npx @modelcontextprotocol/inspector --cli node packages/mcp/dist/cli.js --method tools/list
```

Expected: three tools, `ha_snapshot`, `ha_logbook_query`, and `ha_trace`, the last with the input
schema and annotations of [ha_trace.tool.json](./contracts/ha_trace.tool.json).

## 3. Live instance (SC-008)

```bash
pnpm build
npx @modelcontextprotocol/inspector --cli \
  -e DOMUSOPS_HA_URL=http://homeassistant.local:8123 \
  -e DOMUSOPS_HA_TOKEN="$DOMUSOPS_HA_TOKEN" \
  node packages/mcp/dist/cli.js \
  --method tools/call --tool-name ha_trace --tool-arg detail=summary
```

Expected: a `domusops.trace/0.1` document with `"detail":"summary"`, one row per stored run, and a
`compression_ratio`. Then run:

1. `--tool-arg 'entities=["automation.<one of yours>"]'` (that automation's runs, step by step).
2. `--tool-arg run=<a run ID from step 1>` (exactly that run).
3. `--tool-arg context=<the context of an event caused by that automation, from ha_logbook_query>`
   (the same run, plus any script run in its context).
4. No arguments (every run at `standard`): expected `too_large` on an instance with more than
   about 100 KB of encoded traces, with the run count.

Record, in the pull request description only: `ha_version`, the run count (from `summary`), the
`standard` ratio of step 1 and of all runs (raising `DOMUSOPS_TRACE_MAX_BYTES` for the latter),
and wall-clock times. Never paste response content: traces carry configurations, messages, and
household routines. A live ratio far below the fixture's is a calibration defect of the fixture
([research R16](./research.md#r16-reference-fixtures)).

## 4. Failure smoke test

With the command of scenario 3:

| Change                                            | Expected error kind |
| ------------------------------------------------- | ------------------- |
| Remove `-e DOMUSOPS_HA_TOKEN=…`                   | `config_missing`    |
| Use a token of a non-administrator user           | `not_admin`         |
| `--tool-arg start=2026-13-01`                     | `window_invalid`    |
| `--tool-arg 'entities=["Automation.X"]'`          | `selector_invalid`  |
| `--tool-arg run=<run ID> --tool-arg start=…`      | `selection_invalid` |
| `--tool-arg run=00000000000000000000000000000000` | `run_not_found`     |
| `-e DOMUSOPS_TRACE_MAX_BYTES=1000`                | `too_large`         |
| `-e DOMUSOPS_TRACE_MAX_BYTES=zero`                | `config_invalid`    |

Each returns `isError: true`, a message with a next step, no runs, and no token in the text.
`traces_unavailable` is covered by the automated suite only (it needs an instance without the
automation and script integrations).
