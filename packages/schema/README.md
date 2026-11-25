# @domusops/schema

The public formats that the DomusOps tools share, for Home Assistant: the shape of a compressed
snapshot, logbook and automation trace, with the reference code to read them back. Compatible with
Home Assistant; not affiliated with or endorsed by it.

The tools that produce these documents (`@domusops/mcp`) and the tools that check them
(`@domusops/sandbox`, `@domusops/bootstrap`) depend on this package, and it depends on none of
them. If you are building something that reads or writes DomusOps documents, this is the only
package you need.

## Install

```sh
npm install @domusops/schema
```

An ES module with bundled type declarations.

## Formats

| Document                     | Identifier                     | Detail levels                 | Reference decoder (reads)                   |
| ---------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------- |
| Snapshot of an instance      | `domusops.snapshot/0.1`        | `summary`, `standard`, `full` | `expand` (`standard` and `full` documents)  |
| Logbook of an instance       | `domusops.logbook/0.1`         | `summary`, `standard`         | `expandLogbook` (`standard` documents)      |
| Automation and script traces | `domusops.trace/0.1`           | `summary`, `standard`         | `expandTrace` (`standard` documents)        |
| Connection check             | `domusops.ping/0.1`            | none                          | none: it is read as it is                   |
| Entity states                | `domusops.state/0.1`           | `summary`, `standard`         | `expandState` (`standard` documents)        |
| Entity history               | `domusops.history/0.1`         | `summary`, `standard`         | `expandHistory` (`standard` documents)      |
| System log                   | `domusops.system_log/0.1`      | `summary`, `standard`         | `expandSystemLog` (`standard` documents)    |
| Scenario of a configuration  | `domusops.scenario/0.1`        | none                          | `normalizeScenarioDocument`, `resolveSuite` |
| Report of a scenario run     | `domusops.scenario-report/0.1` | none                          | none: it is read as it is                   |

A `summary` document counts and lists what exists but does not carry the rows, so it has nothing to
decode: check `document.detail` before calling a decoder.

For each format the package exports:

- the identifier as a constant (`FORMAT`, `LOGBOOK_FORMAT`, `TRACE_FORMAT`, `PING_FORMAT`,
  `STATE_FORMAT`, `HISTORY_FORMAT`, `SYSTEM_LOG_FORMAT`, with the levels `SYSTEM_LOG_LEVELS`,
  `SCENARIO_FORMAT`, `SCENARIO_REPORT_FORMAT`);
- the TypeScript types of its documents (`StandardDocument`, `LogbookStandardDocument`,
  `TraceStandardDocument`, `PingDocument`, `StateStandardDocument`, `StateRecord`,
  `HistoryStandardDocument`, `HistoryRecord`, `SystemLogStandardDocument`, `SystemLogRecord` and the
  summary and envelope types);
- a JSON Schema that describes the document (`snapshotJsonSchema`, `logbookJsonSchema`,
  `traceJsonSchema`, `pingJsonSchema`, `stateJsonSchema`, `historyJsonSchema`,
  `systemLogJsonSchema`, `scenarioJsonSchema`, `scenarioReportJsonSchema`);
- the reference decoder, which restores the rows a document was made from, so a consumer can check
  that nothing was lost in the compression. The ping document is not templated or compressed, so
  it has none.

```ts
import {
  expandTrace,
  TRACE_FORMAT,
  type TraceStandardDocument,
} from "@domusops/schema";

function runsOf(text: string) {
  const document = JSON.parse(text) as { format?: string; detail?: string };
  if (document.format !== TRACE_FORMAT) throw new Error("not a trace document");
  if (document.detail !== "standard")
    throw new Error("only standard documents carry runs");
  return expandTrace(document as TraceStandardDocument);
}
```

## Scenarios

A scenario states what an automation must do: a starting point (`given`), what happens (`when`)
and what must be true afterwards (`then`). Scenarios are YAML files next to the configuration they
test; this package defines the format and checks it, and `@domusops/sandbox` runs it against a
throwaway instance.

```yaml
# yaml-language-server: $schema=https://unpkg.com/@domusops/schema@0.3/schema/scenario.schema.json
format: domusops.scenario/0.1
scenario: study_night_motion
given:
  time: "03:00"
  presence.house: away
when:
  binary_sensor.study_motion: "on"
then:
  - input_number.study_brightness: 15
  - triggered: automation.study_night_motion
    times: 1
```

- `checkScenarioDocument(parsed)` returns every problem of a parsed document, each with a JSON
  Pointer `path`, a `code` and a message; an empty list means the document is valid. It reads no
  files and starts nothing. The YAML parsing, and the line and column of each issue, belong to
  the caller.
- `normalizeScenarioDocument(parsed)` turns a valid document into the form a runner executes, and
  `resolveSuite(files)` checks the names across the files of a suite and fills the defaults:
  the date 2026-04-15 (a Wednesday), the time 12:00:00, a time limit of 300 seconds.
- `compareValue(comparison, actual)` is the one rule expectations use to compare an expected value
  with an actual one: numbers and text that reads as a number compare as numbers, everything else
  as text.
- The JSON Schemas are also published as files, `schema/scenario.schema.json` and
  `schema/scenario-report.schema.json`, so an editor can complete and check a scenario file.
  They describe the shape; the names that must be unique across files and calendar days are
  checked by the functions above.

The first grammar covers a starting point with a date, a time and entity states; one step or a
list of steps that set states, call actions or fire events; and expectations on entity states and
attributes, automations triggered and actions called. A key the reader does not know yet is refused
with `unknown_key`, never ignored.

## Stability

This package is public and stable (constitution §5):

- A document says which format it is in its `format` field, and the identifier carries the
  version. Any change to the encoding, to a field, or to the redaction marker is a new identifier,
  never a silent change to an existing one.
- A new identifier is added next to the old one, so code written against `domusops.snapshot/0.1`
  keeps working.
- The package version moves independently of the formats: a release can fix a decoder or a type
  without changing a format.
- The package has no runtime dependencies.

Redacted values (secrets, tokens, coordinates and e-mail addresses) are replaced by a marker in
every document; the formats keep the field, so a reader can see that a value existed.
