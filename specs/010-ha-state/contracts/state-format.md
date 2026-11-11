# Contract: `domusops.state/0.1`

The document `ha_state` returns, published in `@domusops/schema` as `STATE_FORMAT`, the
`StateDocument` types, `stateJsonSchema` and the decoder `expandState`. The field rules are in
[data-model.md](../data-model.md); this file shows the shape. Every value below is synthetic.

## Standard

`ha_state` with `entities: ["light.*"]`, on an instance in `Europe/Amsterdam`:

```json
{
  "format": "domusops.state/0.1",
  "detail": "standard",
  "ha_version": "2026.10.0",
  "compression_ratio": 2.71,
  "time_zone": "Europe/Amsterdam",
  "utc_offset": "+02:00",
  "anchor": "2026-09-28T21:04:10+02:00",
  "selectors": ["light.*"],
  "templates": {
    "t1": {
      "const": {
        "color_mode": "brightness",
        "supported_color_modes": ["brightness"],
        "supported_features": 40
      },
      "cols": ["brightness", "friendly_name", "st.context", "st.last_changed"]
    }
  },
  "entities": {
    "light": {
      "t1": [
        [
          "hallway",
          "on",
          180,
          "Hallway",
          "-3600000:5Q2W8E4R6T1Y3U7I",
          "2026-09-28T20:04:10"
        ],
        [
          "kitchen",
          "on",
          255,
          "Kitchen",
          "0:9A8S7D6F5G4H3J2K",
          "2026-09-28T21:04:10"
        ],
        [
          "porch",
          "on",
          90,
          "Porch",
          "-7200000:1Z2X3C4V5B6N7M8P",
          "2026-09-28T19:04:10"
        ]
      ],
      "_": [
        {
          "id": "desk",
          "state": "off",
          "color_mode": null,
          "friendly_name": "Desk",
          "supported_color_modes": ["brightness"],
          "supported_features": 40,
          "brightness": null,
          "st.context": "-86400000:0P9O8I7U6Y5T4R3E",
          "st.last_changed": "2026-09-27T21:04:10",
          "st.last_updated": "2026-09-27T21:04:12",
          "st.parent_id": "-86400100:2W3E4R5T6Y7U8I9O"
        }
      ]
    }
  }
}
```

- `st.last_updated` is absent from `t1`: every light in it was updated when it changed.
- `st.parent_id` and `st.user_id` are absent where the instance gave `null`.
- The kitchen light's context, `0:9A8S7D6F5G4H3J2K`, can be passed to `ha_trace` or
  `ha_logbook_query` as `context`.

## Summary

`ha_state` with `detail: "summary"` and no filter:

```json
{
  "format": "domusops.state/0.1",
  "detail": "summary",
  "ha_version": "2026.10.0",
  "compression_ratio": 212.4,
  "time_zone": "Europe/Amsterdam",
  "utc_offset": "+02:00",
  "anchor": "2026-09-28T21:04:10+02:00",
  "counts": { "entities": 493, "domains": 12 },
  "by_domain": {
    "automation": [35, 0, 0],
    "binary_sensor": [98, 3, 1],
    "light": [44, 1, 0],
    "sensor": [223, 6, 4]
  }
}
```

(`by_domain` shortened.)

## Notes

Sent after the document, in this order (research R13):

```text
Note: excluded *_firmware. Counts, the size check and compression_ratio leave them out.
Note: no entity has the ID light.kitchn, light.hallwy.
Note: no entity matched the query.
```

## Errors

| Kind               | When                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selector_invalid` | `entities` or `exclude` breaks the selector rules (as in the other tools)                                                                                        |
| `input_invalid`    | `domain`, `state` or `attributes` breaks research R3, or `attributes` with `summary`                                                                             |
| `too_large`        | A `standard` result above `DOMUSOPS_STATE_MAX_BYTES` (default 100,000)                                                                                           |
| `not_admin`        | The token's user is not an administrator: states could be filtered                                                                                               |
| shared             | `config_missing`, `config_invalid`, `unreachable`, `auth_invalid`, `timeout`, `protocol_error`, `retrieval_failed`, `version_unsupported`, as in the other tools |
