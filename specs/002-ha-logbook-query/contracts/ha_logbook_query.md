# Contract: `ha_logbook_query` MCP tool

Interface exposed by `@domusops/mcp`. The tool definition (name, description, input schema,
annotations) is in [ha_logbook_query.tool.json](./ha_logbook_query.tool.json). The response format
is defined in [data-model.md](../data-model.md). Everything not stated here is as in the
[`ha_snapshot` contract](../../001-ha-snapshot/contracts/ha_snapshot.md).

## Server

Unchanged, except that the server advertises two tools: `ha_snapshot` (unchanged, FR-001) and
`ha_logbook_query`.

## Configuration

Read on every invocation, not at startup.

| Variable                     | Required | Form                                                                  |
| ---------------------------- | -------- | --------------------------------------------------------------------- |
| `DOMUSOPS_HA_URL`            | yes      | As for `ha_snapshot`                                                  |
| `DOMUSOPS_HA_TOKEN`          | yes      | As for `ha_snapshot` (administrator user)                             |
| `DOMUSOPS_LOGBOOK_MAX_BYTES` | no       | Positive integer; size limit of a `standard` result. Default `100000` |

The limit is configuration only. It is not a tool parameter (FR-019).

## Input

| Property   | Type                        | Default              | Rules                                                                                                                          |
| ---------- | --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `start`    | string                      | `end` minus 24 hours | `YYYY-MM-DDTHH:MM[:SS[.fff]][Z\|±HH:MM]`; no offset means the instance's time zone                                             |
| `end`      | string                      | the time of the call | Same form; later than the time of the call is clamped to it; must be after `start`                                             |
| `entities` | string[] (1 to 100 items)   | all events           | Each an entity ID or a pattern of `a-z 0-9 _ . *`, where `*` matches any sequence; case-sensitive, each at most 128 characters |
| `detail`   | `"summary"` \| `"standard"` | `"standard"`         | Any other value is rejected with the accepted values                                                                           |

Local times that do not exist (the gap of a daylight-saving change) move forward by the gap;
local times that occur twice resolve to the earlier instant.

## Successful result

One `text` content block holding one minified `domusops.logbook/0.1` document at the requested
detail level. No `structuredContent`. `isError` absent or `false`.

## Failed result

`isError: true` and one `text` block: `ha_logbook_query failed [<kind>]: <cause>. <next step>.`
The kinds are those of [data-model §8](../data-model.md#8-errors). The text never contains the
token or any event data. No events are returned with an error.

## Guarantees

| Guarantee                                             | Source                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| No mutation of the instance under any input           | FR-016. The client allowlist adds only `logbook/get_events` |
| Every selected event, in order, with its cause        | FR-007, FR-017, data-model §9                               |
| Either every event in the window, or an error         | FR-017, FR-019                                              |
| Selectors that matched nothing are listed             | FR-005                                                      |
| Redaction at both detail levels                       | FR-012, FR-013                                              |
| `compression_ratio` in every successful result        | FR-011                                                      |
| `standard` ratio ≥ 5 on the 24-hour reference fixture | FR-018. Asserted in CI                                      |
| Deterministic output for identical input              | data-model §3.4                                             |

`idempotentHint` is `false`: with the default window, two calls cover different periods.

## Limits of the logbook (stated in the tool description)

- Continuous entities (sensors with a unit of measurement, a state class, or a numeric device
  class; counters; images; proximity) are not recorded by the logbook. A selector naming only
  such entities appears in `no_events`.
- History older than the instance's retention period has been purged. `first` shows the earliest
  event actually returned.
- Patterns and unfiltered queries follow the instance's YAML `logbook:` exclude settings; exact
  entity IDs do not ([research R4](../research.md#r4-entity-selectors)).

## Versioning

As for `domusops.snapshot`: the `format` field versions the document independently of package
versions; any change to the encoding, the projection, or the redaction marker is a format
version change.
