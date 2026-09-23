# Data Model: ha_snapshot

Phase 1 output for [plan.md](./plan.md). This document defines the snapshot format, format
version `domusops.snapshot/0.1`. The format is a public contract (spec FR-021, constitution §5).
Its TypeScript types, JSON Schema, constants, and reference decoder live in `@domusops/schema`.

All keys are `snake_case`, matching Home Assistant and the spec's `compression_ratio`. The
placeholder `HaSnapshot` type in `@domusops/schema` (camelCase `schemaVersion`,
`compressionRatio`) is replaced.

## 1. Input records (retrieved from the instance)

These are the raw payloads, with shapes as verified in [research.md](./research.md#r1-home-assistant-commands-and-privileges).
They are internal to the tool; only their projection appears in a snapshot.

| Record                | Source command                | Key fields                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core config           | `get_config`                  | `version`, `location_name`, `time_zone`, `country`, `language`, `currency`, `unit_system`, `latitude`, `longitude`, `elevation`, `radius`, `internal_url`, `external_url`, `config_dir`, `allowlist_external_dirs`, `allowlist_external_urls`, `components`, `state`, `safe_mode`, `recovery_mode`                                                                                                    |
| State                 | `get_states`                  | `entity_id`, `state`, `attributes`, `last_changed`, `last_updated`, `last_reported`, `context`                                                                                                                                                                                                                                                                                                        |
| Entity registry entry | `config/entity_registry/list` | `entity_id`, `id`, `unique_id`, `platform`, `config_entry_id`, `config_subentry_id`, `device_id`, `area_id`, `name`, `original_name`, `icon`, `entity_category`, `disabled_by`, `hidden_by`, `has_entity_name`, `translation_key`, `labels`, `categories`, `options`, `created_at`, `modified_at`                                                                                                     |
| Device                | `config/device_registry/list` | `id`, `name`, `name_by_user`, `manufacturer`, `model`, `model_id`, `sw_version`, `hw_version`, `serial_number`, `area_id`, `config_entries`, `config_entries_subentries`, `config_entry_id`, `config_subentry_id`, `primary_config_entry`, `via_device_id`, `parent_device_id`, `entry_type`, `disabled_by`, `configuration_url`, `labels`, `connections`, `identifiers`, `created_at`, `modified_at` |
| Area                  | `config/area_registry/list`   | `area_id`, `name`, `aliases`, `floor_id`, `icon`, `picture`, `labels`, `humidity_entity_id`, `temperature_entity_id`, `created_at`, `modified_at`                                                                                                                                                                                                                                                     |
| Config entry          | `config_entries/get`          | `entry_id`, `domain`, `title`, `source`, `state`, `disabled_by`, `reason`, `supports_*`, `pref_disable_*`, `error_reason_*`, `supported_subentry_types`, `num_subentries`, `created_at`, `modified_at`                                                                                                                                                                                                |
| Current user          | `auth/current_user`           | `is_admin` (used for the privilege check only; never emitted)                                                                                                                                                                                                                                                                                                                                         |

Fields not listed above that the instance returns are carried through unchanged: they are neither
omitted nor elided. The parser treats every field as optional, so older instances that lack newer
fields are accepted.

## 2. Envelope (all detail levels)

| Field               | Type                                    | Meaning                                                                                                    |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `format`            | string                                  | Always `"domusops.snapshot/0.1"` in this version.                                                          |
| `detail`            | `"summary"` \| `"standard"` \| `"full"` | The detail level produced.                                                                                 |
| `ha_version`        | string                                  | Core version reported by the instance.                                                                     |
| `compression_ratio` | number                                  | `raw_bytes / emitted_bytes`, two decimals ([research R7](./research.md#r7-compression-ratio-measurement)). |

## 3. `standard` document

```json
{
  "format": "domusops.snapshot/0.1",
  "detail": "standard",
  "ha_version": "2026.9.1",
  "compression_ratio": 12.4,
  "config": {
    "location_name": "Home",
    "time_zone": "Europe/Madrid",
    "latitude": "[redacted]"
  },
  "areas": { "kitchen": { "name": "Kitchen", "floor_id": "ground" } },
  "entries": {
    "e1": { "id": "01J8Z3...", "domain": "hue", "title": "Hue Bridge" }
  },
  "templates": {
    "t1": {
      "const": {
        "manufacturer": "Signify Netherlands B.V.",
        "model_id": "LCA001"
      },
      "cols": ["area_id", "name"]
    },
    "t2": {
      "const": {
        "supported_color_modes": ["color_temp", "xy"],
        "min_color_temp_kelvin": 2000
      },
      "cols": ["brightness", "color_temp_kelvin", "friendly_name"]
    }
  },
  "devices": {
    "t1": [["d1", "3f2a9c...", "kitchen", "Kitchen ceiling"]],
    "_": [
      {
        "alias": "d2",
        "id": "8b1e07...",
        "name": "Hue Go",
        "manufacturer": "Signify"
      }
    ]
  },
  "integrations": {
    "hue": {
      "e1": {
        "light": {
          "t2": [
            ["light.kitchen_ceiling", "on", "d1", 255, 2700, "Kitchen ceiling"]
          ],
          "_": [{ "entity_id": "light.hue_go", "state": "off", "device": "d2" }]
        }
      }
    },
    "template": { "_yaml": { "sensor": { "_": [] } } },
    "_unregistered": { "_none": { "sensor": { "_": [] } } }
  }
}
```

### 3.1 Sections

- **`config`**: the core config after the omission list (§6), default elision (§7), and redaction
  (§8). Coordinates stay present as `[redacted]` markers (FR-016).
- **`areas`**: keyed by `area_id` (already human-readable, so no alias). Values are area records
  after omission and elision.
- **`entries`**: keyed by config entry alias `e<n>`. Each value carries the full `id` (the
  `entry_id`) once, plus the entry record after omission and elision.
- **`templates`**: shared by `devices` and `integrations`. A template has `const` (keys whose value
  is identical across every record using it) and `cols` (the order of the positional values in
  each row).
- **`devices`**: grouped by template key. A row is `[alias, id, ...cols]`. Records without a
  shared shape are listed inline under `"_"`, as objects carrying `alias` and `id`.
- **`integrations`**: tree `integration → entry group → domain → template key → rows`.
  - The integration key is the entity registry `platform`.
  - The entry group key is a config entry alias (`e<n>`), `"_yaml"` for registry entities with no
    config entry, or `"!<entry_id>"` for an orphan reference.
  - Entities with no registry entry go under integration `"_unregistered"`, entry group `"_none"`.
  - An entity row is `[entity_id, state, device, ...cols]`. `device` is a device alias, `null`
    when the entity has no device, or `"!<device_id>"` when that device is not in the registry
    (an orphan; see §3.4).
  - `state` is `null` when the entity has no state object (for example a disabled entity);
    otherwise it is the state string. `expand` restores no state record for `null`.
  - Records without a shared shape are listed inline under `"_"` as objects with `entity_id`,
    `state`, `device`, and their remaining keys.

### 3.2 Entity record keys

Templates and inline records use one flat key space per entity:

- attribute keys, unprefixed (`friendly_name`, `brightness`);
- registry fields, prefixed with `reg.` (`reg.name`, `reg.area_id`, `reg.entity_category`,
  `reg.options`). The prefix avoids collisions: both attributes and the registry have an `icon`.

`platform`, `config_entry_id`, and `device_id` are not keys; they are implied by the tree position
and the `device` column.

An entity's own area (`reg.area_id`) appears only when it is set. Its effective area is its own
area if set, otherwise its device's area.

### 3.3 Determinism

Given identical input, the output is byte-identical:

- aliases are assigned in ascending order of the full ID (`d1` is the lowest device ID);
- templates are numbered in order of first use, in a traversal sorted by integration, entry
  alias, domain, and entity ID;
- object keys are emitted in sorted order, and `cols` in sorted key order;
- a template is created for a shape shared by two or more records; single records are inline.

### 3.4 References and orphans

Reference fields (closed list):

- entity: the `device` column (device alias) and `reg.area_id`;
- device: `area_id`; `via_device_id` and `parent_device_id` (device aliases); `config_entries`,
  `primary_config_entry`, and the keys of `config_entries_subentries` (entry aliases);
- area: `humidity_entity_id` and `temperature_entity_id` (entity IDs, kept in full).

A reference whose target is absent from the snapshot is emitted as `"!<original value>"`.
`floor_id` is not checked, because floors are not retrieved. `expand` restores the original value
by removing the `!` prefix.

## 4. `summary` document

Envelope plus:

| Field            | Content                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `config`         | Same as in `standard`.                                                                          |
| `counts`         | `{ entities, devices, areas, integrations, entries, unregistered_entities, disabled_entities }` |
| `by_domain`      | `{ "<domain>": <entity count> }`                                                                |
| `by_integration` | `{ "<integration>": { entities, devices, entries, domains: { "<domain>": <count> } } }`         |
| `areas`          | `{ "<area_id>": { name, devices, entities } }`, with entity counts by effective area            |
| `unassigned`     | `{ devices, entities }` with no effective area                                                  |

No entity IDs are listed (FR-010).

## 5. `full` document

Same structure and encoding as `standard` (§3): grouping, templates, aliases, and default
elision (§7), with redaction (§8). The only difference is that the omission list (§6) is not
applied, so every retrieved field is present (FR-011). `full` is the escape hatch for everything
`standard` omits; it is never a raw passthrough (constitution §4).

## 6. Omitted fields

This is the closed list for `standard` (spec FR-009, Clarifications Q2). `summary` and `standard`
never emit these fields; `full` always does. Any field **not** on this list is preserved in
`standard`.

| Record          | Omitted fields                                                                                                                              | Why an agent does not need them                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Entity registry | `id`, `unique_id`, `created_at`, `modified_at`                                                                                              | Internal record ID and integration-internal key (not referenced by any other record), plus record timestamps        |
| Device          | `connections`, `identifiers`, `created_at`, `modified_at`                                                                                   | Hardware identifiers (MAC addresses, vendor serial keys) not referenced by any other record, plus record timestamps |
| Area            | `created_at`, `modified_at`                                                                                                                 | Record timestamps                                                                                                   |
| Config entry    | `created_at`, `modified_at`                                                                                                                 | Record timestamps                                                                                                   |
| State           | `last_changed`, `last_updated`, `last_reported`, `context`                                                                                  | State timestamps and event context metadata                                                                         |
| Core config     | `config_dir`, `allowlist_external_dirs`, `allowlist_external_urls`, `whitelist_external_dirs`, `components`, `internal_url`, `external_url` | Host filesystem paths, network URLs, and the loaded-component list (the integrations are already listed)            |

**Interpretation to confirm at review**: FR-009 requires "every identifier" to be preserved. This
plan reads "identifier" as the IDs that link records to each other (entity, device, area, and
config entry IDs), which is the set FR-017 enumerates. `unique_id`, `connections`, and
`identifiers` are not referenced by any other record, so they are on this list.

## 7. Default values (elided in `standard` and `summary`)

A field equal to its default is omitted. Decoding restores the default.

| Record          | Field defaults                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity registry | `area_id: null`, `categories: {}`, `config_subentry_id: null`, `disabled_by: null`, `entity_category: null`, `has_entity_name: true`, `hidden_by: null`, `icon: null`, `labels: []`, `name: null`, `options: {}`, `original_name: null`, `translation_key: null`                                                                                                                                                                                                                                    |
| Device          | `area_id: null`, `configuration_url: null`, `config_entry_id: null`, `config_subentry_id: null`, `disabled_by: null`, `entry_type: null`, `hw_version: null`, `labels: []`, `manufacturer: null`, `model: null`, `model_id: null`, `name_by_user: null`, `parent_device_id: null`, `serial_number: null`, `sw_version: null`, `via_device_id: null`; derived: `primary_config_entry` = the only entry when there is exactly one, `config_entries_subentries` = `{ <entry>: [null] }` for each entry |
| Area            | `aliases: []`, `floor_id: null`, `humidity_entity_id: null`, `icon: null`, `labels: []`, `picture: null`, `temperature_entity_id: null`                                                                                                                                                                                                                                                                                                                                                             |
| Config entry    | `disabled_by: null`, `error_reason_translation_domain: null`, `error_reason_translation_key: null`, `error_reason_translation_placeholders: null`, `num_subentries: 0`, `pref_disable_new_entities: false`, `pref_disable_polling: false`, `reason: null`, `source: "user"`, `state: "loaded"`, `supported_subentry_types: {}`, `supports_options: false`, `supports_reconfigure: false`, `supports_remove_device: false`, `supports_unload: false`                                                 |
| Core config     | `safe_mode: false`, `recovery_mode: false`, `state: "RUNNING"`                                                                                                                                                                                                                                                                                                                                                                                                                                      |

State attributes have no defaults: an absent attribute is absent.

## 8. Redaction rules

Applied to every record at every detail level, before serialisation for output (FR-013 to
FR-017). The values of these keys, at any depth, are never redacted: `entity_id`, `device_id`,
`area_id`, `floor_id`, `config_entry_id`, `config_subentry_id`, `entry_id`, `via_device_id`,
`parent_device_id`, `primary_config_entry`, `config_entries`, `humidity_entity_id`,
`temperature_entity_id`, and `id` on device records. Every other key is subject to the rules.

| #   | Rule                  | Matches                                                                                                                                                                                                                                                                                           | Replacement                    |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| K1  | Credential key names  | Key normalised to lowercase tokens (split on `_`, `-`, `.`, camelCase) containing `token`, `password`, `passwd`, `secret`, `apikey`, `credential(s)`, `authorization`, `bearer`, `webhook`; or the token pairs `api key`, `private key`, `secret key`, `access key`, `auth key`, `encryption key` | Whole value → `[redacted]`     |
| V1  | URL query credentials | Query parameters named as in K1, plus `key`, `sig`, `signature`, `auth`                                                                                                                                                                                                                           | Parameter value → `[redacted]` |
| V2  | URL user info         | `scheme://user:password@host`                                                                                                                                                                                                                                                                     | Password → `[redacted]`        |
| V3  | JWT                   | Three base64url segments, the first starting with `eyJ`                                                                                                                                                                                                                                           | Match → `[redacted]`           |
| V4  | Bearer                | `Bearer <credential>`                                                                                                                                                                                                                                                                             | Credential → `[redacted]`      |
| V5  | Configured token      | Any exact occurrence of `DOMUSOPS_HA_TOKEN`                                                                                                                                                                                                                                                       | Match → `[redacted]`           |
| V6  | E-mail addresses      | `local@domain.tld` in any string, including config entry titles (FR-024)                                                                                                                                                                                                                          | Match → `[redacted]`           |
| C1  | Coordinates           | Keys `latitude`, `longitude`, `lat`, `lon`, `lng`, `elevation`; `gps` or `location` holding a numeric pair                                                                                                                                                                                        | Whole value → `[redacted]`     |

V1 to V6 apply to every string value, at any depth, in addition to K1.

**Test oracle** (spec Assumptions): for every planted secret and coordinate in the redaction
fixture, no contiguous fragment of six or more characters appears anywhere in the serialised
output, at any detail level.

## 9. Errors

A failed invocation returns no snapshot (FR-020). It returns an error with a `kind` and a
message that names the cause and a next step. The message never contains the token.

| `kind`                | Trigger                                                                     | Next step named in the message                                   |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `config_missing`      | `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` unset                              | Which variable to set; how to create a long-lived access token   |
| `config_invalid`      | URL not `http(s)://host[:port]`                                             | Expected URL form                                                |
| `unreachable`         | Connection refused, DNS failure, TLS failure                                | The address tried; check host, port, and network                 |
| `timeout`             | Connect/auth over 10 s, a command over 10 s, or the whole call over 30 s    | The address tried and which phase timed out                      |
| `version_unsupported` | `ha_version` below `2025.1.0`                                               | Detected version and minimum version                             |
| `auth_invalid`        | `auth_invalid` received                                                     | Create a new long-lived access token                             |
| `not_admin`           | `auth/current_user.is_admin` is false                                       | Use a token of an administrator user, and why                    |
| `retrieval_failed`    | Any data command returns `success: false`, or the connection drops mid-call | Which retrieval failed and the instance's error code and message |
| `protocol_error`      | An unexpected message shape                                                 | Report as a bug, including `ha_version`                          |

## 10. Invariants (checked by tests)

1. Every entity ID in `states` ∪ `entity_registry` appears exactly once as an entity row or inline
   record in `standard`, and exactly once per source record in `full`.
2. Every alias used (`d<n>`, `e<n>`, `t<n>`) is defined in its section; every defined alias is
   used at least once.
3. `expand(standard)` equals the redacted retrieved data with §6 applied, and `expand(full)`
   equals the redacted retrieved data. `expand` is the reference decoder in `@domusops/schema`
   (restores defaults, templates, aliases, and tree positions). In both cases, a field absent
   from a source record is restored as its default.
4. The output contains no fragment (six or more characters) of any planted secret (§8 oracle).
5. The same input always produces byte-identical output (§3.3).
