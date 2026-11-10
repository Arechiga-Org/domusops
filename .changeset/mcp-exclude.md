---
"@domusops/mcp": patch
---

`ha_logbook_query` and `ha_trace` accept `exclude`, a list of entity IDs and `*` patterns in the same form as `entities`, applied after it: the matching entities, automations and scripts are left out of the result, its counts, its size check and its `compression_ratio`, so a broad pattern stays usable and a result refused for size can fit. When `exclude` is given, a text block after the unchanged document lists what was excluded. Calls without `exclude` return exactly what they did before.
