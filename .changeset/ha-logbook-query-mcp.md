---
"@domusops/mcp": minor
---

Add the `ha_logbook_query` tool: a read-only, redacted, compressed history of the logbook events of a time window, filtered by entity IDs or patterns, at `summary` or `standard` detail. A `standard` result above `DOMUSOPS_LOGBOOK_MAX_BYTES` (default 100000) is refused, never truncated.

`ha_snapshot` now also redacts coordinates written as text (a latitude and longitude pair) and the instance's own coordinates wherever they appear in a string, so its output can contain more `[redacted]` markers. The `protocol_error` text now says "a bug in the DomusOps server" instead of "a bug in ha_snapshot", and the `retrieval_failed` next step no longer says "No snapshot was produced", since two tools share them. The instance's own coordinates are now matched as whole numbers: `20.4746` is no longer found inside `120.4746`.
