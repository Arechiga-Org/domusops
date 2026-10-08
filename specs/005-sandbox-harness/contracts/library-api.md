# Contract: library API (`@domusops/sandbox`)

The primary interface (FR-031). ESM, Node 22+. Everything below is exported from the package
root. Types are named after [data-model.md](../data-model.md).

```ts
resolveChannel(channel: "stable" | "previous-stable" | "beta"): Promise<ResolvedRelease>
// throws channel_unresolved, no_beta_in_progress

startSandbox(options: {
  channel?: "stable" | "previous-stable" | "beta";   // default "stable"
  release?: string;                                   // exact; excludes `channel`
  config?: { dir: string; secretsFile?: string };     // default: empty configuration
  devices?: VirtualDeviceSpec[];                      // created before `ready`
  mode?: "tied" | "background";                       // default "tied"
  maxLifetimeMinutes?: number;                        // default 120; 1..1440
  readinessTimeoutSeconds?: number;                   // default 150
  onProgress?: (state: LifecycleState) => void;
}): Promise<Sandbox>
// throws runtime_missing, channel_unresolved, no_beta_in_progress, image_unavailable,
// not_ready, config_dir_invalid, config_invalid, virtual_unavailable, unsupported_device_kind

attachSandbox(id: string): Promise<Sandbox>        // a background instance; throws not_a_sandbox
listSandboxes(): Promise<SandboxListing[]>         // labelled containers only
stopSandbox(id: string): Promise<void>             // idempotent for ids it owns; not_a_sandbox otherwise
cleanup(): Promise<{ removed: Removal[] }>         // reaper, research R6; Removal = { id, containerId, reason }

runSmoke(options: { channel?; release?; ciRunUrl?: string }): Promise<RunResult>
// never throws for instance failures: they become the result's outcome

renderSupportedVersions(doc: SupportedVersionsDocument): string  // README block body
```

## `Sandbox` handle

```ts
interface Sandbox {
  readonly id: string;
  readonly release: ResolvedRelease;
  readonly mode: "tied" | "background";
  readonly deadline: string;
  readonly config: ConfigSummary | null;
  connection(): { url: string; wsUrl: string; token: string }; // FR-014, FR-015
  mcpEnv(): { DOMUSOPS_HA_URL: string; DOMUSOPS_HA_TOKEN: string }; // exactly these two keys
  addDevices(devices: VirtualDeviceSpec[]): Promise<VirtualDevice[]>;
  setState(
    entityId: string,
    state: string,
    attributes?: Record<string, unknown>,
  ): Promise<void>;
  getState(
    entityId: string,
  ): Promise<{ state: string; attributes: Record<string, unknown> } | null>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
  time: {
    freeze(at: string /* ISO 8601 */): Promise<void>;
    advance(seconds: number): Promise<{ now: string; fired: number }>;
    resume(): Promise<void>;
    now(): Promise<{ now: string; frozen: boolean }>;
  };
  detach(): Promise<void>; // background: release this process's hold; tied: same as stop
  stop(): Promise<void>; // idempotent
}
```

Guarantees:

- No function accepts a URL or a token. Every call on a handle first checks the container still
  carries the handle's id label and that the companion's `info` answers the same id (FR-019).
- `setState` then `getState` returns exactly what was set (FR-012).
- In tied mode the handle registers exit handlers (`exit`, `SIGINT`, `SIGTERM`) that stop the
  instance synchronously, and holds the owner WebSocket connection (research R6).
- Nothing in this API writes to `config.dir` (FR-006).
- Errors are `SandboxError` with `code` from data-model §7 and an English `message`. Messages and
  errors never contain the token.
- Invalid options are programmer errors, not `SandboxError`s, and are thrown before anything is
  started: `channel` and `release` together, a `release` that fails the release regex, or
  `readinessTimeoutSeconds` ≤ 0 throw `TypeError`; `maxLifetimeMinutes` outside 1..1440 throws
  `RangeError`. The CLI maps both to exit code 2 (contracts/cli.md).
