# Data Model: ha_system_log

## 1. Raw entry (`system_log/list`)

As measured in research R1. The answer is a list, newest first by last occurrence.

| Key              | Type                | Rule                                                                       |
| ---------------- | ------------------- | -------------------------------------------------------------------------- |
| `name`           | string              | The logger                                                                 |
| `message`        | string array        | 1 to 5 distinct messages, oldest dropped first                             |
| `level`          | string              | `WARNING`, `ERROR` or `CRITICAL`                                           |
| `source`         | `[string, integer]` | Path relative to the installation or the configuration directory, and line |
| `timestamp`      | number              | Last occurrence, seconds since the epoch with microseconds                 |
| `exception`      | string              | The formatted traceback, `""` when none                                    |
| `count`          | integer             | Occurrences                                                                |
| `first_occurred` | number              | First occurrence, seconds since the epoch                                  |

## 2. Envelope (`domusops.system_log/0.1`)

Both detail levels share these keys, in this order; minified JSON.

| Key                 | Type                        | Rule                                                                            |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `format`            | `"domusops.system_log/0.1"` | Constant                                                                        |
| `detail`            | `"summary" \| "standard"`   | The requested level                                                             |
| `ha_version`        | string                      | From the handshake                                                              |
| `compression_ratio` | number                      | Raw bytes of the selected entries over the document's bytes, two decimals (R12) |
| `time_zone`         | string                      | IANA name, from `get_config`                                                    |
| `utc_offset`        | `±HH:MM`                    | The offset at the time of the call; the default for every local time            |
| `integrations`      | string array, optional      | `integrations` as parsed, when given                                            |
| `level`             | string, optional            | The minimum level, when given                                                   |
| `start`             | string, optional            | `start` as resolved, local ISO 8601 with offset, to the second                  |
| `custom`            | string array, optional      | Custom integrations named by the listed entries, in name order                  |

`exclude` is not echoed: the exclusion note names it (feature 008).

## 3. Standard document

Envelope, then:

| Key       | Type                 | Rule                                                                                     |
| --------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `files`   | string array         | Paths of the sources and of the frames in `parts`, each once, in order of first use      |
| `parts`   | array                | Every distinct frame, and the traceback lines used more than once, in order of first use |
| `entries` | map of date to array | `{ "YYYY-MM-DD": [entry, ...] }`, by local date of the last occurrence                   |

A part is a string (a traceback line) or a frame: `[file, line, function]` or
`[file, line, function, code]`, `file` an index into `files`, `code` the indented lines below the
frame's `File` line, verbatim.

An entry, positional, trailing `null` values dropped; entries in order of last occurrence, then
logger, then source (R5):

| Position | Value                         | Rule                                                                                  |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| 0        | `"HH:MM:SS"` or with `±HH:MM` | Last occurrence; the offset only when it differs from `utc_offset`                    |
| 1        | string                        | `warning`, `error` or `critical`                                                      |
| 2        | string                        | The logger                                                                            |
| 3        | string or `null`              | The integration domain (R3)                                                           |
| 4        | `[file, line]`                | The source, `file` an index into `files`                                              |
| 5        | integer ≥ 1                   | Occurrences                                                                           |
| 6        | string array                  | Messages, redacted, roots replaced                                                    |
| 7        | string or `null`              | First occurrence; `null` when equal to the last; time only on the same date, else ISO |
| 8        | array or `null`               | Traceback items: an index into `parts`, or a string of lines that appear once         |
| 9        | `1` or `null`                 | `1` when the integration came from the source (R3)                                    |

Absolute paths in `files`, messages and traceback strings have their roots replaced by the markers
`{config}/`, `{ha}/` and `{python}/` (R7).

## 4. Summary document

Envelope, then:

| Key                   | Type                                                      | Rule                                            |
| --------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `counts`              | `{ entries, occurrences }`                                | Totals over the selected entries                |
| `by_integration`      | map of domain to map of level to `[entries, occurrences]` | Domains in name order, levels in severity order |
| `without_integration` | map of level to `[entries, occurrences]`, optional        | Entries with no integration; absent when none   |

## 5. Decoded entry (`expandSystemLog`)

`expandSystemLog(document)` returns the entries in the document's order; each entry:

| Key                | Type                             | Rule                                                                      |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------- |
| `level`            | string                           | As in the document                                                        |
| `logger`           | string                           |                                                                           |
| `integration`      | string \| null                   |                                                                           |
| `integration_from` | `"logger"` \| `"source"` \| null | `source` when position 9 is `1`; `null` without an integration            |
| `custom`           | boolean                          | The integration is in `custom`                                            |
| `source`           | `{ file, line }`                 | `file` resolved from `files`                                              |
| `count`            | integer                          |                                                                           |
| `first_occurred`   | string                           | Local ISO 8601 with offset; the last occurrence when position 7 is absent |
| `last_occurred`    | string                           | Local ISO 8601 with offset                                                |
| `messages`         | string array                     |                                                                           |
| `traceback`        | string \| null                   | Rebuilt from `parts` and strings, joined by newlines (R13)                |

## 6. Errors

| Kind                           | When                                             | Source                                |
| ------------------------------ | ------------------------------------------------ | ------------------------------------- |
| `selector_invalid`             | `integrations` or `exclude` malformed            | existing, with a new subject (R4)     |
| `window_invalid`               | `start` malformed, before 1970, or in the future | existing (R4)                         |
| `input_invalid`                | `level` not `warning`, `error` or `critical`     | `inputInvalid(problem, "system_log")` |
| `not_admin`                    | the token's user is not an administrator         | `notAdmin("required")` (R2)           |
| `system_log_unavailable`       | `system_log` not loaded, or the command unknown  | new `systemLogUnavailable` (R2)       |
| `too_large`                    | above `DOMUSOPS_SYSTEM_LOG_MAX_BYTES`            | new `tooLargeSystemLog` (R9)          |
| connection and protocol errors | as in every tool                                 | existing                              |
