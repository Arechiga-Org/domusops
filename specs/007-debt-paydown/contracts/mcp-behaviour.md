# Contract delta: `@domusops/mcp` behaviour (US1, US5)

This document amends [003 ha_trace.md](../../003-ha-trace/contracts/ha_trace.md) and the shared
client behaviour of features 001 to 003. Everything not listed here is unchanged. In particular,
no tool output for the same instance state changes (FR-005, FR-027).

## `ha_trace`

### Reads

- One request has at most these outstanding at once: `get_config`, the registry read, one
  `trace/list` per selected domain, and `trace/contexts` when it is needed. All of them start
  together (R3).
- `trace/get` reads stay bounded by 8 in flight. After the first failed `trace/get`, no further
  `trace/get` starts (R1). The request returns that failure as today:
  `retrieval_failed`, with no runs.

### Too-large refusal at `detail=standard`

- The refusal can now come before every selected run has been read (R4). Its text:

  ```text
  too_large: The result has <runs> runs and would be <bytes> bytes or more, above the limit of <limit> bytes
  ```

  - `<runs>` is the number of runs selected, not the number read.
  - `<bytes>` is the size of the partial document that proved the overflow.

- The guidance line ("To fit it, use detail=summary … raise DOMUSOPS_TRACE_MAX_BYTES") is
  unchanged.
- When all runs are read before the overflow is proven, the existing text ("would be <bytes>
  bytes") is used, with the exact size.
- A result whose full size is within the limit is never refused (FR-004).

### `detail=summary`

Unchanged.

## All tools: connection close

When the server closes its connection to the instance while commands are outstanding, which
happens after a failure or at the end of a request, every outstanding command settles with:

```text
retrieval_failed: <command>: the connection closed before a reply arrived
```

An agent sees this only when it is the first failure of the request. The tool result reports one
error, as today.

## `ha_logbook_query`: unavailable history

The condition is detected from the instance's error code `unknown_command` on
`logbook/get_events`, not from the message text (R20). The `history_unavailable` result text is
unchanged.
