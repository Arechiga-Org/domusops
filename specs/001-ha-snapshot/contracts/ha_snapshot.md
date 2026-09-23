# Contract: `ha_snapshot` MCP tool

Interface exposed by `@domusops/mcp` to any MCP client. The tool definition (name, description,
input schema, annotations) is in [ha_snapshot.tool.json](./ha_snapshot.tool.json). The snapshot
format itself is defined in [data-model.md](../data-model.md).

## Server

| Property         | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Launch           | `npx @domusops/mcp` (bin `domusops-mcp`)                     |
| Transport        | stdio                                                        |
| Tools advertised | `ha_snapshot` only                                           |
| Stdout           | MCP protocol traffic only                                    |
| Stderr           | Diagnostic lines, prefixed `[domusops-mcp]`; never the token |

## Configuration

Read on every invocation, not at startup (so the server always starts and advertises the tool).

| Variable            | Required | Form                                                                        |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `DOMUSOPS_HA_URL`   | yes      | `http://host[:port]` or `https://host[:port]` (a trailing slash is allowed) |
| `DOMUSOPS_HA_TOKEN` | yes      | Long-lived access token of an administrator user                            |

## Input

`{ "detail"?: "summary" | "standard" | "full" }`. Omitted means `standard`. Any other value is
rejected with a message that lists the accepted values, and no snapshot is produced. Unknown
properties are rejected or ignored, as the MCP SDK does; a test (T043) pins which.

## Successful result

```json
{
  "content": [{ "type": "text", "text": "<minified JSON snapshot>" }]
}
```

- Exactly one `text` block, holding one JSON document that conforms to
  `domusops.snapshot/0.1` at the requested detail level.
- No `structuredContent` (see [research R5](../research.md#r5-mcp-server-and-tool-result)).
- `isError` is absent or `false`.

## Failed result

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "ha_snapshot failed [<kind>]: <cause>. <next step>."
    }
  ]
}
```

- `<kind>` is one of the error kinds in [data-model §9](../data-model.md#9-errors).
- The text never contains the token, and never contains any snapshot data.
- There is no partial result: a failure after some retrievals succeeded still produces only this
  error.

## Guarantees

| Guarantee                                        | Source                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| No mutation of the instance under any input      | FR-018. Enforced by the client's command allowlist |
| Every entity ID present in `standard` and `full` | FR-008                                             |
| Redaction at every detail level                  | FR-013 to FR-017                                   |
| `compression_ratio` in every successful result   | FR-012                                             |
| `standard` ratio ≥ 10 on the reference fixture   | FR-023. Asserted in CI                             |
| Deterministic output for identical input         | data-model §3.3                                    |

## Versioning

The `format` field versions the snapshot document independently of the npm package versions.
Any change to the omission list, the defaults table, the redaction marker, or the document
structure is a format version change. While the project is in `0.x`, a minor bump
(`0.1` → `0.2`) may be breaking, and the `@domusops/schema` changeset must say so.
