---
"@domusops/mcp": patch
---

A `ha_trace` call with `start` or `end` now says which automations and scripts may have discarded runs from the window: a text block after the unchanged document names each one (at most 10) that already stores as many runs as it keeps, with its `stored_traces` limit, and explains how to keep more. An empty result is no longer mistaken for "nothing ran". The limit is read with `automation/config` or `script/config`, only for those candidates. Calls without a window return exactly what they did before.
