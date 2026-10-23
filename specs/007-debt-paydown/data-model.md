# Data Model: debt paydown

Only the data this feature adds or changes. No `@domusops/schema` format changes (FR-032).

## 1. Machine identifier (sandbox, US3, R11)

| Field   | Type   | Rule                                                                                |
| ------- | ------ | ----------------------------------------------------------------------------------- |
| content | string | 32 lowercase hex characters (128 random bits), no newline required, trimmed on read |
| path    | file   | `$XDG_STATE_HOME/domusops/machine-id`, else `~/.local/state/domusops/machine-id`    |

- **Lifecycle**: created on first use with an exclusive create. If the create loses a race, the
  existing file is read instead. It is never rewritten.
- **Invalid content** (wrong length or not hex): treated as absent for the current run. The file
  is not overwritten, so a user's file is never clobbered.
- **Cannot be read or created**: the identifier is `null`, and new instances omit the label of §2.

## 2. Sandbox ownership labels (US3, R11)

Existing labels are unchanged. One label is added to tied instances:

| Label                               | Value                   | Present when                                   |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `io.domusops.sandbox.owner-machine` | machine identifier (§1) | `mode = tied` and the identifier is not `null` |

`parseLabels` returns `owner: { host, pid }`, with `machine` added only when the label is present
and well formed (32 lowercase hex characters). A malformed `owner-machine` value is read as absent,
which applies the legacy rule; it does not reject the container.

### Ownership decision (replaces `ownerMayBeAlive`)

The deadline rule is checked before this table and is unchanged.

| `owner.machine` | Local identifier | Same machine?                    | Owner process exited (`kill(pid, 0)` fails with `ESRCH`) | Decision                     |
| --------------- | ---------------- | -------------------------------- | -------------------------------------------------------- | ---------------------------- |
| present         | equal            | yes                              | yes                                                      | remove, "owner process gone" |
| present         | equal            | yes                              | no                                                       | keep                         |
| present         | different / null | no                               | n/a                                                      | keep (deadline only)         |
| absent          | any              | `owner.host === hostname()` only | yes                                                      | remove, "owner process gone" |
| absent          | any              | `owner.host === hostname()` only | no                                                       | keep                         |
| absent          | any              | host differs                     | n/a                                                      | keep (deadline only)         |

`list` uses the same decision for its "held" column.

## 3. Device state file (sandbox, US3, R10)

Path inside the container: `/config/.domusops_sandbox/devices.json`. It is written with the device
file on every successful `initialise` and `add`, and only by the sandbox.

```json
{
  "format": "domusops.sandbox-devices/0.1",
  "revision": 3,
  "entryId": "01J…",
  "specs": [
    { "kind": "binary_sensor", "name": "Hall motion", "initial": "off" }
  ],
  "devices": [
    {
      "kind": "binary_sensor",
      "name": "Hall motion",
      "entityId": "binary_sensor.hall_motion"
    }
  ]
}
```

| Field      | Rule                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| `format`   | exactly `domusops.sandbox-devices/0.1`; any other value means "no device support"      |
| `revision` | integer ≥ 1, incremented on every successful write                                     |
| `entryId`  | the integration's configuration entry ID; must still be loaded when the handle resumes |
| `specs`    | the validated `VirtualDeviceSpec`s, in creation order                                  |
| `devices`  | the `VirtualDevice`s created, in creation order                                        |

- **Resume** (`attachSandbox`):
  - If the file is missing, unparsable, or has the wrong `format`, the handle gets no device
    support.
  - If the file is valid but `entryId` is no longer loaded, the handle also gets no device
    support, and the message says so.
- **Add from a resumed handle**:
  - The handle re-reads `revision` first. If it differs from the revision the handle last read
    or wrote, the call fails with `virtual_unavailable` and changes nothing.
  - Otherwise it proceeds as `add` does today and writes `revision + 1`.
- The file lives in a dot directory that the sandbox creates inside the container after loading.
  The configuration packer skips dot directories of that name, so a loaded configuration cannot
  supply or overwrite it.

## 4. Virtual-device integration pin (sandbox, US3, R13)

| Constant                 | Value                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `VIRTUAL_VERSION`        | `0.9.4` (display only)                                                                  |
| `VIRTUAL_COMMIT`         | `a056ceaf73d4907e258ae055c3541342a3275400`                                              |
| `VIRTUAL_URL`            | `https://github.com/twrecked/hass-virtual/archive/${VIRTUAL_COMMIT}.tar.gz`             |
| `VIRTUAL_CONTENT_SHA256` | SHA-256 of the manifest below, computed once from the tarball verified by the 0.1.0 pin |

- **Manifest**:
  - One line per file under `custom_components/virtual/` in the archive: the path relative to
    that directory, using `/`, then `\0`, then the lowercase hex SHA-256 of the file, then `\n`.
  - Lines are sorted by path, comparing code points.
  - Directories, symbolic links and anything outside that directory are excluded. An archive
    that contains a link inside the directory is rejected.
- **Cache**: The extracted files live under
  `<cache>/hass-virtual-<commit>/custom_components/virtual/`. The manifest is recomputed on every
  read, and a mismatch deletes the cache entry and downloads again once.
- `VIRTUAL_SHA256`, the tarball hash of 0.1.0, is removed.

## 5. Sandbox error codes (US3)

`SandboxErrorCode` gains one value:

| Code               | Raised when                                                                                | Message names                                   |
| ------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `time_unavailable` | the companion's probe finds a Home Assistant internal that time control patches is missing | time control, the release, the missing internal |

`time_control_failed` keeps its meaning: time control exists but an operation failed.

## 6. MCP client command table (US5, R19)

```ts
const COMMANDS = {
  "auth/current_user": { params: null, budget: "command" },
  get_config: { params: null, budget: "command" },
  // …
  "logbook/get_events": {
    params: { required: ["start_time", "end_time"], optional: ["entity_ids"] },
    budget: "overall",
    timeoutHint: "Use a shorter window or fewer entities, then try again",
  },
  "trace/list": {
    params: { required: ["domain"], optional: [] },
    budget: "command",
  },
  "trace/get": {
    params: { required: ["domain", "item_id", "run_id"], optional: [] },
    budget: "command",
  },
  "trace/contexts": { params: null, budget: "command" },
} as const satisfies Record<string, CommandSpec>;
```

`ALLOWED_COMMANDS` is `Object.keys(COMMANDS)`, in the same order as today, and stays exported.

## 7. `ToolError` (US5, R20)

The class gains `readonly haCode: string | null`. It is set only by `HaClient` when an instance
answers a command with `success: false` and a string `error.code`, and is `null` everywhere else.
`toToolText` ignores it, so the text agents see is unchanged.

## 8. Bootstrap record use (US4, R17, R18)

- No new data. add-key and remove-key read the existing generation record
  (`domusops.bootstrap/0.1`) and use `elementState` for the `sops-config` element.
- `init` fills the existing `key: KeyInfo | null` field of `domusops.bootstrap-summary/0.1`
  whenever it resolves a key, now also when recipients already exist.
