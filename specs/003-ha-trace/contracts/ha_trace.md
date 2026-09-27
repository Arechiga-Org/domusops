# Contract: `ha_trace` MCP tool

Interface exposed by `@domusops/mcp`. The tool definition (name, description, input schema,
annotations) is in [ha_trace.tool.json](./ha_trace.tool.json). The response format is defined in
[data-model.md](../data-model.md). Everything not stated here is as in the
[`ha_logbook_query` contract](../../002-ha-logbook-query/contracts/ha_logbook_query.md).

## Server

Unchanged, except that the server advertises three tools: `ha_snapshot` and `ha_logbook_query`
(both unchanged, FR-001) and `ha_trace`.

## Configuration

Read on every invocation, not at startup.

| Variable                   | Required | Form                                                                              |
| -------------------------- | -------- | --------------------------------------------------------------------------------- |
| `DOMUSOPS_HA_URL`          | yes      | As for `ha_snapshot`                                                              |
| `DOMUSOPS_HA_TOKEN`        | yes      | As for `ha_snapshot` (administrator user)                                         |
| `DOMUSOPS_TRACE_MAX_BYTES` | no       | Positive integer; size limit of a result at either detail level. Default `100000` |

The limit is configuration only, separate from `DOMUSOPS_LOGBOOK_MAX_BYTES`. It is not a tool
parameter (FR-020).

## Input

| Property   | Type                        | Default      | Rules                                                                                                             |
| ---------- | --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `entities` | string[] (1 to 100 items)   | all items    | As `ha_logbook_query` selectors; matched against the entity IDs of known automations and scripts                  |
| `start`    | string                      | see rule     | As `ha_logbook_query`. The window applies only when `start` or `end` is given; the missing side defaults as there |
| `end`      | string                      | see rule     | As `ha_logbook_query`                                                                                             |
| `run`      | string                      | none         | 32 lowercase hexadecimal characters                                                                               |
| `context`  | string                      | none         | A 26-character ULID, a compact context ID (`<offset>:<16 characters>`), or up to 64 printable ASCII characters    |
| `detail`   | `"summary"` \| `"standard"` | `"standard"` | Any other value is rejected with the accepted values                                                              |

`run` and `context` each exclude every other selection parameter; `detail` combines with all.

## Successful result

One `text` content block holding one minified `domusops.trace/0.1` document at the requested
detail level. No `structuredContent`. `isError` absent or `false`.

## Failed result

`isError: true` and one `text` block: `ha_trace failed [<kind>]: <cause>. <next step>.` The kinds
are those of [data-model §8](../data-model.md#8-errors). The text never contains the token or any
trace data. No runs are returned with an error.

## Guarantees

| Guarantee                                                                                  | Source                                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| No mutation of the instance under any input                                                | FR-017. The allowlist adds only `trace/list`, `trace/get`, `trace/contexts`; no debug command |
| Every selected run, with every recorded step, or an error                                  | FR-018, FR-020, data-model §9                                                                 |
| `standard` is lossless                                                                     | FR-009, data-model §5                                                                         |
| Selectors that matched nothing, items without runs, and untraceable automations are listed | FR-004                                                                                        |
| Context IDs link runs to `ha_logbook_query` causes (same last 16 characters)               | FR-011, research R8                                                                           |
| Redaction at both detail levels, including configurations                                  | FR-014, FR-015                                                                                |
| `compression_ratio` in every successful result                                             | FR-013                                                                                        |
| `standard` ratio ≥ 3 on the reference fixture                                              | FR-019. Asserted in CI                                                                        |
| Deterministic output for identical input                                                   | data-model §3.4                                                                               |

`idempotentHint` is `false`: new runs replace stored ones between calls.

## Limits (stated in the tool description)

- The instance keeps the most recent traces per automation or script (`stored_traces`, 5 by
  default), in memory; a crash loses those recorded since the last clean stop.
- Automations without an `id` in their configuration are not traced; they are listed as
  `untraceable`.
- Not-triggered traces exist from Home Assistant 2026.7.

## Versioning

As for `domusops.logbook`: the `format` field versions the document independently of package
versions; any change to the encoding or the redaction marker is a format version change.
