# Data Model: ha_ping

## 1. Ping document (`domusops.ping/0.1`)

The one document `ha_ping` returns when the instance answered (spec FR-018). Keys appear in this
order; minified JSON.

| Key                 | Type                          | Source and rule                                                                                                          |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `format`            | `"domusops.ping/0.1"`         | Constant                                                                                                                 |
| `server`            | `{ name, version }`           | `domusops-mcp` and the package version, the values of the handshake (FR-002, research R11)                               |
| `instance`          | object, below                 | The instance's version, support and time zone (FR-003)                                                                   |
| `admin`             | boolean                       | `is_admin` of `auth/current_user`; nothing else of the user (FR-004, FR-010)                                             |
| `integrations`      | map of name to boolean        | Every integration some listed tool needs, in name order: whether its exact name is in `components` (FR-005, research R2) |
| `tools`             | map of tool name to readiness | Every tool the server offers except `ha_ping`, in registration order (FR-006, FR-019)                                    |
| `next_steps`        | string array, optional        | Present only when some tool is not ready: one sentence per distinct reason (FR-007, research R5)                         |
| `compression_ratio` | number                        | Raw bytes of the two answers over the document's bytes, two decimals (FR-013, research R7)                               |

`instance`:

| Key         | Type    | Rule                                                                                  |
| ----------- | ------- | ------------------------------------------------------------------------------------- |
| `version`   | string  | As the handshake gave it, beta and development suffixes included                      |
| `minimum`   | string  | The server's refusal threshold, `MIN_VERSION`                                         |
| `supported` | boolean | `version` (its base version for a beta or development build) is at or above `minimum` |
| `time_zone` | string  | `time_zone` of `get_config`, the IANA name the logbook and trace documents also carry |

## 2. Tool readiness

One entry of `tools`, keyed by tool name.

| Key       | Type                   | Rule                                                   |
| --------- | ---------------------- | ------------------------------------------------------ |
| `ready`   | boolean                | True when `reasons` would be empty                     |
| `reasons` | string array, optional | Present only when `ready` is false, in the order below |

Reasons, in this order:

1. `version_unsupported`: `instance.supported` is false.
2. `not_admin`: the tool needs an administrator and `admin` is false.
3. `integration_missing:<name>`: the tool needs integration `<name>` and it is not loaded, one
   entry per missing integration in name order.

What each tool needs is the requirements table of research R4.

## 3. Next steps

The distinct reasons across all tools, in the order above, each mapped to one sentence:

| Reason                       | Sentence                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `version_unsupported`        | `Upgrade the instance to <minimum> or later`                                                     |
| `not_admin`                  | `Use a token of an administrator user: every tool reads administrator data`                      |
| `integration_missing:<name>` | `Enable the <name> integration in Home Assistant (it is part of default_config), then try again` |

## 4. Validation

- The document is valid against `pingJsonSchema`; `tools` and `integrations` accept names a
  reader does not know (FR-019).
- Two calls against the same instance state give byte-identical documents (spec User Story 1,
  scenario 2).
- No value is taken from `name`, `id`, `latitude`, `longitude`, `elevation`, `location_name`,
  URLs or any other field of the two answers beyond those listed in §1 (FR-010).
