# @domusops/mcp

## 0.1.2

### Patch Changes

- cdc0812: A `ha_trace` call with `start` or `end` now says which automations and scripts may have discarded runs from the window: a text block after the unchanged document names each one (at most 10) that already stores as many runs as it keeps, with its `stored_traces` limit, and explains how to keep more. An empty result is no longer mistaken for "nothing ran". The limit is read with `automation/config` or `script/config`, only for those candidates. Calls without a window return exactly what they did before.
- 0cf960a: `ha_logbook_query` and `ha_trace` accept `exclude`, a list of entity IDs and `*` patterns in the same form as `entities`, applied after it: the matching entities, automations and scripts are left out of the result, its counts, its size check and its `compression_ratio`, so a broad pattern stays usable and a result refused for size can fit. When `exclude` is given, a text block after the unchanged document lists what was excluded. Calls without `exclude` return exactly what they did before.
- b3fca9e: The README now explains how to run the server: installed as a development dependency of the configuration repository (recommended, pinned by the lockfile, no download at start), globally, or on demand with `npx`. A Claude Code section covers registering and approving the server, keeping the token out of version control, and what to check when it does not connect. A new section names the `@domusops/schema` decoder for each tool and detail level, with an example that CI runs.
- 37c3412: The server reports its real version during the connection handshake instead of `0.0.0`, so a client can tell which release answered. The version is read from the installed package; a server that cannot read it refuses to start.

## 0.1.1

### Patch Changes

- 6b56db3: `ha_trace` now fails fast and never leaves a request hanging. After one stored trace fails to read, no further stored trace is read. Closing the connection ends every command still waiting with a "connection closed" error instead of leaving it unsettled. Reads that do not depend on each other run together, so a request waits for its longest chain of dependent reads instead of the sum of all of them. At `detail=standard`, a result that cannot fit the size limit is refused as soon as the runs read so far already exceed it, instead of after every stored trace has been read; the refusal then says "would be N bytes or more". A result that fits is unchanged.
- b520d21: Every package now ships its TypeScript sources next to `dist`, so the source maps and declaration maps in a package resolve from the package alone. `@domusops/schema` gains a README that says what the package is, how to install it, which formats it exports, and what stability it promises.
- Updated dependencies [b520d21]
  - @domusops/schema@0.1.1

## 0.1.0

### Minor Changes

- 7ac64f8: Add the `ha_logbook_query` tool: a read-only, redacted, compressed history of the logbook events of a time window, filtered by entity IDs or patterns, at `summary` or `standard` detail. A `standard` result above `DOMUSOPS_LOGBOOK_MAX_BYTES` (default 100000) is refused, never truncated.

  `ha_snapshot` now also redacts coordinates written as text (a latitude and longitude pair) and the instance's own coordinates wherever they appear in a string, so its output can contain more `[redacted]` markers. The `protocol_error` text now says "a bug in the DomusOps server" instead of "a bug in ha_snapshot", and the `retrieval_failed` next step no longer says "No snapshot was produced", since two tools share them. The instance's own coordinates are now matched as whole numbers: `20.4746` is no longer found inside `120.4746`.

- 2afee5a: Add the `ha_snapshot` tool: a read-only, redacted, compressed inventory of a Home Assistant instance at `summary`, `standard`, or `full` detail.
- 6ae8715: Add the `ha_trace` tool: a read-only, redacted, compressed record of the stored traces of automations and scripts (including not-triggered traces), selected by entity IDs or patterns, a start-time window, a run ID, or a context ID from `ha_logbook_query`, at `summary` or `standard` detail. `standard` is lossless. A result above `DOMUSOPS_TRACE_MAX_BYTES` (default 100000) is refused at either detail level, never truncated.

  `ha_trace` redacts secrets inside the value of an identifier key (`id`, `path`, `domain`, and the others it exempts) and inside objects under one, since a trace's variables can use those names. The `not_admin` next step of `ha_trace` and `ha_logbook_query` no longer mentions the snapshot; `ha_snapshot`'s text and redaction are unchanged.

### Patch Changes

- Updated dependencies [7ac64f8]
- Updated dependencies [2afee5a]
- Updated dependencies [6ae8715]
  - @domusops/schema@0.1.0
