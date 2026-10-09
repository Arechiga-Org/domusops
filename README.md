# DomusOps

GitOps toolkit for Home Assistant.

> Not affiliated with, endorsed by, or a product of Home Assistant / Nabu Casa.
> "Home Assistant" is a registered trademark of its respective owner.

## Status

Pre-alpha. First feature (`ha_snapshot`, an MCP tool that returns a compressed
inventory of a live Home Assistant instance) is in progress. See
`specs/ha-snapshot/` and `CLAUDE.md`.

## Packages

| Package                                       | Status                                        |
| --------------------------------------------- | --------------------------------------------- |
| [`@domusops/schema`](./packages/schema)       | scaffolded                                    |
| [`@domusops/mcp`](./packages/mcp)             | `ha_snapshot`, `ha_logbook_query`, `ha_trace` |
| [`@domusops/bootstrap`](./packages/bootstrap) | CLI behind the `ha-bootstrap` skill           |
| [`@domusops/sandbox`](./packages/sandbox)     | ephemeral Home Assistant test harness         |

## Skills

| Skill                                   | Does                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ha-bootstrap`](./skills/ha-bootstrap) | Brings an existing Home Assistant configuration directory to a GitOps baseline: a repository, an exclusion list for runtime files, `packages/` loading, SOPS/age encryption of `secrets.yaml`, pre-commit checks, and a GitHub Actions workflow that runs the instance's own configuration validator. Free. |

## Supported Home Assistant versions

The table is generated from the results of CI runs of `@domusops/sandbox` (constitution §8) and
is never edited by hand: `pnpm sandbox:table --run <run id>` rewrites it from a run's results.
Each date links to the run that produced the row.

<!-- domusops:supported-versions:start -->

| Channel         | Release | Result          | Checked |
| --------------- | ------- | --------------- | ------- |
| Current stable  | —       | Not yet checked | —       |
| Previous stable | —       | Not yet checked | —       |
| Current beta    | —       | Not yet checked | —       |

<!-- domusops:supported-versions:end -->

## Development

```bash
corepack enable
pnpm install
pnpm build
pnpm test
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
