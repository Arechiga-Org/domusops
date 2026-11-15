# Contract: `domusops.system_log/0.1`

The document `ha_system_log` returns, published in `@domusops/schema` as `SYSTEM_LOG_FORMAT`, the
`SystemLogDocument` types, `systemLogJsonSchema` and the decoder `expandSystemLog`. The field
rules are in [data-model.md](../data-model.md); this file shows the shape. Every value below is
synthetic.

## Standard

`ha_system_log` with no input, on an instance in `Europe/Madrid` whose log holds four entries:

```json
{
  "format": "domusops.system_log/0.1",
  "detail": "standard",
  "ha_version": "2026.10.0",
  "compression_ratio": 1.52,
  "time_zone": "Europe/Madrid",
  "utc_offset": "+01:00",
  "custom": ["acme_cloud"],
  "files": [
    "components/mqtt/client.py",
    "{ha}/components/mqtt/client.py",
    "{python}/site-packages/paho/mqtt/client.py",
    "custom_components/acme_cloud/api.py",
    "{config}/custom_components/acme_cloud/api.py",
    "{config}/custom_components/acme_cloud/__init__.py",
    "custom_components/acme_cloud/__init__.py",
    "helpers/template/__init__.py"
  ],
  "parts": [
    "Traceback (most recent call last):",
    [1, 598, "_async_connect", "    await self._mqttc.connect(host, port)"],
    [
      2,
      1435,
      "connect",
      "    return self.reconnect()\n           ~~~~~~~~~~~~~~^^"
    ],
    [4, 41, "get_state", "    return payload[\"state\"][\"value\"]"],
    [5, 88, "async_update", "    data = await self.client.get_state()"],
    [4, 43, "get_state", "    raise UpdateFailed(\"bad payload\") from err"]
  ],
  "entries": {
    "2026-11-13": [
      [
        "09:15:40",
        "error",
        "homeassistant.components.mqtt.client",
        "mqtt",
        [0, 612],
        3,
        [
          "Failed to connect to MQTT server due to exception: [Errno 111] Connection refused"
        ],
        "08:02:11",
        [0, 1, 2, "ConnectionRefusedError: [Errno 111] Connection refused"]
      ],
      [
        "09:20:05",
        "error",
        "custom_components.acme_cloud",
        "acme_cloud",
        [3, 41],
        1,
        ["Update failed for user [redacted]"],
        null,
        [
          0,
          3,
          "KeyError: 'value'\n\nThe above exception was the direct cause of the following exception:\n",
          0,
          4,
          5,
          "UpdateFailed: bad payload"
        ]
      ],
      [
        "09:30:00",
        "warning",
        "pyacme.client",
        "acme_cloud",
        [6, 120],
        7,
        ["Connection lost, reconnecting in 30 seconds"],
        "08:00:30",
        null,
        1
      ],
      [
        "09:31:12",
        "error",
        "homeassistant.helpers.event",
        null,
        [7, 466],
        1,
        [
          "Error while processing template: Template<template=({{ 1 / 0 }}) renders=2>"
        ]
      ]
    ]
  }
}
```

- The library logger `pyacme.client` names no integration; its source lies in `acme_cloud`'s
  directory, so the entry belongs to `acme_cloud` and ends with `1` (research R3).
- `homeassistant.helpers.event` is shared code: no integration.
- Sources are kept relative, as the instance gives them; frame paths have their root replaced
  (`{ha}/`, `{config}/`, `{python}/`, research R7).
- Every frame is a part; the traceback header appears three times and is a part too; every other
  line appears once and stays inline. Decoded, the second entry's traceback is the text the
  instance recorded, with `/config/` replaced by `{config}/`; the e-mail address of its message is
  redacted.

## Summary

The same log with `detail: "summary"`:

```json
{
  "format": "domusops.system_log/0.1",
  "detail": "summary",
  "ha_version": "2026.10.0",
  "compression_ratio": 4.95,
  "time_zone": "Europe/Madrid",
  "utc_offset": "+01:00",
  "custom": ["acme_cloud"],
  "counts": { "entries": 4, "occurrences": 12 },
  "by_integration": {
    "acme_cloud": { "warning": [1, 7], "error": [1, 1] },
    "mqtt": { "error": [1, 3] }
  },
  "without_integration": { "error": [1, 1] }
}
```

## Notes

Sent after the document, as separate text items, in this order (research R15):

```text
Note: excluded mqtt. Counts, the size check and compression_ratio leave them out.
Note: left out 2 entries at a level other than warning, error or critical.
Note: the system log is empty.
Note: no log entry matched the query.
```

At most one of the last two is sent.

## Errors

```text
The result has 50 entries and would be 131204 bytes, above the limit of 100000 bytes
Use detail=summary to see which integrations are logging, or narrow the query with integrations, exclude, level, or start; to allow larger results, raise DOMUSOPS_SYSTEM_LOG_MAX_BYTES
```

```text
The instance does not provide its system log
Make sure the system_log integration is loaded (Home Assistant loads it at startup unless the configuration prevents it), then try again
```

```text
The integration selector "mqtt.client" is not valid
Use an integration domain or a pattern made of lowercase letters, digits, underscores, and * (for example mqtt, hue*, or *_cloud)
```
