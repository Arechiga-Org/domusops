# Data Model: sandbox harness

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## 1. Release channel

| Value             | Resolves to (research R3)                                                  |
| ----------------- | -------------------------------------------------------------------------- |
| `stable`          | Newest release without a suffix                                            |
| `previous-stable` | Newest release without a suffix whose `YYYY.M` is lower than `stable`'s    |
| `beta`            | Newest `bN` release, or "no beta in progress" when not newer than `stable` |

`ResolvedRelease`: `{ channel, release: string /* "2026.10.1" | "2026.11.0b2" */, beta: boolean }`.
An exact `release` given by the caller produces `{ channel: "exact", release, beta }`.

Validation: `release` matches `^\d{4}\.\d{1,2}\.\d+(b\d+)?$`.

## 2. Sandbox instance

| Field      | Type                     | Rule                                                               |
| ---------- | ------------------------ | ------------------------------------------------------------------ |
| `id`       | string                   | 12 lowercase hex characters, random; unique per instance           |
| `release`  | `ResolvedRelease`        | Fixed at start                                                     |
| `mode`     | `"tied" \| "background"` | Default `tied` (FR-029)                                            |
| `deadline` | ISO 8601 UTC             | Start + `maxLifetime` (default 2 h; 1 min ≤ value ≤ 24 h) (FR-030) |
| `url`      | string                   | Always `http://127.0.0.1:<port>`; derived, never supplied          |
| `token`    | string                   | Long-lived, per instance; never logged (FR-005)                    |
| `owner`    | `{ host, pid }`          | Tied mode only                                                     |
| `config`   | `ConfigSummary`          | What was loaded (§3)                                               |
| `devices`  | `VirtualDevice[]`        | §4                                                                 |

### Container labels (the source of truth for ownership, FR-018)

`io.domusops.sandbox=1`, `io.domusops.sandbox.id`, `io.domusops.sandbox.mode`,
`io.domusops.sandbox.deadline`, `io.domusops.sandbox.owner-host`,
`io.domusops.sandbox.owner-pid`, `io.domusops.sandbox.release`. Container name
`domusops-sandbox-<id>`.

### Lifecycle

```text
resolving → pulling → creating → starting → onboarding → validating → ready → stopping → gone
     │          │          │          │           │            │          │
     └──────────┴──────────┴──────────┴───────────┴────────────┴──────────┴──→ failed → gone
```

- Every state after `creating` has a container; `failed` always passes through teardown, so no
  path ends with a container (FR-003, FR-009, FR-016).
- `resolving` and `pulling` failures are "could not run" in a smoke result; later failures are
  "failed".
- From `ready`, an instance leaves by: explicit stop; end of the owning invocation (tied); owner
  connection closed for 15 s (tied, research R6); deadline reached; reaped by a later invocation
  or `cleanup`.

### Reaper decision (research R6), for each labelled container

| Condition                                                  | Action                                |
| ---------------------------------------------------------- | ------------------------------------- |
| `deadline` passed                                          | remove                                |
| `mode=tied`, `owner-host` = this host, owner pid not alive | remove                                |
| `mode=tied`, `owner-host` ≠ this host                      | keep (cannot judge; deadline applies) |
| otherwise                                                  | keep                                  |

Containers without `io.domusops.sandbox=1` are never listed, inspected, or removed.

## 3. Configuration source and `ConfigSummary`

Input: `{ dir: string, secretsFile?: string }`. `dir` must contain `configuration.yaml`.

`ConfigSummary`: `{ source: string, files: number, excluded: string[] /* patterns that matched */,
skippedLinks: string[], secrets: "placeholders" | "caller-file" | "none-referenced",
placeholderKeys: string[], userVirtualIntegration: boolean }`.

Rules: research R5 (exclusions, links), R8 (secrets). The source is opened read-only.

## 4. Virtual device

| Field      | Type                                                                                            | Rule                                        |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `name`     | string                                                                                          | 1–64 characters; unique within the instance |
| `kind`     | `switch \| binary_sensor \| sensor \| light \| lock \| fan \| cover \| valve \| device_tracker` | Anything else: `unsupported_device_kind`    |
| `class`    | string, optional                                                                                | Passed through as the integration's `class` |
| `initial`  | string, optional                                                                                | Passed through as `initial_value`           |
| `entityId` | string                                                                                          | Read back from the instance after creation  |

## 5. Run result (`domusops.sandbox-result/0.1`)

See [contracts/run-result.md](./contracts/run-result.md). Outcome is one of `passed`, `failed`,
`could-not-run`, `no-beta-in-progress` (FR-023). `failedStep` is present exactly when outcome is
`failed` or `could-not-run`, and is one of the smoke steps (research R12) or `resolve`/`pull`.

## 6. Supported-versions document (`docs/supported-versions.json`)

`{ format: "domusops.supported-versions/0.1", run: { url, id, finishedAt }, rows: RunResult[] }`,
exactly one row per channel, in the order stable, previous-stable, beta. The README table is a
pure function of this document.

## 7. Errors

Every library error is a `SandboxError` with a stable `code`:

| Code                      | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `runtime_missing`         | No container runtime on `PATH`, or its daemon is not running  |
| `channel_unresolved`      | Release index unreachable, or no release for the channel      |
| `no_beta_in_progress`     | `beta` requested while none is in progress                    |
| `image_unavailable`       | Pull failed and the image is not present locally              |
| `not_ready`               | Readiness limit passed; carries the last 50 log lines         |
| `config_invalid`          | `check_config` invalid, or recovery/safe mode; carries errors |
| `config_dir_invalid`      | No `configuration.yaml` in the given directory                |
| `virtual_unavailable`     | The device integration failed to load on this release         |
| `unsupported_device_kind` | Kind outside §4                                               |
| `not_a_sandbox`           | Id not found among labelled containers, or `info` mismatch    |
| `instance_gone`           | The instance was torn down                                    |
| `time_control_failed`     | The companion rejected or failed a time command               |
