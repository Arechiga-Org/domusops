---
"@domusops/schema": minor
---

Adds the `domusops.history/0.1` format: `HISTORY_FORMAT`, the `HistoryDocument` types (`HistoryStandardDocument`, `HistorySummaryDocument`, `HistoryEnvelope`, `HistoryEntityEntry`, `HistoryRow`, `HistoryRecord`), `historyJsonSchema` and the reference decoder `expandHistory`. It describes the document `ha_history` returns: at `standard`, each entity's state at the start of the window, then its changes grouped by local date and hour, each one the difference from the entry before; at `summary`, counts of changes per domain and, when entities were named, per entity. `expandHistory` returns every entry with its full attributes, `last_updated` and `last_changed`. No existing format changes.
