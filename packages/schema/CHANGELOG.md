# @domusops/schema

## 0.2.0

### Minor Changes

- adcc9cf: Adds the `domusops.history/0.1` format: `HISTORY_FORMAT`, the `HistoryDocument` types (`HistoryStandardDocument`, `HistorySummaryDocument`, `HistoryEnvelope`, `HistoryEntityEntry`, `HistoryRow`, `HistoryRecord`), `historyJsonSchema` and the reference decoder `expandHistory`. It describes the document `ha_history` returns: at `standard`, each entity's state at the start of the window, then its changes grouped by local date and hour, each one the difference from the entry before; at `summary`, counts of changes per domain and, when entities were named, per entity. `expandHistory` returns every entry with its full attributes, `last_updated` and `last_changed`. No existing format changes.
- 351d2e9: Adds the `domusops.ping/0.1` format: `PING_FORMAT`, the `PingDocument` types (`PingInstance`, `PingToolReadiness`, `PingReason`) and `pingJsonSchema`. It describes the document `ha_ping` returns: the server's identity, the instance's version, support and time zone, whether the token's user is an administrator, which integrations are loaded, and each tool's readiness with its reasons. The document is read as it is, so there is no decoder, and its `tools` and `integrations` maps are open to names a reader does not know. No existing format changes.
- dea01a2: Adds the `domusops.state/0.1` format: `STATE_FORMAT`, the `StateDocument` types (`StateStandardDocument`, `StateSummaryDocument`, `StateEnvelope`, `StateRecord`), `stateJsonSchema` and the reference decoder `expandState`. It describes the document `ha_state` returns: at `standard`, entities grouped by domain and templated, with local times and compact context IDs; at `summary`, counts per domain. `expandState` returns one record per entity, in entity-ID order, with full times and context IDs. No existing format changes.

## 0.1.1

### Patch Changes

- b520d21: Every package now ships its TypeScript sources next to `dist`, so the source maps and declaration maps in a package resolve from the package alone. `@domusops/schema` gains a README that says what the package is, how to install it, which formats it exports, and what stability it promises.

## 0.1.0

### Minor Changes

- 7ac64f8: Add the `domusops.logbook/0.1` format: the row, envelope, standard, and summary document types, the projection (`projectLogbook`), the context ID encoding, a JSON Schema (`logbookJsonSchema`), and a reference decoder (`expandLogbook`).
- 2afee5a: Add the `domusops.snapshot/0.1` format: types, the omission list, field defaults, the redaction marker, the key-space helpers, a JSON Schema, and a reference decoder (`expand`). Replaces the placeholder `HaSnapshot` type, which is a breaking change in 0.x.
- 6ae8715: Add the `domusops.trace/0.1` format: the extended and short trace record types, the envelope, standard, and summary document types, the value decoder (`decodeValue`) and timestamp helpers, a JSON Schema (`traceJsonSchema`), and a reference decoder (`expandTrace`).

  `expandTrace` keeps an explicit `last_step: null` and derives the last step from the steps only when the key is absent, so the round trip of a run that stopped before any step is lossless.
