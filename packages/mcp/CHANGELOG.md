# @domusops/mcp

## 0.1.0

### Minor Changes

- 7ac64f8: Add the `ha_logbook_query` tool: a read-only, redacted, compressed history of the logbook events of a time window, filtered by entity IDs or patterns, at `summary` or `standard` detail. A `standard` result above `DOMUSOPS_LOGBOOK_MAX_BYTES` (default 100000) is refused, never truncated.

  `ha_snapshot` now also redacts coordinates written as text (a latitude and longitude pair) and the instance's own coordinates wherever they appear in a string, so its output can contain more `[redacted]` markers. The `protocol_error` text now says "a bug in the DomusOps server" instead of "a bug in ha_snapshot", and the `retrieval_failed` next step no longer says "No snapshot was produced", since two tools share them. The instance's own coordinates are now matched as whole numbers: `20.4746` is no longer found inside `120.4746`.

- 2afee5a: Add the `ha_snapshot` tool: a read-only, redacted, compressed inventory of a Home Assistant instance at `summary`, `standard`, or `full` detail.
- 6ae8715: Add the `ha_trace` tool: a read-only, redacted, compressed record of the stored traces of automations and scripts (including not-triggered traces), selected by entity IDs or patterns, a start-time window, a run ID, or a context ID from `ha_logbook_query`, at `summary` or `standard` detail. `standard` is lossless. A result above `DOMUSOPS_TRACE_MAX_BYTES` (default 100000) is refused at either detail level, never truncated.

  `ha_trace` redacts secrets inside the value of an identifier key (`id`, `path`, `domain`, and the others it exempts) and inside objects under one, since a trace's variables can use those names. The `not_admin` next step of `ha_trace` and `ha_logbook_query` no longer mentions the snapshot; `ha_snapshot`'s text and redaction are unchanged.

### Patch Changes

- Updated dependencies [7ac64f8]
- Updated dependencies [2afee5a]
- Updated dependencies [6ae8715]
  - @domusops/schema@0.1.0
