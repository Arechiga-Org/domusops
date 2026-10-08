# Contract: CLI (`domusops-sandbox`)

A thin layer over the [library API](./library-api.md) (FR-032): parse, call, format. Human output
by default; `--json` prints one JSON document on stdout. Progress goes to stderr.

| Command                                                | Library call                | Output                                                                                                                 |
| ------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `start [opts] -- <command> [args…]`                    | `startSandbox` (tied)       | Runs `<command>` with `DOMUSOPS_HA_URL`/`DOMUSOPS_HA_TOKEN` set; stops the instance when it exits; exits with its code |
| `start --background [opts]`                            | `startSandbox` (background) | Id, release, URL, deadline. Never the token                                                                            |
| `env <id>`                                             | `attachSandbox` + `mcpEnv`  | `DOMUSOPS_HA_URL=…` and `DOMUSOPS_HA_TOKEN=…` lines, for `eval` or a `.env` file; the only command that prints a token |
| `list`                                                 | `listSandboxes`             | Id, mode, release, URL, deadline, owner                                                                                |
| `stop <id>…` / `stop --all [--force]`                  | `stopSandbox`               | Ids stopped. `--all` keeps tied instances whose owner may still be running, and says so; `--force` stops those too     |
| `cleanup`                                              | `cleanup`                   | Ids removed and why                                                                                                    |
| `smoke [--channel c \| --release r] [--result <file>]` | `runSmoke`                  | Step table; writes the result JSON to `<file>`                                                                         |
| `resolve <channel>`                                    | `resolveChannel`            | The concrete release, or "no beta in progress"                                                                         |

Start options: `--channel stable|previous-stable|beta`, `--release <x.y.z>`, `--config <dir>`,
`--secrets-file <file>`, `--device <kind>:<name>[:<class>]` (repeatable),
`--max-lifetime <minutes>`, `--readiness-timeout <seconds>`.

Repository script (not part of the published CLI): `pnpm sandbox:table --run <id>` (research R13).

## Exit codes

| Code | Meaning                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 0    | Success; for `smoke`, outcome `passed` or `no-beta-in-progress`                                                   |
| 1    | Failure; for `smoke`, outcome `failed`                                                                            |
| 2    | Usage error                                                                                                       |
| 3    | Could not run: `runtime_missing`, `channel_unresolved`, `image_unavailable`; for `smoke`, outcome `could-not-run` |
| _n_  | `start -- <command>`: the command's own exit code                                                                 |

## Environment

`DOMUSOPS_CONTAINER=docker|podman` (as `bootstrap`). `XDG_CACHE_HOME` (device integration cache).
The CLI ignores `DOMUSOPS_HA_URL`/`DOMUSOPS_HA_TOKEN` from its own environment entirely
(FR-019).
