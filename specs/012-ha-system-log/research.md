# Research: ha_system_log

Each entry records a decision, why it was taken, and what was rejected. The instance's behaviour
was measured on 2026-11-13 with a probe against disposable sandbox instances of 2026.10.0 and
2026.9.4: `default_config`, a broken template sensor, and a synthetic custom integration, `boom`,
whose service logs warnings, errors with tracebacks (one chained) and a library logger's error on
demand; one entry was written with the `system_log.write` action. No data from a real home. The
probe also read the integration's source in each container. Sizes were measured with a prototype
of the encoding of R6 on a synthetic log of 50 entries (R12).

## R1. The system log command

- **Facts** (both releases answer the same; only line numbers differ):
  - `system_log/list` takes no parameter: any other key fails with `invalid_format` ("extra keys
    not allowed"). It is registered with `require_admin`, so a non-administrator gets
    `unauthorized`.
  - The answer is a list of entries, newest first by last occurrence. Each entry is
    `{ name, message, level, source, timestamp, exception, count, first_occurred }`:
    - `name`: the logger name.
    - `message`: a list of 1 to 5 distinct messages; when a sixth distinct one arrives, the
      oldest is dropped. A message may hold newlines.
    - `level`: `WARNING`, `ERROR` or `CRITICAL`. The integration's handler is fixed at
      `WARNING`, so debug and info records never reach the system log, whatever the logger
      configuration.
    - `source`: `[path, line]`, the deepest frame of the instance's own code or of its
      configuration directory, with that prefix removed (`components/template/template_entity.py`,
      `custom_components/boom/__init__.py`, `helpers/template/__init__.py`). When no frame
      matches, the record's own absolute path.
    - `timestamp` (the last occurrence) and `first_occurred`: seconds since the epoch with
      microseconds.
    - `exception`: the formatted traceback, `""` when there is none. Its frames carry absolute
      paths: `/usr/src/homeassistant/homeassistant/…` (the installation), `/config/…` (the
      configuration directory), `/usr/local/lib/python3.14/…` (the standard library and
      `site-packages`), and `<template>` for template code. Python 3.11 and later add caret lines
      (`~~~^^^`) under some source lines.
    - `count`: occurrences since the entry was created.
  - Entries are grouped by `(logger, source, root cause)`, the root cause being the last frame of
    the traceback; a recurrence increments `count`, updates `timestamp`, adds its message if new,
    and moves the entry to the front. The store keeps `max_entries` entries (default 50,
    configurable) and drops the oldest. It lives in memory and is empty after a restart.
  - The record of `system_log.write` has the logger it names and, as source, the action's own
    code (`components/system_log/__init__.py`). A warning raised by the Python runtime has the
    logger `py.warnings` and, as source, the integration code that triggered it.
  - The answer carries no context.
- **Decision**: a new allowlisted read, `system_log/list`, sent with no parameter, with the
  per-command time limit (the answer is bounded by `max_entries` and does not grow with a
  window).
- **Why**: FR-014. It is a read; the write and clear actions are services, never called by the
  server.
- **Rejected**: the REST error log endpoint (the raw log file: another transport, unbounded, and
  out of scope); subscribing to `system_log_event` (live watching, out of scope).

## R2. Reads and their order

- **Decision**: on one connection, `auth/current_user` and `get_config` together, as in
  `ha_state` and `ha_history`. The user must be an administrator, then `system_log` must be among
  the loaded components. Then one `system_log/list`. `get_config` also gives `config_dir`, used by
  R7.
- **Errors**:
  - Not an administrator: the subject `entity_history` of `notAdmin`, whose remediation is not
    specific to history ("Every DomusOps tool requires one, so a result never depends on what a
    restricted user may read"), is renamed `required` and used by both tools. The wording does not
    change (FR-020).
  - System log not loaded, or the command answered `unknown_command`: a new
    `systemLogUnavailable()`, kind `system_log_unavailable`, "The instance does not provide its
    system log", remediation "Make sure the system_log integration is loaded (Home Assistant
    loads it at startup unless the configuration prevents it), then try again".
- **Why**: FR-013, FR-014. `system_log` does not read entities, so `get_states` is never sent.

## R3. Integration of an entry

- **Decision**:
  1. From the logger: `homeassistant.components.<domain>` or `custom_components.<domain>`, followed
     by the end of the name or a dot. The second form is a custom integration.
  2. Otherwise from the source path (R1): `components/<domain>/` is a built-in integration,
     `custom_components/<domain>/` a custom one; a source path that is absolute or under another
     directory gives none.
  3. Otherwise none.
     The entry says when its integration came from the source (FR-003). A `py.warnings` entry is
     attributed to the integration whose code triggered it, which is where the agent must look.
- **Why**: clarification of 2026-11-13; the instance already picks the source as the deepest frame
  of its own or the configuration's code, so a library logger's entry points at the integration
  that called the library (measured: `pyboom.client` → `custom_components/boom/__init__.py`).
- **Rejected**: walking the traceback for an integration frame (the instance already did it for
  the source); attributing `homeassistant.helpers.*` loggers to an integration (the helpers are
  shared code; an entry whose source is a helper keeps no integration).

## R4. Selection and inputs

- **Decision**: every input is validated before connecting.
  - `integrations`, `exclude`: the limits, deduplication and matcher of `logbook/selectors.ts`
    (`MAX_SELECTORS`, `MAX_SELECTOR_LENGTH`, `matcher`, `exclusion`), with a stricter character set,
    `[a-z0-9_*]`, since a domain has no dot. `parseSelectors` gains a third kind, `integration
selector`, with that character set, and `selectorInvalid` gains a subject whose remediation
    reads "Use an integration domain or a pattern made of lowercase letters, digits, underscores,
    and * (for example mqtt, hue*, or *_cloud)". The entity wordings do not change.
  - A pattern matches an entry's integration domain. With `integrations`, an entry without an
    integration is left out; `exclude` never removes one (FR-004).
  - `level`: `warning`, `error` or `critical`, the minimum level; refused otherwise with
    `inputInvalid(problem, "system_log")`, whose remediation lists the three levels. Debug and
    info are not accepted: the instance never records them (R1).
  - `start`: parsed by `parseWindowInput` and `resolveWindow` of `logbook/window.ts`, as the start
    of a window whose end is now, so its errors are the logbook's (malformed, before 1970, in the
    future). An entry is kept when its last occurrence, truncated to the second, is at or after
    `start`.
  - `detail`: `summary` or `standard`, default `standard`.
- **Why**: FR-004 to FR-006, the shared matcher. A future `start` is a validation error, as for
  the logbook, not an empty result.

## R5. Order

- **Decision**: entries in order of last occurrence, oldest first, then by logger, then by source
  path and line (FR-007). The instance's own order (newest first, R1) is not kept.
- **Why**: every other document lists time forward; the tie-break makes the order total.

## R6. Document layout

- **Decision**: `domusops.system_log/0.1`, minified JSON. After the envelope (data-model §2):
  - `custom`: the custom integrations named by the listed entries, in name order; absent when
    none.
  - `files`: the paths of the sources and of the frames in `parts`, each once, in order of first
    use.
  - `parts`: every distinct frame, and every traceback line that appears more than once in the
    document, each once, in order of first use. A frame is `[file, line, function]` or
    `[file, line, function, code]`, `file` an index into `files` and `code` the frame's indented
    lines below its `File` line, verbatim (source line and caret lines). A line is a string. A line
    that appears once stays inline in its traceback.
  - `entries`: `{ "YYYY-MM-DD": [entry, ...] }`, by the local date of the last occurrence. An entry
    is positional, trailing `null` values dropped:
    `[time, level, logger, integration, source, count, messages, first, traceback, by_source]`.
    - `time`: the last occurrence, `HH:MM:SS`, with `±HH:MM` when its offset differs from
      `utc_offset`.
    - `level`: `warning`, `error` or `critical`.
    - `integration`: the domain, or `null`.
    - `source`: `[file, line]`, `file` an index into `files`.
    - `messages`: the list as the instance keeps it, redacted (R8).
    - `first`: the first occurrence, `null` when equal to the last to the second; `HH:MM:SS` when
      on the same date, else local ISO 8601; an offset as for `time`.
    - `traceback`: a list of items, each an index into `parts` or a string of one or more lines
      that appear once; `null` when there is none.
    - `by_source`: `1` when the integration came from the source (R3).
- **Why**: FR-016. The prototype (R12) shows where the bytes go: the messages are unique text and
  cannot shrink; the gain comes from frames and lines repeated across tracebacks (the coordinator,
  platform and HTTP client frames that many integrations share, the `Traceback (most recent call
last):` header and the chaining sentences), from file paths given once, from the dropped keys,
  and from times to the second grouped by date.
- **Rejected**:
  - Splitting each traceback into structured exceptions: chained and grouped exceptions have
    several textual forms, and the decoder must restore the text exactly.
  - Dropping caret lines: they cannot be restored.
  - Templates for messages: messages of different entries rarely share a long text.
  - Keeping a frame that appears once inline as text: its path is then written in full every
    time, and the prototype drops from 2.05 to 1.93.
  - Grouping entries by integration: FR-007 asks for one time order.

## R7. Paths

- **Decision**: in sources, frames and messages, three roots are replaced by fixed markers, in
  this order, the first that applies:
  1. `{config}/`: the instance's `config_dir` from `get_config`, followed by `/`.
  2. `{ha}/`: the directory of the instance's `homeassistant` package, that is a path up to and
     including its last `/homeassistant/` segment (`/usr/src/homeassistant/homeassistant/` in the
     container image, `…/site-packages/homeassistant/` in a virtual environment).
  3. `{python}/`: a path up to and including `/lib/python<major>.<minor>/` (the standard library
     and `site-packages`).
     Any other absolute path stays. The sources the instance makes relative (R1) are kept as given.
     The markers cannot be confused with a path: every path they replace is absolute.
- **Why**: clarification of 2026-11-13, FR-009. On a core or virtual environment installation the
  three roots lie under the home directory of the host's user.
- **Rejected**: keeping only the file name of other absolute paths (option C of the
  clarification); detecting the roots from the sources (the sources are already relative).

## R8. Redaction

- **Decision**: after R7, each message and each traceback goes through the snapshot's string rules
  (`redactString` of `snapshot/redact.ts`, exported for it): the configured token, URL user info,
  credential query parameters, JWTs, bearer tokens, e-mail addresses, coordinate pairs and the
  instance's own coordinates, each replaced in place by the redaction marker. Frames are parsed
  after redaction. Logger names, file paths and line numbers are not redacted.
- **Why**: FR-009; the same rules as the other tools' text values, and no new one.
- **Measured**: on the probe, `someone@example.com`, `admin:hunter2@` in a URL and
  `40.4168, -3.7038` are caught by the existing rules; `192.0.2.5` is not a coordinate and stays.

## R9. Size limit

- **Decision**: `DOMUSOPS_SYSTEM_LOG_MAX_BYTES`, default 100,000, read with the shared `readLimit`.
  A larger result, at either detail, is refused with `tooLargeSystemLog(entries, bytes, limit,
detail)`: kind `too_large`, "The result has N entries and would be B bytes, above the limit of L
  bytes". The remediation for `standard`: "Use detail=summary to see which integrations are
  logging, or narrow the query with integrations, exclude, level, or start; to allow larger
  results, raise DOMUSOPS_SYSTEM_LOG_MAX_BYTES". For `summary`: "Narrow the query with
  integrations, exclude, level, or start; to allow larger results, raise
  DOMUSOPS_SYSTEM_LOG_MAX_BYTES".
- **Why**: FR-010. At the default 50 entries the prototype's document is about 14 KB; an instance
  configured for hundreds of entries, or with very long tracebacks, can exceed the limit.

## R10. Summary

- **Decision**: the same read and filters. The document gives `counts: { entries, occurrences }`,
  `by_integration: { <domain>: { <level>: [entries, occurrences] } }` in domain order with levels in
  severity order, `without_integration: { <level>: [entries, occurrences] }` when some entries
  have no integration, and `custom` as in R6. No message, source or traceback.
- **Why**: FR-012, clarification of 2026-11-13.

## R11. Times

- **Decision**: `utc_offset` is the instance's offset at the time of the call; each time is local,
  to the second, with its own offset only when it differs (R6). There is no window; the envelope
  echoes `start` when given, as local ISO 8601.
- **Why**: FR-008. The log covers the time since the last restart, rarely a daylight-saving
  change.

## R12. Compression ratio and its floor

- **Facts**: a prototype of R6 on a synthetic log of 50 entries (coordinator and HTTP client
  failures with shared frames, platform setup errors, custom integration errors with tracebacks,
  library warnings, repeated warnings): raw answer 27,747 bytes, document 13,540 bytes, ratio
  2.05. Without the shared `parts`, `files` and date grouping, 1.62. On the probe's 8 entries of
  either release, 1.45. The messages are 30% of the document and do not shrink.
- **Decision**: `rawBytes` is the UTF-8 size of the selected entries as received. CI asserts a floor
  of 1.8 for `standard` on the reference fixture (`generate-system-log.ts`, R14). The sandbox test
  asserts the ratio is reported and above 1, measured on each release before the container test is
  written.
- **Why**: §4 has no exemption. The floor is the lowest of the tools because a log entry is mostly
  free text that appears once: what repeats is the structure and the tracebacks, and both are
  folded. 1.8 sits under the prototype's 2.05 without hiding a regression; `summary` is the compact
  view when the entries do not fit.
- **Rejected**: a floor of 2, the state tool's, which the prototype reaches with no margin.

## R13. Decoder

- **Decision**: `expandSystemLog(document)` in `@domusops/schema` returns the entries in the
  document's order: `{ level, logger, integration, integration_from, custom, source: { file, line
}, count, first_occurred, last_occurred, messages, traceback }`. `integration_from` is `logger`,
  `source` or `null`; times are local ISO 8601 with their offset; `traceback` is the text, rebuilt
  from `parts` and the strings joined by newlines, a frame as
  `  File "<file>", line <line>, in <function>` followed by its `code` lines; `null` when there is
  none. Paths keep the markers of R7.
- **Why**: FR-016. The round-trip test compares the decoder's output with the redacted, re-rooted
  input, times compared to the second.

## R14. Test instance

- **Decision**:
  - `packages/mcp/test/fixtures/generate-system-log.ts`: a deterministic synthetic log of 50
    entries with the prototype's mix (R12), every name generated from the seed, every path under
    the container's three roots, plus one entry of each R1 form (relative source, absolute source,
    `<template>` frame, chained traceback, five messages, `py.warnings`).
  - The simulated instance answers `system_log/list` from such a log, newest first, and
    `invalid_format` for any parameter.
  - The sandbox container test writes a temporary configuration with a synthetic custom
    integration that logs on a service call, as the probe did; the test harness calls that service
    and `system_log.write`, the server never does (FR-019).
- **Why**: SC-001, SC-002, SC-006. The fake follows the measured behaviour, and the sandbox test
  checks it against the real releases.

## R15. ha_ping, notes and release

- **Decision**:
  - `REQUIREMENTS` gains `ha_system_log: { admin: true, integrations: ["system_log"] }`, the row
    the ping test already expects, and the tool registers after `ha_history` and before
    `ha_ping`.
  - Notes, after the document: the exclusion note, the existing `exclusionNote`; then "Note: the
    system log is empty." when the instance answered no entry, or "Note: no log entry matched the
    query." when the filters left none.
  - Minor changesets for `@domusops/mcp` and `@domusops/schema`. The Version Packages pull request
    (#36) is merged after this feature, releasing 0.2.0.
- **Why**: FR-011, FR-018, FR-021.
