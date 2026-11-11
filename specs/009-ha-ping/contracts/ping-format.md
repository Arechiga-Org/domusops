# Contract: the `domusops.ping/0.1` format

Published in `@domusops/schema` as `PING_FORMAT`, its TypeScript types and `pingJsonSchema`
(research R9). Fields and rules: [data-model.md](../data-model.md) §1 to §3.

## Example: a healthy instance

```json
{
  "format": "domusops.ping/0.1",
  "server": { "name": "domusops-mcp", "version": "0.2.0" },
  "instance": {
    "version": "2026.10.0",
    "minimum": "2025.1.0",
    "supported": true,
    "time_zone": "Europe/Amsterdam"
  },
  "admin": true,
  "integrations": { "logbook": true, "recorder": true, "trace": true },
  "tools": {
    "ha_snapshot": { "ready": true },
    "ha_logbook_query": { "ready": true },
    "ha_trace": { "ready": true }
  },
  "compression_ratio": 5.71
}
```

## Example: a user who is not an administrator, on an instance without traces

```json
{
  "format": "domusops.ping/0.1",
  "server": { "name": "domusops-mcp", "version": "0.2.0" },
  "instance": {
    "version": "2026.10.0",
    "minimum": "2025.1.0",
    "supported": true,
    "time_zone": "Europe/Amsterdam"
  },
  "admin": false,
  "integrations": { "logbook": true, "recorder": true, "trace": false },
  "tools": {
    "ha_snapshot": { "ready": false, "reasons": ["not_admin"] },
    "ha_logbook_query": { "ready": false, "reasons": ["not_admin"] },
    "ha_trace": {
      "ready": false,
      "reasons": ["not_admin", "integration_missing:trace"]
    }
  },
  "next_steps": [
    "Use a token of an administrator user: every tool reads administrator data",
    "Enable the trace integration in Home Assistant (it is part of default_config), then try again"
  ],
  "compression_ratio": 4.02
}
```

Both examples are pretty-printed here; the tool returns minified JSON. Values are invented.

## Rules a reader can rely on

- `format` identifies the version; a change that removes or renames a key, or changes a key's
  meaning, is a new version (constitution §5).
- `tools` and `integrations` may name entries a reader does not know: later features add tools
  and their integrations without a new version (spec FR-019). A reader ignores names it does not
  know.
- `reasons` entries are `version_unsupported`, `not_admin`, or `integration_missing:` followed
  by an integration name (`[a-z0-9_]+`).
- `next_steps` is absent when every tool is ready.

## Errors

An instance that never answered gives no document: the tool returns an error result with the
existing kinds (`config_missing`, `config_invalid`, `unreachable`, `auth_invalid`, `timeout`,
`protocol_error`) and their remediation text, as the other tools do (research R6).
