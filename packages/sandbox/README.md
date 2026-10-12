# @domusops/sandbox

Ephemeral test harness for Home Assistant. It starts a throwaway instance in a container at a
chosen release (current stable, previous stable, or current beta), ready with a known admin token
and no manual onboarding, and tears it down cleanly, even after a crash.

- **Docker is the only hard runtime dependency.** Podman works through `DOMUSOPS_CONTAINER=podman`.
- **It never touches a real instance.** The library accepts no URL and no token. Every operation
  works on an instance this package created and labelled itself.
- Home Assistant is a trademark of its owner; this project is independent and is not affiliated
  with or endorsed by it.

This is part 1 of 2. It provides the instance, the virtual devices, state and time control, and
the connection details. The scenario and assertion DSL that drives them is a later feature.

## Requirements

- Node.js 22 or newer.
- Docker (or Podman). The official Home Assistant image is pulled on first use. With both
  installed, Docker is used; set `DOMUSOPS_CONTAINER=podman` to choose Podman.

## Library

```ts
import { startSandbox } from "@domusops/sandbox";

const sandbox = await startSandbox({
  channel: "stable", // "stable" | "previous-stable" | "beta", or `release: "2026.10.0"`
  config: { dir: "./my-ha-config" }, // read-only; the directory is copied, never written
  devices: [{ kind: "binary_sensor", name: "Hall motion", class: "motion" }],
});

try {
  await sandbox.setState("sensor.outdoor_temp", "21.5", {
    unit_of_measurement: "°C",
  });
  await sandbox.time.freeze("2026-03-01T06:59:55Z");
  await sandbox.time.advance(10);
  console.log(await sandbox.getState("sensor.outdoor_temp"));
} finally {
  await sandbox.stop(); // idempotent
}
```

| Call                      | Does                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `startSandbox(options)`   | Starts an instance and resolves when it is ready                                                  |
| `resolveChannel(channel)` | Names the concrete release a channel points to                                                    |
| `attachSandbox(id)`       | Re-attaches to a background instance                                                              |
| `listSandboxes()`         | Lists the instances this package created                                                          |
| `stopSandbox(id)`         | Stops one of them; idempotent                                                                     |
| `cleanup()`               | Removes instances whose owner is gone or whose lifetime ran out                                   |
| `runSmoke({ channel })`   | Runs the eight-step smoke check (or `{ release }`) and returns a result; never throws on failures |

On a handle: `setState`, `getState`, `callService`, `addDevices`, `time.freeze|advance|resume|now`,
`connection()`, `mcpEnv()`, `detach()` and `stop()`. The full contract is in
[`specs/005-sandbox-harness/contracts/library-api.md`](../../specs/005-sandbox-harness/contracts/library-api.md).

Virtual devices reuse a community integration; the kinds are `switch`, `binary_sensor`, `sensor`,
`light`, `lock`, `fan`, `cover`, `valve` and `device_tracker`. Device names must be unique across
all kinds, so a light and a sensor cannot both be called "Hall". That integration is downloaded once,
pinned to an exact version and verified against a SHA-256 before use, and cached under
`XDG_CACHE_HOME`.

### Using it with `@domusops/mcp`

`sandbox.mcpEnv()` returns exactly `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`, the two variables
the MCP server reads. `sandbox.connection()` returns `{ url, wsUrl, token }` for a WebSocket
client.

## CLI

```sh
domusops-sandbox start --channel stable --config ./my-ha-config -- pnpm test
domusops-sandbox start --background --device switch:Porch --device binary_sensor:Door:door
domusops-sandbox list
set -a; eval "$(domusops-sandbox env <id>)"; set +a   # exports DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN
domusops-sandbox stop <id>            # or: stop --all [--force]
domusops-sandbox cleanup
domusops-sandbox resolve beta
domusops-sandbox smoke --channel stable --result smoke.json
```

`start -- <command>` runs the command with the connection variables set, stops the instance when
the command exits, and exits with the command's own code. `resolve`, `start`, `list` and `cleanup` accept `--json`;
`smoke` writes its JSON result with `--result <file>`.

| Exit code | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| 0         | Success; for `smoke`, `passed` or `no-beta-in-progress`                                                      |
| 1         | Failure; for `smoke`, `failed`                                                                               |
| 2         | Usage error                                                                                                  |
| 3         | Could not run: no container runtime, channel not resolvable, image unavailable; for `smoke`, `could-not-run` |

These codes are the CLI's own. `start -- <command>` exits with the command's code instead, which
can be any value, so check the command's meaning of it, not this table. `resolve beta` with no
beta in progress prints that and exits 0. `smoke` reads the CI run URL from the GitHub Actions
environment when there is one.

The CLI never reads `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` from its own environment. The full
contract is in [`specs/005-sandbox-harness/contracts/cli.md`](../../specs/005-sandbox-harness/contracts/cli.md).

## Supported Home Assistant versions

The table in the [repository README](../../README.md#supported-home-assistant-versions) is
generated from the results of the CI matrix (`stable`, `previous-stable`, `beta`) and is never
edited by hand. The result format is documented in
[`contracts/run-result.md`](../../specs/005-sandbox-harness/contracts/run-result.md).

## Security notes

- The admin token exists only in memory and in the container. It is hidden from `toJSON`,
  `inspect` and `toString` of a handle, and it never appears in error messages, step messages or
  result files. `domusops-sandbox env` is the only command that prints it.
- The configuration directory is mounted from a copy; nothing writes to the directory you pass.
- The instance is published on the loopback interface only.
- Instances are labelled with their owner process and a deadline (default 120 minutes, at most
  1440). Run `domusops-sandbox cleanup` to remove any that outlived their owner.
- Time control patches Home Assistant's own time helpers, so it depends on internals that can
  change between releases; the smoke check exercises it on every channel for that reason.

## License

Apache-2.0.
