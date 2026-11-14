---
"@domusops/schema": minor
---

Adds the `domusops.system_log/0.1` format: `SYSTEM_LOG_FORMAT`, `SYSTEM_LOG_LEVELS`, the `SystemLogDocument` types (`SystemLogStandardDocument`, `SystemLogSummaryDocument`, `SystemLogEnvelope`, `SystemLogEntryRow`, `SystemLogPart`, `SystemLogFrame`, `SystemLogRecord`), `systemLogJsonSchema` and the reference decoder `expandSystemLog`. It describes the document `ha_system_log` returns: at `standard`, the file paths and the traceback frames and lines the entries share, given once, then the entries grouped by local date; at `summary`, counts of entries and occurrences per integration and level. `expandSystemLog` returns every entry with its integration, source, times, messages and traceback text. No existing format changes.
