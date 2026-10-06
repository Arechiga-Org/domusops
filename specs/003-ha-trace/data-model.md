# Data Model: `domusops.trace/0.1`

The response format of `ha_trace`, a public contract published in `@domusops/schema` (FR-021).
Design rationale and measurements are in [research.md](./research.md). Configuration, redaction,
compact context IDs, and errors shared with the other tools are referenced, not repeated.

## 1. Input records (retrieved from the instance)

| Record          | Source command                | Used for                                                                                       |
| --------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Current user    | `auth/current_user`           | `is_admin` check only; never emitted                                                           |
| Core config     | `get_config`                  | `time_zone`, `components` (`trace` present), `latitude` and `longitude` (redaction rule C3)    |
| Entity registry | `config/entity_registry/list` | `entity_id` and `unique_id` of platforms `automation` and `script` (research R3); nothing else |
| States          | `get_states`                  | `automation.*` states without an `id` attribute (untraceable); nothing else                    |
| Short record    | `trace/list`                  | Selection, and every `summary` field except the context                                        |
| Context map     | `trace/contexts`              | Context lookups; the context of a run in `summary`                                             |
| Extended record | `trace/get`                   | Every `standard` field; the context of a run the context map does not cover                    |

A **short record** has `run_id`, `domain`, `item_id`, `state`, `script_execution`, `timestamp`
(`start`, `finish`), `last_step`, and optionally `trigger` (automations), `error`, and
`not_triggered`. An **extended record** adds `trace` (path → list of step records), `config`,
`blueprint_inputs`, and `context` (`id`, `parent_id`, `user_id`). A **step record** has `path`,
`timestamp`, and optionally `changed_variables`, `result`, `child_id`, `error`, and
`template_errors` ([research R1](./research.md#r1-trace-commands-and-their-semantics)).

Keys not listed are carried through (`standard` keeps unknown run keys in `extra`, §3.1; unknown
step keys make the step fall back to an object, §3.3), so newer instances stay lossless. Older
instances that lack a key are accepted.

**Traced item**: identified in the document by its entity ID, resolved through the registry; a
trace whose item is not in the registry is identified as `<domain>:<item_id>` (research R3).

## 2. Envelope (both detail levels)

| Field               | Type                        | Meaning                                                                                                                                                 |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`            | string                      | Always `"domusops.trace/0.1"`                                                                                                                           |
| `detail`            | `"summary"` \| `"standard"` | The detail level produced                                                                                                                               |
| `ha_version`        | string                      | Core version reported by the instance                                                                                                                   |
| `compression_ratio` | number                      | `raw_bytes / emitted_bytes`, two decimals (§6)                                                                                                          |
| `time_zone`         | string                      | The instance's IANA time zone                                                                                                                           |
| `utc_offset`        | string                      | `±HH:MM` at the time of the call; the default offset of every local time without one                                                                    |
| `selection`         | object                      | What was asked, resolved: `entities` (deduplicated, request order), `start` and `end` (local ISO to the second), `run`, `context`; each only when given |
| `counts`            | object                      | `{ items, runs, not_triggered }`: traced items with at least one selected trace, selected traces that are runs, selected not-triggered traces           |
| `no_runs`           | object                      | `{ no_match, no_stored_runs, none_in_window, untraceable }` (FR-004), each an array, present only when non-empty; absent when all are empty             |

`no_match` lists selectors in request order. `no_stored_runs` is a matched item with no stored
trace at all; `none_in_window` a matched item whose stored traces all started outside the window;
`untraceable` a matched automation without an `id`. The last three list items by entity ID, in
code-point order.

## 3. `standard` document

Example (values invented). An automation ran once and started a script:

```json
{
  "format": "domusops.trace/0.1",
  "detail": "standard",
  "ha_version": "2026.9.3",
  "compression_ratio": 3.41,
  "time_zone": "America/Mexico_City",
  "utc_offset": "-06:00",
  "selection": { "entities": ["automation.hallway_night"] },
  "counts": { "items": 1, "runs": 1, "not_triggered": 0 },
  "strings": ["binary_sensor.hallway_motion"],
  "values": [],
  "configs": [
    {
      "id": "1700000000001",
      "alias": "Hallway night",
      "triggers": ["..."],
      "actions": ["..."]
    }
  ],
  "ids": { "automation.hallway_night": "1700000000001" },
  "items": {
    "automation.hallway_night": {
      "this": {
        "entity_id": "automation.hallway_night",
        "attributes": { "id": "1700000000001", "mode": "single" }
      },
      "runs": [
        {
          "run": "0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b",
          "start": "2026-09-26T03:00:00.116474-06:00",
          "duration_ms": 412.508,
          "trigger": "state of binary_sensor.hallway_motion",
          "outcome": "finished",
          "context": "12:7Q3KXW2M9ZB4Y6AR",
          "config": 0,
          "steps": [
            [
              "trigger/0",
              0,
              0,
              {
                "this": {
                  "D": [
                    "this",
                    "on",
                    { "last_triggered": "@-86400000" },
                    [],
                    "@-86400000.2",
                    0,
                    0,
                    null
                  ]
                },
                "trigger": {
                  "entity_id": "#0",
                  "from_state": {
                    "S": [
                      "#0",
                      "off",
                      { "device_class": "motion" },
                      "@-600000",
                      0,
                      0,
                      { "C": ["-3:7Q3KXW2M9ZB4Y6AQ", null, null] }
                    ]
                  },
                  "to_state": {
                    "D": [
                      "from",
                      "on",
                      {},
                      [],
                      "@-0.5",
                      0,
                      0,
                      { "C": ["12:7Q3KXW2M9ZB4Y6AR", null, null] }
                    ]
                  }
                }
              }
            ],
            [
              "action/0",
              0.912,
              { "params": { "domain": "script", "service": "night_light" } },
              0,
              ["script.night_light", "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d"]
            ]
          ]
        }
      ]
    }
  }
}
```

### 3.1 Sections

| Field     | Form                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strings` | Strings referenced as `"#<n>"` (§3.2)                                                                                                                           |
| `values`  | Repeated subtrees referenced as `{ "$": <n> }` (§3.2). An entry may reference only lower-numbered entries                                                       |
| `configs` | Distinct configurations, each encoded without anchoring (§3.2); a run's `config` is an index                                                                    |
| `ids`     | Entity ID → item ID, for every entity-ID item named anywhere in the document (runs and child references) whose item ID differs from the entity ID's object part |
| `items`   | Traced item → `{ this?, runs }`, ordered by the start of their newest run, newest first, then by key                                                            |

`items.<item>.this` is the **`this` template** of the item: `entity_id` and the attribute
key-value pairs shared by every `this` state object in the item's runs in this document. It is
present only when at least one run carries such a state object.

A **run** is an object:

| Field                       | Form                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                       | The run ID, verbatim                                                                                                                  |
| `start`                     | Local ISO 8601 with offset; six fraction digits exactly when the raw timestamp had them (research R13)                                |
| `duration_ms`               | `finish − start` in milliseconds, up to three decimals; absent while running (`finish` null)                                          |
| `trigger`                   | Automations: the description, or null; absent for scripts                                                                             |
| `outcome`                   | `script_execution` when `state` is `stopped` and `script_execution` is a string; `"running"` when `state` is `running` and it is null |
| `state`, `script_execution` | Emitted verbatim instead of `outcome` for any other combination                                                                       |
| `error`                     | The run's error text, when present                                                                                                    |
| `not_triggered`             | `true`, when present (a not-triggered trace, research R10)                                                                            |
| `context`                   | Compact context ID (§3.2), anchored to the run                                                                                        |
| `parent_context`            | Compact ID of `context.parent_id`, when not null                                                                                      |
| `user`                      | `context.user_id`, when not null                                                                                                      |
| `config`                    | Index into `configs`, or null when the raw `config` is null                                                                           |
| `blueprint_inputs`          | Encoded without anchoring, when not null                                                                                              |
| `last_step`                 | Only when it differs from the last path of the rebuilt trace map (§3.3)                                                               |
| `steps_order`               | `"recorded"` when steps are in recorded order instead of time order (§3.3)                                                            |
| `extra`                     | Any unknown key of the extended record, verbatim, when present                                                                        |
| `steps`                     | Array of steps (§3.3)                                                                                                                 |

Runs of an item are ordered by start, newest first, then by run ID.

### 3.2 Value encoding

Applies to step results, variables, configurations, blueprint inputs, and `values` entries.
Values inside a run are **anchored** to that run: timestamps and context IDs are relative to it.
Configurations and blueprint inputs are **unanchored**: they are shared by runs, so neither form
below is produced in them.

| Emitted value                                   | Meaning                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"#<n>"`                                        | `strings[n]`                                                                                                                                                                                               |
| `"@<ms>"` (anchored only)                       | A UTC timestamp in canonical `isoformat()` form (`+00:00`, six fraction digits or none when zero): the run's start plus `<ms>` milliseconds, a decimal number with up to three decimals, possibly negative |
| `"<offset>:<16 characters>"` (anchored only)    | A ULID context ID in the compact form of [002 data-model §3.2](../002-ha-logbook-query/data-model.md#32-value-encoding), anchored to the second of the run's start                                         |
| `{ "$": <n> }`                                  | `values[n]`, decoded in the anchoring of the position that references it                                                                                                                                   |
| `{ "S": [e, s, a, lc, lu, lr, c] }`             | A **state object** (below)                                                                                                                                                                                 |
| `{ "D": [base, s, set, unset, lc, lu, lr, c] }` | A **state delta** (below)                                                                                                                                                                                  |
| `{ "C": [id, parent_id, user_id] }`             | A **context object** `{ id, parent_id, user_id }`; IDs in anchored compact form when they are ULIDs                                                                                                        |
| `{ "v": <literal> }`                            | The literal value, verbatim, for a literal that would otherwise be misread (below)                                                                                                                         |
| Any other value                                 | Literal; arrays and objects are encoded element by element; object keys are never encoded                                                                                                                  |

**Escapes**: a literal string beginning with `#` or `@`, or with the shape of a compact context ID,
and a literal object whose only key is `$`, `S`, `D`, `C`, or `v`, are emitted as `{ "v": ... }`.

**State object**: an object whose keys are exactly `entity_id`, `state`, `attributes`,
`last_changed`, `last_updated`, `last_reported`, `context`, with the first two and the three
timestamps strings, `attributes` an object, and `context` a context object or null. `lu` is `0`
when `last_updated` equals `last_changed`, `lr` is `0` when `last_reported` equals
`last_updated`; otherwise each is an encoded value. Any other object stays an object.

**State delta**: a state object expressed against a base with the same `entity_id`. `base` is
`"from"` (the `from_state` of the same trigger object; used for its `to_state`) or `"this"` (the
item's `this` template; used for the `this` variable). `attributes` is the base's attributes
without the keys in `unset`, with the pairs in `set` applied; `entity_id` is the base's. Emitted
whenever a base exists, so the form is determined by the input alone. The `this` base is used only
when the state's `entity_id` equals the template's, and the `from` base only when it equals the
`from_state`'s; otherwise the `S` form.

**Tables**: a string of at least 6 characters occurring at least twice in encodable positions
(including step paths, excluding object keys and compact IDs) goes into `strings`, ordered by
descending occurrence count, then by code point. An encoded array or object whose serialisation is
at least 16 bytes and occurs at least twice goes into `values`, children before parents, in order
of first occurrence. Tables are built after anchoring, so a shared subtree is identical relative to
each run that references it.

### 3.3 Steps

A step is an array: `[path, t, result, variables, child, error, template_errors]`.

| Position          | Form                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `path`            | The step path (string, or `"#<n>"`)                                                                 |
| `t`               | Milliseconds from the run's start, up to three decimals                                             |
| `result`          | Encoded value, or `0` when absent                                                                   |
| `variables`       | The changed variables, an encoded object, or `0` when absent                                        |
| `child`           | `[item, run_id]` of the script run it started, or `0` when absent; the child's domain is the item's |
| `error`           | Error text, or `0` when absent                                                                      |
| `template_errors` | Array of strings, or `0` when absent                                                                |

The run's `error` and `trigger`, and a step's `error` and `template_errors`, are literal text:
never encoded, never in the tables. Trailing `0` positions are omitted. A step record with an unknown key is emitted instead as an
object `{ "step": <the step record, encoded> }`, with `timestamp` replaced by `t`.

Steps are in **time order**: by timestamp, ties by recorded order (path order in the map, then
position in the path's list). The decoder rebuilds the map by grouping steps by path, paths in
order of first appearance. When that would not reproduce the recorded map (a clock that stepped
backwards), the encoder emits the recorded order instead and sets `steps_order: "recorded"`
([research R7](./research.md#r7-step-order)).

### 3.4 Determinism

Identical input produces byte-identical output: orders as stated in §2, §3.1, and §3.2; object
keys of the envelope in the order of §2, then `strings`, `values`, `configs`, `ids`, `items`; run
fields in the order of §3.1; encoded objects in their input key order. `configs` in order of first
use by the runs in document order.

## 4. `summary` document

Envelope (§2) plus:

| Field     | Form                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- |
| `columns` | Always `["run", "start", "duration_ms", "trigger", "outcome", "last_step", "context", "error"]` |
| `items`   | Traced item → array of rows, in the orders of §3.1                                              |

A row follows `columns`: `start` is local `YYYY-MM-DD HH:MM:SS`, with the offset appended when it
differs from `utc_offset`; `duration_ms` is rounded to an integer, or null while running;
`trigger` is null for scripts; `outcome` is `script_execution`, or `state` when that is null;
`context` is compact, anchored to the second of `start`; `error` is omitted when absent.

A run's context comes from `trace/contexts` when the map points to that run, and from its
extended record otherwise (runs sharing a context, research R4). `summary` contains no steps,
variables, or configuration (FR-008), and is subject to the size limit.

## 5. Projection

`standard` is lossless: `expandTrace(standard)` returns, for each run, the extended record after
redaction, equal to it by value (object key order is not preserved). `domain` and `item_id` are
recovered from the item and `ids`; `last_step` and the trace map from the steps (§3.3).

## 6. Compression ratio

`raw_bytes` is the UTF-8 byte length of the JSON array of the selected traces' records as
retrieved, before redaction: extended records for `standard`; for `summary`, each short record
plus the record that supplied its context (the context map entry, or the extended record).
`emitted_bytes` and rounding follow
[001 research R7](../001-ha-snapshot/research.md#r7-compression-ratio-measurement). An empty result
has a well-defined ratio below 1.

## 7. Redaction

The rules of [002 data-model §7](../002-ha-logbook-query/data-model.md#7-redaction) (K1, V1 to V6,
C1 to C3) apply to every record, before encoding. Exempt keys (identifiers and positions, never
redacted): the identifier keys exempt in `ha_snapshot` (`entity_id`, `device_id`, `area_id`,
`config_entry_id`, `entry_id`, and the rest of its list), plus `run_id`, `item_id`, `domain`,
`id`, `parent_id`, `user_id`, `path`, `last_step` ([research R11](./research.md#r11-redaction)).

In a trace, an exempt key skips only the key-name rules (K1 and the coordinate keys): its value, and
any object or array under it, still goes through the value rules (V1 to V6, C2, C3). Traces carry
user data under generic names (`id`, `path`, `domain` are also variable names), so a secret under
one of them must not escape. In `ha_snapshot` and `ha_logbook_query` an exempt value is left whole.

## 8. Errors

The kinds of [002 data-model §8](../002-ha-logbook-query/data-model.md#8-errors) apply, with the
prefix `ha_trace failed [<kind>]:`. `window_invalid` and `selector_invalid` are unchanged.
`history_unavailable` is not used. `not_admin` keeps its kind and cause, but its next step does not
refer to the snapshot (`ha_snapshot`'s own text is unchanged). Added or changed:

| `kind`               | Trigger                                                                                                   | Next step named in the message                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traces_unavailable` | `trace` missing from `get_config.components`, or a trace command is `unknown_command`                     | Traces come with the automation and script integrations (part of `default_config`); enable them                                                                                                       |
| `run_not_found`      | No stored trace has the run ID, or no stored trace ran in the context                                     | The instance keeps only the most recent traces per item (`stored_traces`); for a context, its cause may not be an automation or script; use `summary` to list what is stored                          |
| `selection_invalid`  | `run` or `context` combined with each other, `entities`, `start`, or `end`; a malformed run or context ID | The accepted combinations and forms (research R14)                                                                                                                                                    |
| `too_large`          | Emitted document above the size limit, at either detail level                                             | Run count, emitted size, limit; for `standard`: `summary`, a run or context ID, fewer items, or a shorter window; for `summary`: fewer items or a shorter window; or raise `DOMUSOPS_TRACE_MAX_BYTES` |

`config_invalid` also covers a `DOMUSOPS_TRACE_MAX_BYTES` that is not a positive integer.

## 9. Invariants (checked by tests)

1. `expandTrace(standard)` equals the redacted extended records of the selected traces, by value,
   in document order (FR-009, SC-002).
2. Every selected trace appears exactly once; no other trace appears.
3. Every selector in `no_match` matched no known item; every item in `no_stored_runs` has no
   stored trace; every item in `none_in_window` has stored traces, none in the window; every item
   in `untraceable` is an automation without an `id`.
4. Every reference resolves: `#n`, `{ "$": n }` (to a lower index inside `values`), `config`,
   `ids`, and `D` bases.
5. A run's `context` and the cause of the logbook events it produced have the same last 16
   characters (SC-007); a step's `child` names the run whose record the instance linked.
6. No fragment of six or more characters of any planted secret, coordinate, or e-mail address
   appears in the output, at both detail levels (SC-003).
7. Identical input gives byte-identical output.
8. `standard` on the reference fixture has `compression_ratio >= 3` (FR-019).
9. The emitted document never exceeds the configured limit; above it, `too_large` is returned and
   no run is (FR-020).
