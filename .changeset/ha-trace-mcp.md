---
"@domusops/mcp": minor
---

Add the `ha_trace` tool: a read-only, redacted, compressed record of the stored traces of automations and scripts (including not-triggered traces), selected by entity IDs or patterns, a start-time window, a run ID, or a context ID from `ha_logbook_query`, at `summary` or `standard` detail. `standard` is lossless. A result above `DOMUSOPS_TRACE_MAX_BYTES` (default 100000) is refused at either detail level, never truncated.

`ha_trace` redacts secrets inside the value of an identifier key (`id`, `path`, `domain`, and the others it exempts) and inside objects under one, since a trace's variables can use those names. The `not_admin` next step of `ha_trace` and `ha_logbook_query` no longer mentions the snapshot; `ha_snapshot`'s text and redaction are unchanged.
