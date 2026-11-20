# Quickstart: validating scenarios

**Feature**: `006-scenario-dsl` | **Spec**: [spec.md](./spec.md)

Each scenario below proves part of the feature end to end. They use the reference fixture
`packages/sandbox/fixtures/scenario-config/` (synthetic entities only) and need Docker or Podman.

## Prerequisites

```sh
pnpm install
pnpm --filter @domusops/sandbox... build
cd packages/sandbox
CONFIG=fixtures/scenario-config
```

## 1. Files are checked before anything starts (US1 AS5, SC-003)

```sh
node dist/cli.js test --config "$CONFIG" --check
# exit 0; no container started
node dist/cli.js test --config "$CONFIG" test/fixtures/scenarios-invalid --check
# exit 2; one line per issue: file:line:column code message
```

## 2. The SEED example passes (US1 AS1, US2 AS1, SC-001)

```sh
time node dist/cli.js test --config "$CONFIG" hallway_night_motion
# PASS hallway_night_motion; three expectations passed; exit 0; under 2 minutes from cold start
docker ps -a --filter label=io.domusops.sandbox
# empty: the instance is gone (US1 AS6)
git status --porcelain "$CONFIG"
# empty: the source directory is unchanged
```

## 3. A wrong expectation fails on exactly that expectation (US1 AS2, AS3, SC-002)

```sh
node dist/cli.js test --config "$CONFIG" test/fixtures/scenarios-failing --report /tmp/r.json
# exit 1; brightness_pct expected 30, found 15; a missing entity reports entity_missing
node -e 'const r=require("/tmp/r.json"); console.log(r.counts, r.scenarios.map(s=>s.failures))'
```

## 4. Stand-ins and absent actions (US2 AS2–AS4)

Run the `stand_in_*` and `absent_*` scenarios of `test/fixtures/scenarios-could-not-run`:
an unoffered kind, an existing entity and an offered action each give could not run with
`stand_in_kind_unsupported`, `stand_in_exists` or `action_offered`; exit 3. Removing the
`absent_actions` line of the notification scenario makes the call fail and the expectation after
it fail, with `instance_errors` naming the missing action.

## 5. Time and sequences (US3, SC-006)

```sh
node dist/cli.js test --config "$CONFIG" hallway_off_after_five_minutes weekday_routine porch_stays_off
# all pass; each covers at least an hour of instance time; under 30 s each once ready
```

Change the fixture's delay from five to ten minutes in a copy of the fixture: the second
expectation fails with `found on at 03:06:00`.

## 6. A suite on several releases (US4, SC-005)

```sh
time node dist/cli.js test --config "$CONFIG" --channel stable --channel previous-stable --report /tmp/r.json
# every scenario on both releases; report names each release; under 10 minutes per release on CI
```

## 7. Named starting points (US5)

The `night_*` scenarios share `empty_house_night`; one overrides `presence.house`. Both pass.
`test/fixtures/scenarios-invalid/cycle.yaml` is refused with `starting_point_cycle`.

## 8. Determinism (SC-004)

```sh
DOMUSOPS_CONTAINER_TESTS=1 pnpm vitest run packages/sandbox/test/scenario-determinism.container.test.ts
# runs hallway_off_after_five_minutes 20 times; one outcome
```

## 9. Report size and secrets (SC-007, SC-009)

`pnpm test` runs `scenario-report.test.ts`: the machine report of a 10-scenario run with one
failure is at least 5 times smaller than the readable one, and a seeded token and secret value
never appear in either.

## 10. CI

On a pull request: each `sandbox-matrix` leg uploads `scenario-report-<channel>.json`;
`sandbox-gate` fails on a stable or previous-stable failure and lists beta; `scenario-example`
runs the documented workflow against the fixture installed from packed tarballs (FR-021a, FR-030).
