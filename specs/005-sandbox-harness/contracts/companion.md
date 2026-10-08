# Contract: companion integration (`domusops_sandbox`)

Shipped in the package under `companion/custom_components/domusops_sandbox/`; installed only into
sandbox instances (research R6). Not a public interface: the library is its only client. Every
command requires an administrator connection.

## Configuration

`configuration.yaml`: `domusops_sandbox:` (no options; the packer appends it). Container
environment: `DOMUSOPS_SANDBOX_ID`, `DOMUSOPS_SANDBOX_MODE` (`tied|background`),
`DOMUSOPS_SANDBOX_DEADLINE` (ISO 8601 UTC). Manifest `dependencies`: `http`, `api`,
`websocket_api`, `onboarding`, `auth`, `config`.

## WebSocket commands

| Type                            | Request fields            | Result                                     |
| ------------------------------- | ------------------------- | ------------------------------------------ |
| `domusops_sandbox/info`         | none                      | `{ id, mode, deadline, frozen }`           |
| `domusops_sandbox/attach`       | none                      | `{}`; this connection becomes the owner    |
| `domusops_sandbox/detach`       | none                      | `{}`; the owner may now close without stop |
| `domusops_sandbox/time/freeze`  | `at` (ISO 8601)           | `{ now }`                                  |
| `domusops_sandbox/time/advance` | `seconds` (> 0, ≤ 7 days) | `{ now, fired }` (timers run)              |
| `domusops_sandbox/time/resume`  | none                      | `{ now }`                                  |
| `domusops_sandbox/time/now`     | none                      | `{ now, frozen }`                          |

`advance` without a prior `freeze` freezes at the current time first. Errors use the WebSocket
API's error shape with codes `not_frozen`, `invalid_time`, `time_control_failed`.

## Behaviour

- At `DOMUSOPS_SANDBOX_DEADLINE` (checked against real time, never the controlled clock), the
  instance stops with exit code 0.
- In `tied` mode, if the owner connection closes without `detach`, the instance stops after 15
  seconds unless a new connection `attach`es within that time. If no connection has attached
  within 300 seconds of startup, it stops.
- The companion never opens network connections and never reads files outside `/config`.
