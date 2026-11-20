# Contract: the run report, `domusops.scenario-report/0.1`

Public in `@domusops/schema` (`src/scenario/report.ts`, with its JSON Schema). Written by
`domusops-sandbox test --report <file>` and returned by `runScenarios`. Sized for an agent
(FR-027): passed expectations are counted, failed ones carry their details.

## 1. Document

```json
{
  "format": "domusops.scenario-report/0.1",
  "runner": { "name": "@domusops/sandbox", "version": "0.2.0" },
  "started_at": "2026-11-19T18:02:11Z",
  "duration_ms": 41230,
  "outcome": "failed",
  "counts": { "passed": 1, "failed": 1, "could_not_run": 0, "not_run": 0 },
  "releases": [{ "channel": "stable", "release": "2026.11.2" }],
  "config": { "secrets": "none-referenced", "placeholder_keys": [] },
  "scenarios": [
    {
      "scenario": "hallway_night_motion",
      "file": "scenarios/hallway.yaml",
      "release": "2026.11.2",
      "outcome": "passed",
      "start": "2026-04-15T03:00:00+00:00 Wednesday",
      "duration_ms": 18410,
      "expectations": { "passed": 3, "failed": 0 }
    },
    {
      "scenario": "hallway_off_after_five_minutes",
      "file": "scenarios/hallway.yaml",
      "release": "2026.11.2",
      "outcome": "failed",
      "start": "2026-04-15T03:00:00+00:00 Wednesday",
      "duration_ms": 19970,
      "expectations": { "passed": 1, "failed": 1 },
      "failures": [
        {
          "at": "when[3].then[0]",
          "line": 14,
          "subject": "light.hallway",
          "check": "state",
          "expected": "off",
          "actual": "on",
          "read_at": "2026-04-15T03:06:00+00:00"
        }
      ],
      "activity": { "triggered": {}, "called": {}, "more": 0 }
    }
  ]
}
```

## 2. Fields

- `outcome` (run): `passed` when every scenario passed; `failed` when any failed; otherwise
  `could_not_run` when any could not run; `not_run` when nothing ran (no beta in progress).
- `scenarios[]` in a stable order: release order as given, then file path, then position in file.
- `scenarios[].outcome`: `passed`, `failed`, `could_not_run`, `not_run`.
- `scenarios[].start`: the frozen start moment with its offset and weekday (FR-006).
- `scenarios[].expectations` counts checks: an entity expectation counts its state and each stated
  attribute separately; `triggered` and `called` count one each, whatever `data` or `target` they
  state.
- `config`: how secrets were provided to the instances (`placeholders`, `caller-file`,
  `none-referenced`) and, for placeholders, the names of the keys replaced, never their values.
- `failures[]` (only when failed):
  - `at`: where the expectation is, `then[i]` or `when[j].then[i]`; `line` its line in the file.
  - `subject`: an entity ID, an automation entity ID, or an action.
  - `check`: `state`, `attribute:<name>`, `stays`, `triggered`, `called`, `limit` (with
    `subject: "scenario"`) or `step` (with `subject` the step's keyword, such as `advance_to`).
  - `expected`: the comparison as written (`"off"`, `{ "at_least": 100 }`, `{ "times": 1 }`).
  - `actual`: the value read; with `entity_missing`, `null`; for `triggered` and `called`, the
    count; for `advance_to_past`, the instance time.
  - `reason` (optional): `entity_missing`, `not_a_number`, `changed_during_span`,
    `time_limit`, `recording_limit`, `action_failed`, `advance_to_past` (`expected` is the moment
    written).
  - `read_at`: instance time of the read, or of the change for a span.
  - `calls` (only for `called`): up to 10 recorded calls of that action, each
    `{ "at", "data", "absent" }`, newest last.
- `reason` (only when could not run): `{ "code", "message" }`. Codes: `config_invalid`,
  `runtime_missing`, `channel_unresolved`, `image_unavailable`, `not_ready`, `instance_stopped`,
  `stand_in_exists`, `stand_in_kind_unsupported`, `action_offered`, `actions_unavailable`,
  `time_unavailable`, `starting_point_not_held` (message names the entity, the state set and the
  state found), `virtual_unavailable`.
- `instance_errors` (optional, only when failed): up to 5 error or warning entries the instance
  logged during the scenario, read with `system_log/list` before the instance is removed, each
  `{ "logger", "message" }`, the message cut at 300 characters. This is where an action that
  failed (a bad template, an undeclared missing action) shows up, since the instance is gone
  afterwards.
- `activity` (optional, only when failed): from the first step, `triggered` maps each automation
  entity ID to its count and `called` each action to its count, at most 20 entries each, the rest
  counted in `more`. It says that nothing triggered, or what was called instead, when no
  expectation names it.

Field values use underscores, as in every DomusOps document; the smoke result
(`domusops.sandbox-result/0.1`) is a separate, older format and keeps its hyphenated outcomes.

## 3. Readable report

Printed by the command, one block per scenario, every expectation listed:

```text
stable 2026.11.2
  PASS hallway_night_motion (scenarios/hallway.yaml) 18.4 s, starts Wed 2026-04-15 03:00
    pass light.hallway state on
    pass light.hallway brightness_pct 15
    pass media_player.turn_off called on media_player.living_room
  FAIL hallway_off_after_five_minutes (scenarios/hallway.yaml) 20.0 s
    pass when[1] light.hallway state on
    FAIL when[3] light.hallway state: expected off, found on at 03:06:00 (line 14)
    activity: nothing triggered, nothing called
2 scenarios: 1 passed, 1 failed, 0 could not run
```

## 4. Secrets

No string in either report contains the instance token or a value of the secrets file the run
was given (FR-028); both are replaced with `[redacted]` before writing.
