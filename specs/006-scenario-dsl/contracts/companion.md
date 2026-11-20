# Contract: companion addition, absent actions

One new WebSocket command of the `domusops_sandbox` companion integration
(`specs/005-sandbox-harness/contracts/companion.md`). Everything existing is unchanged. Research
R6 explains the design.

## `domusops_sandbox/actions/absent`

Request:

```json
{
  "type": "domusops_sandbox/actions/absent",
  "patterns": ["media_player.*", "notify.mobile_app_phone"]
}
```

- `patterns`: 1 to 100 strings, each `<domain>.<service>` or `<domain>.*`, both parts
  `^[a-z0-9_]+$`. Sent once per instance, before the first step; a second call replaces the list.

Success: `{}`. From then on, a call to an action that the instance does not offer and that matches
a pattern:

1. fires `call_service` with the usual `domain`, `service` and `service_data` (target merged in),
   plus `domusops_absent: true`, stamped with the instance's (frozen) time;
2. returns as a successful call: no state changes, and the calling script or automation goes on to
   its next action. When the caller asked for a response, the response is `{}`.

A call that matches no pattern, or an action the instance does offer, is untouched.

Errors:

| Code                  | When                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `invalid_format`      | A pattern does not match the grammar.                                                                                      |
| `action_offered`      | An exact pattern names an action the instance offers. The message lists them.                                              |
| `actions_unavailable` | This release lacks the internal the command wraps (`ServiceRegistry.async_call`, `ServiceNotFound`); the message names it. |

The companion opens no connection and logs the patterns once at info level; it never logs call
data.
