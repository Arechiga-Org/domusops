---
"@domusops/mcp": minor
---

Add the `ha_trace` tool: a read-only, redacted, compressed record of the stored traces of automations and scripts (including not-triggered traces), selected by entity IDs or patterns, a start-time window, a run ID, or a context ID from `ha_logbook_query`, at `summary` or `standard` detail. `standard` is lossless. A result above `DOMUSOPS_TRACE_MAX_BYTES` (default 100000) is refused at either detail level, never truncated.
