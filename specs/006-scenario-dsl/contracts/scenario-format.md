# Contract: the scenario format, `domusops.scenario/0.1`

Public in `@domusops/schema` (`src/scenario/`): types, JSON Schema, `checkScenarioDocument` and
`normalizeScenarioDocument`. Files are YAML 1.2 (research R2). Every example here uses synthetic
entities (FR-032).

## 1. Files

A scenario file is a `*.yaml` or `*.yml` file under the scenarios directory (default
`<config>/scenarios`, recursive, read in path order). Its top level is one of:

```yaml
# One scenario (the SEED shape)
format: domusops.scenario/0.1
scenario: hallway_night_motion
description: Night motion lights the hallway dimly. # optional
given: { ... }
when: { ... }
then: [...]
timeout: 300 # optional, seconds of real time (default 300)
settle: 5 # optional, seconds of real time (default 5)
starting_points: { ... } # optional
```

```yaml
# Several scenarios
format: domusops.scenario/0.1
starting_points: { ... }   # optional
scenarios:
  - scenario: hallway_night_motion
    given: { ... }
    when: { ... }
    then: [ ... ]
  - scenario: hallway_off_after_five_minutes
    ...
```

- `format` is required and must be exactly `domusops.scenario/0.1`. Another value of the form
  `domusops.scenario/<x>` is refused with `format_unsupported`, naming the version this reader
  understands (FR-001).
- `scenario` (the name) matches `^[a-z0-9][a-z0-9_]{0,63}$` and is unique across every file of the
  suite (`duplicate_scenario`, naming both places).
- Unknown keys are refused everywhere (`unknown_key`), except entity IDs where the grammar allows
  them.
- Custom tags (`!secret`, `!include`, …) and merge keys are refused (`tag_not_allowed`).

## 2. Values

- **Entity ID**: `^[a-z0-9_]+\.[a-z0-9_]+$`.
- **Action**: `<domain>.<service>`, both `^[a-z0-9_]+$`. An absent-action pattern may be
  `<domain>.*`.
- **State**: a scalar; numbers and booleans are written as the text Home Assistant shows when used
  as a state (`on`, `off`, `21.5`, `home`). YAML 1.2 keeps `on` and `off` as text.
- **Duration**: seconds as a number (`90`), `"HH:MM:SS"`, `"HH:MM"`, or
  `{ hours, minutes, seconds }` with at least one field. Greater than 0 and at most 7 days.
- **Time of day**: `"HH:MM"` or `"HH:MM:SS"`, 24-hour.
- **Date**: `"YYYY-MM-DD"`, a real calendar day.

## 3. `given`

```yaml
given:
  use: empty_house_night # or a list: [weekday_morning, power_outage]
  date: "2026-04-15" # default 2026-04-15 (a Wednesday)
  time: "03:00" # default 12:00:00
  stand_ins:
    light.hallway: {} # kind = domain; must be a harness device kind
    binary_sensor.hallway_motion: { class: motion, initial: "off" }
  absent_actions:
    - media_player.*
    - notify.mobile_app_phone
  presence.house: away # an entity's state
  climate.living_room: # state and attributes
    state: heat
    temperature: 21
    attributes: { preset_mode: eco } # escape for attribute names that are keywords
```

- Keywords: `use`, `date`, `time`, `stand_ins`, `absent_actions`. Every key with a dot is an entity
  ID.
- An entity value is a state scalar, or a map with `state` (required) plus attributes. Attributes
  named `state` or `attributes` go under `attributes`.
- `stand_ins.<entity_id>` takes `class` and `initial` (non-empty text). Its domain must be one of
  `switch`, `binary_sensor`, `sensor`, `light`, `lock`, `fan`, `cover`, `valve`, `device_tracker`;
  the file check refuses any other domain with `stand_in_kind_unsupported` listing them.
- `use` refers to named starting points (§6). They are applied first, in order, then the
  scenario's own `given`; later values replace earlier ones key by key (an entity's whole value,
  `date`, `time`), while `stand_ins` and `absent_actions` accumulate.

## 4. `when`

Either one step, or a list of steps run in order.

```yaml
when:
  binary_sensor.hallway_motion: on # one step: entity changes
```

```yaml
when:
  - binary_sensor.hallway_motion: "off"
  - advance: "00:04:00"
  - then:
      - light.hallway: on
  - advance: 120
  - action: input_boolean.turn_on
    target: { entity_id: input_boolean.guest_mode }
    data: {}
  - event: doorbell_pressed
    data: { door: front }
  - advance_to: "07:00"
```

Step kinds (exactly one per list item):

| Step                                                      | Effect                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `<entity_id>: <state or map>` (one or more)               | Sets each entity's state and attributes, in the order written, as a device would (`setState`).                |
| `action: <domain.service>` with optional `target`, `data` | Calls the action and waits for it (`callService`).                                                            |
| `event: <event_type>` with optional `data`                | Fires the event (`fireEvent`).                                                                                |
| `advance: <duration>`                                     | Moves the frozen clock forward; time triggers, delays and waits fall due.                                     |
| `advance_to: <time of day or "YYYY-MM-DDTHH:MM[:SS]">`    | Moves the clock to the next such moment; a moment that has passed is refused at run time (`advance_to_past`). |
| `then: [expectations]`                                    | Checks expectations at this point of the sequence.                                                            |

## 5. `then` — expectations

A list. Each item is one expectation of one of these forms, plus optional `within`, `for` and
`settle` where noted.

### 5.1 Entity

```yaml
- light.hallway: on # state equals
- light.hallway: { state: on, brightness_pct: 15 } # state and attributes
- sensor.power: { state: { at_least: 100 } }
- climate.living_room:
    state: { in: [heat, auto] }
    temperature: { between: [19, 22] }
  within: "00:01:00" # instance time to wait for it to hold (default 0)
  settle: 10 # real seconds (overrides the scenario's)
- light.porch: "off"
  for: "00:10:00" # must keep this value for ten minutes of instance time
```

- Exactly one entity key per item. Its value is a state scalar or a map of `state`, attributes and
  `attributes` (as in `given`).
- Each value is a comparison: a scalar (equal), `{ not: v }`, `{ in: [v, ...] }`,
  `{ at_least: n }`, `{ at_most: n }` or `{ between: [low, high] }` (inclusive). `null` means
  absent or null.
- `within` and `for` are mutually exclusive.

### 5.2 Automation triggered

```yaml
- triggered: automation.hallway_night_motion # at least once since `when` began
  times: 1 # optional, exact count; 0 means "did not trigger"
  within: 30 # optional
```

### 5.3 Action called

```yaml
- called: notify.mobile_app_phone
  data: { message: { in: ["Motion in the hallway", "Motion detected"] } } # optional, subset
  times: 1 # optional, exact
- called: media_player.turn_off
  target: media_player.living_room # an entity ID, a list, or { entity_id, device_id, area_id }
- not_called: siren.turn_on # same as `called` with `times: 0`
```

- `data` lists only the fields to check; each is a comparison of §5.1. `target` matches when every
  listed ID is among the call's.
- Calls count from the first step of `when`.

## 6. `starting_points`

```yaml
starting_points:
  empty_house_night:
    time: "03:00"
    presence.house: away
    stand_ins: { light.hallway: {} }
  weekday_morning:
    use: empty_house_night # may refer to another; cycles are refused
    time: "07:00"
    presence.house: home
```

- Same grammar as `given`. Names match the scenario-name pattern and are unique across the suite.
- `unknown_starting_point` and `starting_point_cycle` name the reference and where it is.

## 7. Issues

`checkScenarioDocument(value)` returns `{ path, code, message }[]`, `path` a JSON Pointer. The
sandbox adds `file`, `line` and `column`. Codes: `format_missing`, `format_unsupported`,
`unknown_key`, `missing_key`, `wrong_type`, `bad_entity_id`, `bad_action`, `bad_duration`,
`bad_time`, `bad_date`, `bad_comparison`, `exclusive_keys`, `empty_list`, `bad_name`,
`stand_in_kind_unsupported`, and, across files, `duplicate_scenario`,
`duplicate_starting_point`, `unknown_starting_point`, `starting_point_cycle`,
`tag_not_allowed`, `yaml_syntax`.

## 8. Normalised form

`normalizeScenarioDocument` returns, for each scenario, the shape the runner executes
([data-model.md](../data-model.md) §1): `given` with `use` resolved, `date` and `time` filled
with their defaults, every entity value as `{ state, attributes }`; `when` as a list of typed
steps; every expectation typed (`entity`, `triggered`, `called`) with explicit comparisons and
defaults (`within: 0`, `settle` inherited, `times` absent or a number).

## 9. The SEED example

Valid as written once it names the format:

```yaml
format: domusops.scenario/0.1
scenario: hallway_night_motion
given:
  time: "03:00"
  presence.house: away
  stand_ins: { light.hallway: {} }
  absent_actions: [media_player.*]
when:
  binary_sensor.hallway_motion: on
then:
  - light.hallway: { state: on, brightness_pct: 15 }
  - called: media_player.turn_off
    target: media_player.living_room
```

SEED's original last line, `media_player.living_room: { state: off }`, is also valid: it checks
the state of a plain entity set in `given`, which an absent action does not change.
