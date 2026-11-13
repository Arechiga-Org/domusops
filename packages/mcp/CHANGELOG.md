# @domusops/mcp

## 0.2.0

### Minor Changes

- ba7b79e: Adds `ha_history`, a read-only tool that returns how entities changed over a time window: for each one the state it had at the start of the window, then every recorded change with its time, its state and the attributes that changed, so an agent can tell when an attribute changed and to what without falling back to the raw API. `entities` and `exclude` take the same IDs and patterns as the other tools; `start` and `end` are read as `ha_logbook_query` reads them, with a default of the last 24 hours and a maximum of 10 days; `attributes` keeps only the attributes named and lists only the changes in which one of them, or the state, changed; `significant_only` keeps only the changes the instance considers significant. `detail=summary` gives the number of changes per domain, and per entity when `entities` is given. Times are in the instance's local time, to the second. A result above 100,000 bytes (`DOMUSOPS_HISTORY_MAX_BYTES`) is refused with the number of entities and changes. The instance's history records no cause; `ha_logbook_query` over the same window gives it. The snapshot's redaction applies; names stay visible. The tool needs the `history` integration, and `ha_ping` lists it; the other tools' outputs do not change.
- 851fe49: Adds `ha_ping`, a cheap, read-only tool that tells an agent, before any real query, whether the server can work with the connected instance. It reads only the current user and the instance's core configuration, and returns a small `domusops.ping/0.1` document: the server's name and version; the instance's version, the least version the server supports, whether it is supported, and its time zone; whether the token's user is an administrator; which integrations the tools need are loaded; and, for every other tool, whether it is ready and why not, with the steps to fix it. An instance older than the minimum is reported in the document instead of as an error; an unreachable address, a refused token, a timeout or a missing configuration fail as in the other tools. The token, the instance's address and location, and user names are never returned. The other tools' outputs do not change.
- a87d1c3: Adds `ha_state`, a read-only tool that returns what entities are doing right now: for each one its state, its attributes, when it last changed, was last updated and last reported, and the context of the change, so an agent no longer downloads the whole `ha_snapshot` inventory or falls back to the raw API to read one entity. `entities` and `exclude` take the same IDs and patterns as `ha_logbook_query` and `ha_trace`; `domain` and `state` narrow the selection; `attributes` keeps only the attributes named. `detail=summary` gives, per domain, how many entities there are and how many are `unavailable` and `unknown`. Times are in the instance's local time, and the context IDs can be passed to the `context` input of `ha_trace` and `ha_logbook_query`. A `standard` result above 100,000 bytes (`DOMUSOPS_STATE_MAX_BYTES`) is refused with the entity count, and a problem with `domain`, `state` or `attributes` is the new `input_invalid` error. The snapshot's redaction applies; names stay visible. `ha_ping` lists the new tool; the other tools' outputs do not change.

### Patch Changes

- Updated dependencies [adcc9cf]
- Updated dependencies [351d2e9]
- Updated dependencies [dea01a2]
  - @domusops/schema@0.2.0

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
