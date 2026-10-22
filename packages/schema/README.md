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

An ES module with bundled type declarations. Node 22 or later.

## Formats

| Document                     | Identifier              | Detail levels         | Reference decoder                                      |
| ---------------------------- | ----------------------- | --------------------- | ------------------------------------------------------ |
| Snapshot of an instance      | `domusops.snapshot/0.1` | `standard`, `summary` | `expand`, with the record types `RawRecords` and so on |
| Logbook of an instance       | `domusops.logbook/0.1`  | `standard`, `summary` | `expandLogbook`                                        |
| Automation and script traces | `domusops.trace/0.1`    | `standard`, `summary` | `expandTrace`                                          |

For each format the package exports:

- the identifier as a constant (`FORMAT`, `LOGBOOK_FORMAT`, `TRACE_FORMAT`);
- the TypeScript types of its documents (`StandardDocument`, `LogbookStandardDocument`,
  `TraceStandardDocument` and the summary and envelope types);
- a JSON Schema that describes the document (`snapshotJsonSchema`, `logbookJsonSchema`,
  `traceJsonSchema`);
- the reference decoder, which restores the rows a document was made from, so a consumer can check
  that nothing was lost in the compression.

```ts
import {
  expandTrace,
  TRACE_FORMAT,
  type TraceStandardDocument,
} from "@domusops/schema";

function runsOf(text: string) {
  const document = JSON.parse(text) as TraceStandardDocument;
  if (document.format !== TRACE_FORMAT) throw new Error("not a trace document");
  return expandTrace(document);
}
```

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
