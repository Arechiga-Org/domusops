# Data Model: Scenarios

**Feature**: `006-scenario-dsl` | **Spec**: [spec.md](./spec.md) | **Research**:
[research.md](./research.md)

The written format is in [contracts/scenario-format.md](./contracts/scenario-format.md); this
document holds the normalised form the runner executes, the run lifecycle and the results.

## 1. Normalised scenario (`@domusops/schema`)

```ts
type Duration = number; // seconds, > 0, <= 604800

type Comparison =
  | { eq: Scalar | Json } // a bare value as written
  | { not: Scalar | Json }
  | { in: (Scalar | Json)[] } // 1 or more
  | { at_least: number }
  | { at_most: number }
  | { between: [number, number] }; // low <= high

interface EntityValue {
  state: Scalar;
  attributes: Record<string, Json>;
}

interface StartingPoint {
  date: string; // YYYY-MM-DD, default DEFAULT_SCENARIO_DATE
  time: string; // HH:MM:SS, default DEFAULT_SCENARIO_TIME
  entities: [entityId: string, value: EntityValue][]; // in written order, after `use`
  standIns: { entityId: string; class?: string; initial?: string }[];
  absentActions: string[]; // patterns, deduplicated, in first-seen order
}

type Step =
  | { kind: "states"; entities: [string, EntityValue][]; line: number }
  | {
      kind: "action";
      action: string;
      target?: Target;
      data: Record<string, Json>;
      line: number;
    }
  | {
      kind: "event";
      eventType: string;
      data: Record<string, Json>;
      line: number;
    }
  | { kind: "advance"; seconds: Duration; line: number }
  | {
      kind: "advance_to";
      at: { time: string } | { instant: string };
      line: number;
    }
  | { kind: "expect"; expectations: Expectation[]; line: number };

interface Target {
  entity_id?: string[];
  device_id?: string[];
  area_id?: string[];
}

type Expectation = (
  | {
      kind: "entity";
      entityId: string;
      state?: Comparison;
      attributes: [name: string, Comparison][];
      for?: Duration;
    }
  | { kind: "triggered"; automation: string; times?: number }
  | {
      kind: "called";
      action: string;
      target?: Target;
      data: [string, Comparison][];
      times?: number;
    }
) & { within: Duration | 0; settle: number; at: string; line: number };
// `not_called` normalises to `called` with `times: 0`.

interface ResolvedScenario {
  name: string;
  description?: string;
  file: string; // relative to the configuration directory
  line: number;
  given: StartingPoint; // `use` applied (contract §3)
  steps: Step[]; // `when` then a final `expect` step from `then`
  timeout: number; // seconds
  settle: number; // seconds
}
```

Validation rules live in the contract; the ones that span files (unique names, references,
cycles) are checked by `resolveSuite`. `STAND_IN_KINDS` in the schema mirrors the sandbox's
`DEVICE_KINDS`; a sandbox test asserts they are equal, since the schema cannot import the sandbox
(§5).

## 2. Scenario run lifecycle (`@domusops/sandbox`)

```text
queued → starting → preparing → applying → running → checking → passed | failed
            │           │          │          │          │
            └───────────┴──────────┴──────────┴──────────┴──→ could_not_run   (cause, §5)
any state ──(time limit)──→ failed (time_limit)
every end state → instance removed (stop), then the result is emitted
```

| State       | What happens                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `starting`  | `startSandbox({ release, config: { dir, secretsFile }, devices: [], mode: "tied" })`.                                                                                                                  |
| `preparing` | Stand-ins checked and added (research R5); absent actions sent to the companion (R6); clock frozen at the start moment (R8).                                                                           |
| `applying`  | Entity states of `given` written in order; after `settle` real seconds at most, each is read back and compared (state, and stated attributes): any mismatch → could not run `starting_point_not_held`. |
| `running`   | Recording opened (R7); steps run in order; each `expect` step checks its expectations (R9).                                                                                                            |
| `checking`  | The final `then`, a failed scenario's instance errors read (`system_log/list`), recording closed.                                                                                                      |

## 3. Recorded event

```ts
interface Recorded {
  type: "state_changed" | "call_service" | "automation_triggered";
  at: string; // time_fired, instance time
  entityId?: string; // state_changed, automation_triggered
  newState?: EntityValue | null;
  action?: string; // call_service: domain.service
  data?: Record<string, Json>; // call_service: service_data, target merged in
  absent?: boolean; // call_service from an absent action
}
```

Kept in memory per scenario, at most 20 000 (`recording_limit`).

## 4. Results

```ts
interface ExpectationFailure {
  at: string;
  line: number;
  subject: string;
  check:
    | "state"
    | `attribute:${string}`
    | "exists"
    | "stays"
    | "triggered"
    | "called"
    | "limit";
  expected: Json;
  actual: Json;
  reason?:
    | "entity_missing"
    | "not_a_number"
    | "changed_during_span"
    | "time_limit"
    | "recording_limit"
    | "action_failed";
  read_at: string;
  calls?: { at: string; data: Record<string, Json>; absent: boolean }[]; // <= 10
}

interface ScenarioResult {
  scenario: string;
  file: string;
  release: string | null;
  outcome: "passed" | "failed" | "could_not_run" | "not_run";
  start?: string; // "2026-04-15T03:00:00+00:00 Wednesday"
  duration_ms: number;
  expectations?: { passed: number; failed: number };
  failures?: ExpectationFailure[];
  reason?: { code: CouldNotRunCode; message: string };
  instance_errors?: { logger: string; message: string }[]; // <= 5
}

interface ScenarioReport {
  format: "domusops.scenario-report/0.1";
  runner: { name: string; version: string };
  started_at: string;
  duration_ms: number;
  outcome: "passed" | "failed" | "could_not_run" | "not_run";
  counts: {
    passed: number;
    failed: number;
    could_not_run: number;
    not_run: number;
  };
  releases: { channel?: Channel; release: string | null }[];
  scenarios: ScenarioResult[];
}
```

## 5. Outcomes

| Outcome         | Causes                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passed`        | Every expectation held.                                                                                                                                                                                                                                                         |
| `failed`        | At least one expectation did not hold; or `time_limit`; or `recording_limit`; or `advance_to_past`. Every expectation still reached is reported.                                                                                                                                |
| `could_not_run` | `runtime_missing`, `channel_unresolved`, `image_unavailable`, `not_ready`, `config_invalid`, `instance_stopped`, `stand_in_exists`, `stand_in_kind_unsupported`, `action_offered`, `actions_unavailable`, `time_unavailable`, `virtual_unavailable`, `starting_point_not_held`. |
| `not_run`       | The target channel is beta and no beta is in progress.                                                                                                                                                                                                                          |

Invalid scenario files are not an outcome: they stop the run before any instance starts (exit 2).

## 6. Errors from the harness

The runner maps `SandboxError` codes to causes one to one where they share a name
(`runtime_missing`, `channel_unresolved`, `image_unavailable`, `not_ready`, `config_invalid`,
`time_unavailable`, `virtual_unavailable`; `instance_gone` and `time_control_failed` →
`instance_stopped`); `no_beta_in_progress` gives `not_run`; `config_dir_invalid` is checked before
the run starts and is a usage error (exit 2). Any other harness error is `instance_stopped` with
its scrubbed message.
