# Contract delta: `@domusops/sandbox` (US3)

This document amends [005 library-api.md](../../005-sandbox-harness/contracts/library-api.md),
[companion.md](../../005-sandbox-harness/contracts/companion.md) and
[cli.md](../../005-sandbox-harness/contracts/cli.md). Everything not listed here is unchanged.

## `attachSandbox(id)`

- **Instance started with `devices`** (any list, even empty): the returned handle's `devices`
  lists every device created so far, by any process, and `addDevices` behaves as it does on the
  starting process's handle.
- **Instance started without `devices`**: `addDevices` rejects with `virtual_unavailable`:

  ```text
  This instance was started without virtual-device support. Start it with `devices` (an empty list is enough) to add devices later.
  ```

- **Device list changed by another process**: if another process added devices since this
  handle last read or wrote the list, `addDevices` rejects with `virtual_unavailable`:

  ```text
  The device list of sandbox <id> changed in another process. Attach again to continue.
  ```

  Nothing is changed. Adding devices to one instance from two processes at once is unsupported.

## Time control

`sandbox.time.freeze(at)` and `sandbox.time.advance(seconds)` can reject with a new code:

| Code               | Message                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `time_unavailable` | `Time control is unavailable on Home Assistant <release>: <internal> is missing. Other operations still work.` |

- The instance stays usable, and every other method keeps working.
- The companion still loads and still tears the instance down at its deadline, or when its owner
  connection drops.
- Companion WebSocket command errors (`domusops_sandbox/time/*`) gain the error code
  `time_unavailable`.

## Smoke check

When the `time` step meets `time_unavailable`:

- The step's `outcome` is `failed` and its `message` is `time control unavailable on <release>`.
- The run's `outcome` is `failed`.
- The run-result format (`run-result.schema.json`) is unchanged.

## Cleanup and `list`

- Tied instances started by this version carry `io.domusops.sandbox.owner-machine` (data-model
  §2).
- `cleanup`, the reaper that runs before every start, and the "held" column of `list` all use
  the decision table in data-model §2.
- The removal reason strings are unchanged.

## Virtual-device integration

- The integration is fetched by commit and verified by content digest (data-model §4).
- On a mismatch, start rejects with `virtual_unavailable`:

  ```text
  The virtual-device integration (hass-virtual v0.9.4) is not available: the download failed its integrity check.
  ```

- Nothing from the download is installed or cached.
