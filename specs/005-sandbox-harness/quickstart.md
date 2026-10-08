# Quickstart: validating the sandbox harness

Runnable scenarios that prove the feature end to end. Interfaces: [cli.md](./contracts/cli.md),
[library-api.md](./contracts/library-api.md). Every scenario runs against throwaway instances
only; none needs or touches a real instance.

## Prerequisites

- Node 22+, pnpm, Docker (or Podman with `DOMUSOPS_CONTAINER=podman`) with its daemon running.
- Network access for the first run (release index, image pull, device integration download).
- `pnpm install && pnpm --filter @domusops/sandbox build`; below, `sbx` stands for
  `node packages/sandbox/dist/cli.js`.
- `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN` may stay set in the shell: the sandbox ignores them
  (scenario 9 proves it).

## 1. Resolve the channels (US1, FR-002)

`sbx resolve stable`, `sbx resolve previous-stable`, `sbx resolve beta`.
Expected: three concrete releases, previous stable from the month before stable, or "no beta in
progress" for beta.

## 2. Start, use, and tear down a tied instance (US1, US2, US5)

`sbx start -- sh -c 'curl -sf -H "Authorization: Bearer $DOMUSOPS_HA_TOKEN" "$DOMUSOPS_HA_URL/api/config" >/dev/null && echo OK'`
Expected: `OK`, exit code 0, then `docker ps -a --filter label=io.domusops.sandbox=1` and
`docker volume ls --filter dangling=true` show nothing from this run. Under 3 minutes with the
image present (SC-001).

## 3. The smoke check on all channels (US6, FR-028)

`sbx smoke --channel stable --result /tmp/r-stable.json` (repeat for `previous-stable`, `beta`).
Expected: eight passed steps per channel, or `no-beta-in-progress` with exit 0 for beta; each
result validates against `packages/sandbox/schema/run-result.schema.json`.

## 4. Load a repository's configuration (US3, SC-003)

Take a bootstrapped repository (or `packages/sandbox/fixtures/reference-config`), record
`find <dir> -type f -exec shasum {} + | sort > before`, run
`sbx start --config <dir> -- true`, record `after`, and `diff before after`.
Expected: no difference; the start summary lists excluded patterns and
`secrets: placeholders`. Repeat with a directory containing a `!secret` reference and no
plaintext file, and with one whose `configuration.yaml` is invalid: the latter ends with
`config_invalid`, the validation errors, and no container left.

## 5. Virtual devices, states, and time (US4, SC-004)

```sh
sbx start --background --device binary_sensor:Hall:motion --device light:Hall
eval "$(sbx env <id>)"
```

Then, with the library (a short script, or the container test `time.container.test.ts`): set
`binary_sensor.hall` to `on`, read it back; freeze at 02:59:50, advance 20 s; the reference
automation's light is `on` and the automation ran once. Under 10 s of real time. Finish with
`sbx stop <id>`.

## 6. Existing tools against the sandbox (US5, SC-005)

With the `env` output above, start `@domusops/mcp` and call `ha_snapshot`; open a WebSocket
client and run `get_states`. Expected: both work with no change to either tool.

## 7. Crash safety (US2, SC-002)

`sbx start -- sleep 600 &`, wait for ready, `kill -9 <pid>`. Expected: within 25 seconds the
container is gone without running anything else. Then start one in the background with
`--max-lifetime 1` and wait 70 seconds: gone. Then `sbx cleanup` reports nothing to remove.

## 8. Concurrency (FR-020, SC-008)

Start two `sbx smoke` runs at once. Expected: both pass, on different ports, and neither tears
down the other.

## 9. Never a real instance (FR-019, SC-007)

`sbx stop not-a-sandbox`, `sbx env 000000000000`: both `not_a_sandbox`, nothing changes. Export a
real-looking `DOMUSOPS_HA_URL=http://192.0.2.1:8123` and run `sbx smoke`: no connection is ever
attempted to that address (the MCP step's environment is built from scratch).

## 10. The README table (US6, FR-024)

`pnpm sandbox:table --run <id of a sandbox-matrix run on main>`, then `pnpm test`.
Expected: `docs/supported-versions.json` and the README block are rewritten with links to that
run; tests pass. Edit one cell of the README table by hand: `readme-table.test.ts` fails.
