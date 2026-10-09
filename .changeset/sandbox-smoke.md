---
"@domusops/sandbox": minor
---

Add the `smoke` command and the result format behind the supported-versions table. `domusops-sandbox smoke [--channel stable|previous-stable|beta | --release <release>] [--result <file>]` starts a sandbox on the reference configuration and runs eight steps (start, load-config, virtual-device, set-state, time, mcp-snapshot, websocket, teardown), records the first failure, always tears down, and writes a `domusops.sandbox-result/0.1` file. Exit codes: 0 passed or no beta in progress, 1 failed, 2 usage error, 3 could not run. The result schema ships in `schema/run-result.schema.json`. The README table is generated from `docs/supported-versions.json` by `pnpm sandbox:table` and checked by a test, and CI runs the smoke check and the container tests on each channel.
