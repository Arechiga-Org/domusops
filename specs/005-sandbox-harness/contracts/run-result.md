# Contract: run result and the README table

## Run result (`domusops.sandbox-result/0.1`)

Written by `domusops-sandbox smoke --result <file>`; validated by
`packages/sandbox/schema/run-result.schema.json`.

```json
{
  "format": "domusops.sandbox-result/0.1",
  "channel": "previous-stable",
  "release": "2026.9.3",
  "outcome": "failed",
  "failedStep": "time",
  "steps": [
    { "name": "start", "status": "passed", "ms": 41210 },
    { "name": "load-config", "status": "passed", "ms": 3120 },
    { "name": "virtual-device", "status": "passed", "ms": 2210 },
    { "name": "set-state", "status": "passed", "ms": 120 },
    {
      "name": "time",
      "status": "failed",
      "ms": 530,
      "message": "automation did not fire"
    },
    { "name": "mcp-snapshot", "status": "skipped" },
    { "name": "websocket", "status": "skipped" },
    { "name": "teardown", "status": "passed", "ms": 2400 }
  ],
  "startedAt": "2026-10-06T10:00:00Z",
  "finishedAt": "2026-10-06T10:01:02Z",
  "runner": "linux-x64",
  "sandboxVersion": "0.1.0",
  "ciRunUrl": "https://github.com/<owner>/<repo>/actions/runs/<id>"
}
```

Rules: `release` is absent for `no-beta-in-progress` and for a `could-not-run` at `resolve`, where no release was found. `failedStep` is present exactly when
the outcome is `failed` or `could-not-run` (then `resolve` or `pull`). `steps` is empty for
`could-not-run` and `no-beta-in-progress`. `message` is English, at most 300 characters, and
never contains a token, a secret, or entity states.

## README block

Between `<!-- domusops:supported-versions:start -->` and `<!-- domusops:supported-versions:end -->`,
rendered only from `docs/supported-versions.json`:

```markdown
| Channel         | Release   | Result              | Checked                 |
| --------------- | --------- | ------------------- | ----------------------- |
| Current stable  | 2026.10.1 | Passed              | [2026-10-06](<run url>) |
| Previous stable | 2026.9.3  | Failed (time)       | [2026-10-06](<run url>) |
| Current beta    | —         | No beta in progress | [2026-10-06](<run url>) |
```

Text outside the markers is never touched. `packages/sandbox/test/readme-table.test.ts` fails when
the block differs from the rendering (FR-024).

A row is replaced by the next result for its channel, except that a `could-not-run` result never
replaces an existing row: it says nothing about the release, so the last real result stays. Only
results of runs on `main` are applied (`sandbox:table --run` refuses any other run).
