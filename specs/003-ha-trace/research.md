# Research: ha_trace

Phase 0 output for [plan.md](./plan.md). Every open question from the Technical Context is
resolved here. Facts about Home Assistant traces were verified against the `home-assistant/core`
source at tag `2026.9.3` (`homeassistant/components/trace/`, `helpers/trace.py`,
`components/automation/`) on 2026-09-26, not recalled from memory. Measurements come from the
maintainer's live instance (2026.9.3; 20 automations and 15 scripts, 92 stored traces) on the same
day. Only aggregate numbers were recorded: no entity ID, configuration, variable, or message left
the probe.

Decisions inherited unchanged from [001 research](../001-ha-snapshot/research.md) and
[002 research](../002-ha-logbook-query/research.md): the WebSocket client, handshake, and version
floor `2025.1.0` as a refusal threshold; the MCP result shape; the ratio definition; the
administrator check through `auth/current_user`; the window grammar and time-zone resolution
(002 R3); the selector grammar (002 R4); the compact context ID (002 data-model §3.2); the
redaction rules, including C2 and C3 (002 R10); and the test tooling.

## R1. Trace commands and their semantics

**Decision**: Use three read commands. No other `trace/*` command is allowlisted.

| Command          | Parameters sent                     | Returns                                                  |
| ---------------- | ----------------------------------- | -------------------------------------------------------- |
| `trace/list`     | `domain` (`automation` or `script`) | Short records of every stored trace of that domain       |
| `trace/contexts` | none                                | A map from context ID to one `{run_id, domain, item_id}` |
| `trace/get`      | `domain`, `item_id`, `run_id`       | The extended record of one trace, or error `not_found`   |

`trace/list` also accepts `item_id`, which this tool never sends: one call per domain returns
every trace, and filtering happens after resolution (R3). `trace/contexts` also accepts `domain`
and `item_id` together; not needed (R4).

**Verified behaviour** (source):

- **Short record** (`trace/list`): `last_step`, `run_id` (32 hex characters), `state` (`running`
  or `stopped`), `script_execution` (null while running; then `finished`, `failed_conditions`,
  `failed_single`, `failed_max_runs`, `cancelled`, `aborted`, `error`, `not_triggered`, and other
  values the instance may add), `timestamp.start`, `timestamp.finish` (null while running),
  `domain`, `item_id`, `error` (only when set), `not_triggered` (only when true), and for
  automations `trigger` (a description string, or null).
- **Extended record** (`trace/get`): the short record plus `trace` (a map from step path, such as
  `action/1/choose/0/conditions/0`, to a list of step records), `config` (the configuration the
  run executed), `blueprint_inputs` (or null), and `context` (`id`, `parent_id`, `user_id`).
- **Step record**: `path`, `timestamp`, and optionally `changed_variables` (only variables that
  changed since the previous step; the first step carries `this` and `trigger`), `result`,
  `child_id` (`{domain, item_id, run_id}` of a script run this step started), `error`, and
  `template_errors` (a list of strings).
- **Timestamps** are UTC ISO strings from Python's `isoformat()`: `+00:00` suffix, six digits of
  microseconds, and no fraction at all when the microsecond is zero.
- **Storage.** The instance keeps `stored_traces` traces per item (default 5, configurable per
  automation or script), in memory, saved on a clean stop and restored on first use. A crash loses
  the traces recorded since the last clean stop.
- **Debug commands** (`trace/debug/breakpoint/*`, `trace/debug/step`, `trace/debug/continue`,
  `trace/debug/stop`, `trace/subscribe_breakpoints`) control running scripts. They are never
  allowlisted (spec FR-017).
- **Absent integration.** `trace` is loaded as a dependency of `automation` and `script`. When it
  is not in `get_config.components`, the commands do not exist; the tool reports
  `traces_unavailable` without sending them.

**Alternatives considered**: `trace/list` with `item_id` per selected item (one call per item;
more round trips, same data); reading the storage file (not reachable over the API, and stale).

## R2. Privileges

**Decision**: Keep the administrator requirement and check it first, as the other tools do.

**Rationale**: Every `trace/*` command is decorated with `@websocket_api.require_admin`. Confirmed
live: `trace/list` with the maintainer's non-administrator token returned
`{"code": "unauthorized"}`. Unlike the logbook (002 R2), the requirement is the instance's own, so
the shared `not_admin` error is exactly right.

## R3. Resolving traced items

**Decision**: Resolve item IDs to entity IDs through the entity registry, and detect untraceable
automations through their state.

- A trace is keyed by `domain` and `item_id`. For an automation, `item_id` is the `id` in its
  configuration; for a script, it is the script's key. Both equal the entity registry's
  `unique_id` for that platform. Confirmed live: all 20 traced items resolved; in 19 of 35
  registry entries the entity ID's object part differs from the `unique_id`, so the object part
  cannot be used instead.
- An automation without an `id` has no registry entry and no traces. It is detected from
  `get_states`: an `automation.*` state without an `id` attribute. Every script has a key and is
  always traceable.
- A trace whose item has no registry entry (the automation or script was removed, or its ID
  changed) is identified as `<domain>:<item_id>`. The colon cannot appear in an entity ID, so the
  two forms never collide. Selectors match entity IDs only, so such traces are returned by
  unfiltered queries, run lookups, and context lookups, never by a selector.

**Item listing** for FR-004's reasons: the set of known traced items is the registry entries of
platforms `automation` and `script` plus the untraceable automations from `get_states`. A
selector that matches none of them, and no removed item, is `no_match`; a matched item with no
stored trace at all is `no_stored_runs`; a matched item whose stored traces all started outside
the window is `none_in_window`; a matched untraceable automation is `untraceable`.

## R4. Retrieval strategy

**Decision**:

| Request            | Commands                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Every request      | `auth/current_user`, `get_config`, `config/entity_registry/list`, `get_states`                                                               |
| `summary`          | `trace/list` for each domain a selector can match, `trace/contexts`, and `trace/get` for each selected run the context map does not point to |
| `standard`         | As `summary`, then `trace/get` for each selected run                                                                                         |
| Run identifier     | `trace/list` for both domains to find the run's item, then `trace/get`                                                                       |
| Context identifier | `trace/contexts` (does any trace have it?), `trace/list` for both domains, then `trace/get` for candidates (below), keeping exact matches    |

`trace/contexts` maps each context to one trace only: when several traces share a context (an
automation run and the script runs it started, R8), later ones overwrite earlier ones in the map.
It answers whether a context has any trace, exactly, but not which ones, and it gives `summary`
the context of only the runs it points to; the others are read from their extended records (live:
30 of 92). The candidates are
therefore the traces whose start is not before the context's creation time (a ULID's first ten
characters; live, runs started 0 to 14.9 s after their context), or every trace when the context
ID is not a ULID. Each candidate is fetched and kept when its `context.id` is the requested one.

`trace/get` requests are sent concurrently, up to 8 in flight, on the one connection. Live: 92
sequential requests took 598 ms; a full retrieval of everything took 707 ms. Timeouts are those of
002: 10 s per metadata command, and the 30 s overall deadline.

**Alternatives considered**: Per-item `trace/contexts` calls to avoid the overwrite (one call per
item, and still lossy when two runs of one item share a context).

## R5. Live measurements

| Measure                                          | Value                                |
| ------------------------------------------------ | ------------------------------------ |
| Stored traces                                    | 92 (56 automation, 36 script)        |
| Items with traces / known items                  | 20 / 35                              |
| Raw extended records, all traces                 | 435,362 bytes                        |
| Per trace (min / median / p90 / max)             | 1,620 / 4,344 / 6,667 / 17,544 bytes |
| Steps per trace (min / median / max)             | 1 / 6 / 89                           |
| Distinct configurations                          | 20 of 92 traces (29,613 bytes)       |
| Share of raw: `config`                           | 32.1%                                |
| Share of raw: `this` / `trigger` variables       | 10.5% / 10.4%                        |
| ISO timestamps in raw / their bytes              | 1,522 / 51,748                       |
| ULIDs in raw                                     | 564                                  |
| Outcomes                                         | 91 `finished`, 1 `failed_conditions` |
| Not-triggered traces                             | 0                                    |
| Steps that started a script / child still stored | 37 / 30                              |
| Short records, both domains, plus contexts       | 37,458 bytes                         |

## R6. Compression approach for `standard`, and the floor

**Decision**: `standard` is lossless (spec FR-009). It uses a configuration table, a string table,
a table of repeated subtrees, positional steps, exact timestamp offsets, compact context IDs,
positional state and context objects, and state deltas (a run's `this` against its item's
constant attributes, a trigger's `to_state` against its `from_state`) ([data-model §3](./data-model.md#3-standard-document)). The
CI floor is **3** on the reference fixture. Maintainer decision, 2026-09-26.

**Measured** (prototypes over the live traces; "per item" is the typical query, one item's stored
runs; per-item figures are the aggregate over all items):

| Encoding                                        | All traces | Per item (aggregate, median, min) |
| ----------------------------------------------- | ---------- | --------------------------------- |
| Configuration table only                        | 1.70x      |                                   |
| + positional steps, subtree and string tables   | 2.82x      | 2.57x                             |
| + timestamp offsets, compact IDs, state objects | 3.32x      | 3.10x, 3.21x, 1.31x               |
| + state deltas (`this`, trigger `to_state`)     | 3.51x      | 3.26x, 3.36x, 1.33x               |
| Lossy: without `this`                           | 3.97x      | 3.65x                             |
| Lossy: without `this` and `config`              | 5.22x      | 4.70x, 4.83x, 2.71x               |
| Lossy: also only changed trigger attributes     | 5.39x      | 4.87x, 5.00x, 2.71x               |

**Rationale**: Traces are far less repetitive than registries or logbooks. The configuration is
a third of the raw data and occurs once per item even in a one-item query; free text (AI prompts,
notification texts) does not compress by templating. 5x is not reached reliably even after
dropping the configuration, `this`, and trigger attributes, and dropping the configuration would
leave step paths such as `action/1/choose/0` without the definition they point to. The typical
lossless response is small in absolute terms (per item: median 6.5 KB, largest 16 KB), which is
what constitution §4 protects; the size limit (R12) bounds the rest. The spec's floor of 5 (FR-019,
SC-001) is replaced by 3, measured on the fixture, with the live ratio recorded (SC-008).

**Alternatives considered**: The three lossy rows above (rejected: loss of diagnostic content,
and still below 5). Without the state deltas the per-item aggregate is 3.10x, too close to the
floor; they are kept.

## R7. Step order

**Decision**: Steps are emitted in timestamp order, ties broken by the recorded order (path order
in the trace map, then position in the path's list). The decoder rebuilds the map by grouping
steps by path, paths in order of first appearance.

**Rationale**: The trace map is insertion-ordered and each step is timestamped when it is
created, so sorting by time gives execution order and regrouping gives the map back. Confirmed
live: regrouping reproduced the raw map for 92 of 92 traces, with no equal timestamps. A clock
that steps backwards could break the property; the encoder then keeps the recorded order and marks
the run (`steps_order: "recorded"`), so the output stays lossless. `last_step` equalled the last
path of the map in 92 of 92 traces; it is emitted only when it does not.

## R8. Context identifiers

**Decision**: Emit context IDs in the compact form of `ha_logbook_query` (002 data-model §3.2):
`"<offset>:<last 16 characters>"`, the offset relative to the start of the second of the run's
start. Accept as input the full 26-character ULID, the compact form from either tool, or a
non-ULID ID verbatim. Two ULIDs refer to the same context when their last 16 characters (the
80-bit random part) are equal; the offset only locates the ID in time. Non-ULID IDs match exactly.

**Rationale**: The offset of the same context differs between the tools (relative to an event's
second in the logbook, to the run's second here), so string equality would fail. The random part
alone identifies a context: the chance of two of the instance's stored contexts sharing it is
negligible. Confirmed live: all 92 run contexts are ULIDs; 30 script runs share their parent's
context; `parent_id` is set on 73 and `user_id` on none.

**Consequence for the spec**: FR-011 and SC-007 hold with "matches" read as "has the same last 16
characters". The tool description and the data model say so.

## R9. Links between runs

**Decision**: A step's `child_id` is emitted as a reference to the child run (`[item, run_id]`),
whether or not the child run is in the response or still stored.

**Rationale**: `child_id` is the instance's own link from a step to the script run it started,
more precise than a shared context (a script started through `script.turn_on` runs in a new
context). Live: 37 steps started a script; 30 of those child runs share the parent's context; 7
were already evicted by the script's own 5-run limit. An evicted child is still named, and a run
lookup for it returns `run_not_found`, which is the truth.

## R10. Not-triggered traces

**Decision**: Include them, as stored traces with outcome `not_triggered`, counted separately.

**Rationale**: From 2026.7.0, when a trigger evaluates a relevant change but does not fire, the
instance records a trace with `not_triggered: true`, `script_execution: "not_triggered"`, a
trigger step whose `result` holds the diagnostic, and a new context whose `parent_id` is the
change's context. They are kept in their own bucket per item, of the same size, so they never
evict runs. They answer the most common diagnostic question ("why did it not run?"), which a run
trace cannot. Older instances simply have none. Live: 0, so the fixture carries them.

**Consequence for the spec**: "stored runs" include not-triggered traces; the spec gains a
Planning clarification, a scenario, and the outcome value.

## R11. Redaction

**Decision**: Redact each extended (or short) record with the shared `redactRows`, before
encoding, with the instance's coordinates (rule C3) and this exemption set: every identifier key
`ha_snapshot` exempts (`entity_id`, `device_id`, `area_id`, `floor_id`, `config_entry_id`,
`config_subentry_id`, `entry_id`, `via_device_id`, `parent_device_id`, and the rest of its list),
plus `run_id`, `item_id`, `domain`, `id`, `parent_id`, `user_id`, `path`, and `last_step`. Traces
carry these identifiers in device triggers, conditions, and action targets, and FR-015 keeps them.
The redaction rules work on key names and on patterns inside text; none of them matches a bare
hexadecimal ID, so the exemption pins FR-015 against a future rule rather than fixing a current
leak.

**Rationale**: The record kinds are new, but the walk is the same. `id` covers context IDs and the
automation's own `id` in its configuration and in `this`; `path` and `last_step` are positions. Everything else is walked:
variables, results (service call parameters, AI responses), error texts, template errors, the
configuration (YAML automations have `!secret` values already substituted), and blueprint inputs.
Redaction happens before `compression_ratio` is measured, as in the other tools, and the raw side
is the unredacted retrieval.

## R12. Size limit

**Decision**: `DOMUSOPS_TRACE_MAX_BYTES`, a positive integer, default `100000`, applied to the
emitted document at both detail levels (spec Clarifications).

**Rationale**: Same default as the logbook, for one mental model. Live: a `summary` costs about
150 bytes per run, so about 650 runs (130 items at the default 5) fit; the largest one-item
`standard` response is 16 KB; `standard` for all 92 traces is about 124 KB and is refused, with
`summary` suggested. The limit is read on every call; an invalid value is `config_invalid`.

## R13. Time representation

**Decision**: The document states the instance's time zone. A run's start is a local ISO
timestamp with microseconds and offset in `standard` (exact) and a local `YYYY-MM-DD HH:MM:SS` in
`summary`. Durations and step times are milliseconds from the run's start, with up to three
decimals (exact microseconds). A timestamp inside a variable or result is an offset from the run's
start in the same unit, marked as a timestamp ([data-model §3.2](./data-model.md#32-value-encoding)).

**Rationale**: Readable times where the agent reasons (when did the run start), exact small
numbers where it measures (how long did each step take), and 12% of the raw data saved by not
repeating ISO strings. Only canonical `isoformat()` strings are encoded, so decoding reproduces
them exactly; anything else stays a literal.

## R14. Selection and window

**Decision**: Selectors as in 002 (grammar, limits, deduplication), matched against the entity IDs
of known traced items (R3). The window applies when `start` or `end` is given, with 002's
defaults for the missing side (start: end minus 24 hours; end: the time of the call); a run is
selected when its start is within it. Without either, every stored trace is selected. A run or
context identifier cannot be combined with selectors, a window, or each other
(`selection_invalid`). A run identifier must be 32 lowercase hexadecimal characters; a context
identifier must be a ULID, a compact ID, or at most 64 printable ASCII characters.

## R15. Shared code

**Decision**: Generalise in place, as in 002 R11:

- `ha/client.ts`: allowlist `trace/list`, `trace/get`, `trace/contexts`, each with its own closed
  parameter set; debug commands stay out.
- `ha/config.ts`: `readTraceLimit`, beside `readLogbookLimit`.
- `errors.ts`: new kinds `traces_unavailable`, `run_not_found`, `selection_invalid`; `too_large`
  gains a variant counting runs.
- `logbook/window.ts`, `logbook/selectors.ts`, `logbook/local-time.ts`: reused as they are.
- `snapshot/redact.ts`: `redactRows` with a new exemption set; `snapshot/ratio.ts`: `finalize`.
- `@domusops/schema`: `logbook/ulid.ts` is reused by the trace format for compact context IDs.

## R16. Reference fixtures

**Decision**: A seeded generator produces traces calibrated to R5: per-item configurations of
realistic size, `this` and `trigger` variables with full state objects, `choose` and `repeat`
paths, child script runs sharing their parent's context (and some evicted), service-call results,
a free-text share, not-triggered traces, a running trace, an `error` outcome, a removed item, and
an untraceable automation. The CI floor (3) is asserted on its reference set (20 items, 5 runs
each). A hand-written redaction fixture plants a token in action data, a secret in a
configuration URL, coordinates in trigger state attributes, and an e-mail address in an error.
A 100-item, 500-run set is the performance fixture (SC-004).
