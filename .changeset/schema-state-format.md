---
"@domusops/schema": minor
---

Adds the `domusops.state/0.1` format: `STATE_FORMAT`, the `StateDocument` types (`StateStandardDocument`, `StateSummaryDocument`, `StateEnvelope`, `StateRecord`), `stateJsonSchema` and the reference decoder `expandState`. It describes the document `ha_state` returns: at `standard`, entities grouped by domain and templated, with local times and compact context IDs; at `summary`, counts per domain. `expandState` returns one record per entity, in entity-ID order, with full times and context IDs. No existing format changes.
