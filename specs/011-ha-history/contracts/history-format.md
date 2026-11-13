# Contract: `domusops.history/0.1`

The document `ha_history` returns, published in `@domusops/schema` as `HISTORY_FORMAT`, the
`HistoryDocument` types, `historyJsonSchema` and the decoder `expandHistory`. The field rules are
in [data-model.md](../data-model.md); this file shows the shape. Every value below is synthetic.

## Standard

`ha_history` with `entities: ["device_tracker.phone_alpha", "sensor.attic_*"]`,
`start: "2026-09-28T08:00"`, `end: "2026-09-28T10:00"`, on an instance in `Europe/Amsterdam`:

```json
{
  "format": "domusops.history/0.1",
  "detail": "standard",
  "ha_version": "2026.10.0",
  "compression_ratio": 6.12,
  "time_zone": "Europe/Amsterdam",
  "utc_offset": "+02:00",
  "window": {
    "start": "2026-09-28T08:00:00+02:00",
    "end": "2026-09-28T10:00:00+02:00"
  },
  "selectors": ["device_tracker.phone_alpha", "sensor.attic_*"],
  "entities": {
    "device_tracker.phone_alpha": {
      "start": [
        "home",
        {
          "battery_level": 81,
          "friendly_name": "Phone Alpha",
          "gps_accuracy": 12,
          "latitude": "[redacted]",
          "longitude": "[redacted]",
          "source_type": "gps"
        },
        "2026-09-27T22:41:07"
      ],
      "changes": {
        "2026-09-28": {
          "08:00": [
            ["14:02", null, { "battery_level": 80, "gps_accuracy": 8 }],
            ["31:40", "not_home", { "gps_accuracy": 20 }]
          ],
          "09:00": [["05:11", null, { "battery_level": 79 }]]
        }
      }
    },
    "sensor.attic_temperature": {
      "start": [
        "19.4",
        {
          "device_class": "temperature",
          "friendly_name": "Attic temperature",
          "state_class": "measurement",
          "unit_of_measurement": "°C"
        }
      ],
      "changes": {
        "2026-09-28": {
          "08:00": [
            ["00:41", "19.5"],
            ["01:42", "19.6"]
          ],
          "09:00": [["58:03", "19.4"]]
        }
      }
    }
  }
}
```

Decoded, the phone's second change is `not_home` at `2026-09-28T08:31:40+02:00`, with
`battery_level` 80 and `gps_accuracy` 20, and `last_changed` equal to its own time. Its first
change keeps `home` with `last_changed` `2026-09-27T22:41:07+02:00`, the start's `since`.

## With `attributes`

The same call with `attributes: ["battery_level"]`: the change at 08:31:40 is listed because the
state changed; changes in which only `gps_accuracy` changed would be counted in `skipped`.

```json
{
  "device_tracker.phone_alpha": {
    "start": ["home", { "battery_level": 81 }, "2026-09-27T22:41:07"],
    "changes": {
      "2026-09-28": {
        "08:00": [
          ["14:02", null, { "battery_level": 80 }],
          ["31:40", "not_home"]
        ],
        "09:00": [["05:11", null, { "battery_level": 79 }]]
      }
    }
  }
}
```

## Summary

`ha_history` with `detail: "summary"` and no `entities`, over the default 24 hours:

```json
{
  "format": "domusops.history/0.1",
  "detail": "summary",
  "ha_version": "2026.10.0",
  "compression_ratio": 38.4,
  "time_zone": "Europe/Amsterdam",
  "utc_offset": "+02:00",
  "window": {
    "start": "2026-09-27T10:00:00+02:00",
    "end": "2026-09-28T10:00:00+02:00"
  },
  "counts": {
    "entities": 41,
    "changes": 9812,
    "state_changes": 9104,
    "attribute_only": 708
  },
  "by_domain": {
    "binary_sensor": [9, 212, 212, 0],
    "device_tracker": [2, 540, 18, 522],
    "light": [6, 188, 61, 127],
    "sensor": [24, 8872, 8813, 59]
  }
}
```

## Notes

Sent after the document, as separate text items, in this order (research R14):

```text
Note: excluded sensor.*_power. Counts, the size check and compression_ratio leave them out.
Note: no recorded history for the ID sensor.attic_humidity.
Note: no entity matched the query.
Note: no selected entity changed in the window.
```

## Errors

```text
The result has 3 entities and 9120 changes and would be 146210 bytes, above the limit of 100000 bytes
Use detail=summary to see which entities are busy, or narrow the query with a shorter window, fewer entities, exclude, or attributes; to allow larger results, raise DOMUSOPS_HISTORY_MAX_BYTES
```

```text
The time window is not valid: it is longer than 10 days
Use a window of at most 10 days; read a longer period in several calls
```

```text
The instance does not provide recorded state history
Enable the history and recorder integrations in Home Assistant (both are part of default_config), then try again
```
