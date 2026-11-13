# @domusops/mcp

An MCP server with tools for Home Assistant. Compatible with Home Assistant; not affiliated with
or endorsed by it.

## Install and run

The server needs Node.js 22 or later and runs on macOS, Linux, or WSL. It reads two variables,
`DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`, from its environment (see
[Configuration](#configuration)).

### Recommended: a development dependency of your configuration repository

Install the server in the repository that holds your Home Assistant configuration, so its version
is pinned by the lockfile and changes only through a pull request, and the MCP client starts it
without downloading anything:

```sh
test -f package.json || echo '{ "private": true }' > package.json
npm install --save-dev @domusops/mcp
```

Create `package.json` first when the repository has none: without it, npm may install into a
parent directory that has one. `"private": true` keeps the repository from ever being published.
Commit `package.json` and `package-lock.json`, and add `node_modules/` to `.gitignore` so it stays
out of version control and deploying the repository to the instance never copies it. After a
fresh clone, run `npm install` once.

Then declare the server in `.mcp.json` at the root of the repository:

```json
{
  "mcpServers": {
    "domusops": {
      "command": "npx",
      "args": ["--no", "domusops-mcp"],
      "env": {
        "DOMUSOPS_HA_URL": "${DOMUSOPS_HA_URL}",
        "DOMUSOPS_HA_TOKEN": "${DOMUSOPS_HA_TOKEN}"
      }
    }
  }
}
```

`npx --no` runs the copy installed in the repository and never installs one. The `${...}` values
are read from the environment the client starts in, so the committed file holds no secret.

To update, change the version of `@domusops/mcp` in `package.json` (or run
`npm install --save-dev @domusops/mcp@latest`) in a pull request, like any other dependency.

### Alternatives

- **Global installation**: `npm install --global @domusops/mcp`, then `"command": "domusops-mcp"`
  with no `args`. One version for every repository on the machine; update it with the same
  command.
- **On demand**: `"command": "npx"` with `"args": ["--yes", "@domusops/mcp@~0.1"]`. Nothing to
  install, but npm resolves the package at every start, so it needs network access and starts
  more slowly. `~0.1` takes every patch release of 0.1.

In each form, `env` is as in the example above.

## Claude Code

### Register the server

- **For one repository**: the `.mcp.json` above, committed to the repository. The same entry can
  be written with one command; the single quotes keep `${...}` literal in the file:

  ```sh
  claude mcp add --scope project \
    -e 'DOMUSOPS_HA_URL=${DOMUSOPS_HA_URL}' -e 'DOMUSOPS_HA_TOKEN=${DOMUSOPS_HA_TOKEN}' \
    domusops -- npx --no domusops-mcp
  ```

- **For every repository**: after a global installation, pass both values with `-e`. They are
  stored in your user configuration (`~/.claude.json`), outside any repository:

  ```sh
  claude mcp add --scope user \
    -e DOMUSOPS_HA_URL=http://homeassistant.local:8123 \
    -e DOMUSOPS_HA_TOKEN='<long-lived access token>' \
    domusops -- domusops-mcp
  ```

### Approve it

Claude Code does not start a server declared in a repository's `.mcp.json` until you approve it.
It asks once, when you open a session in the repository. `/mcp` lists every server with its state;
a server waiting for approval can be approved there.

### Keep the token out of version control

Never write the token in `.mcp.json` or any other committed file. Export both variables in the
shell that starts Claude Code, for example from your shell profile or from a local file that
`.gitignore` excludes:

```sh
export DOMUSOPS_HA_URL="http://homeassistant.local:8123"
export DOMUSOPS_HA_TOKEN="<long-lived access token>"
```

### When it does not connect

- **Waiting for approval**: `/mcp` shows the server as pending. Approve it there.
- **Command not found, or the server never starts**: the dependencies are not installed in this
  clone. Run `npm install` in the repository. `npx --no` does not install anything, and without
  network access it can wait instead of failing.
- **A missing environment variable**: with the `.mcp.json` above, Claude Code does not start the
  server when `DOMUSOPS_HA_URL` or `DOMUSOPS_HA_TOKEN` is not set in the environment it started
  in, and says which one in `/mcp`. Export it and start a new session. A configuration that
  passes neither variable gets `config_missing` from every tool instead.
- **`auth_invalid`** or a connection error: the token or the URL is wrong. Check the URL in a
  browser and create a new token if needed.
- **`not_admin`**: the token belongs to a user who is not an administrator. Use an administrator's
  token.
- **To see the server's own error output**, start Claude Code with `claude --debug`: the server
  writes its diagnostics to standard error, never the token.

## Reading responses

A successful response is one or more text blocks. The first is the document, JSON in the tool's
published format; any later blocks are notes about the query, not part of the document.
`summary` documents are read as they are. `standard` and `full` documents are compressed, and
`@domusops/schema` has the reference decoder for each:

| Tool               | `detail`           | Decoder in `@domusops/schema` |
| ------------------ | ------------------ | ----------------------------- |
| `ha_snapshot`      | `summary`          | none: read as it is           |
| `ha_snapshot`      | `standard`, `full` | `expand`                      |
| `ha_logbook_query` | `summary`          | none: read as it is           |
| `ha_logbook_query` | `standard`         | `expandLogbook`               |
| `ha_trace`         | `summary`          | none: read as it is           |
| `ha_trace`         | `standard`         | `expandTrace`                 |
| `ha_state`         | `summary`          | none: read as it is           |
| `ha_state`         | `standard`         | `expandState`                 |
| `ha_history`       | `summary`          | none: read as it is           |
| `ha_history`       | `standard`         | `expandHistory`               |
| `ha_ping`          | none               | none: read as it is           |

`@domusops/schema` comes with the server; install it on its own
(`npm install @domusops/schema`) if your code imports it from elsewhere. This example decodes the
document of any tool result, and throws the error text of a failed call:

<!-- tested example -->

```js
import {
  expand,
  expandHistory,
  expandLogbook,
  expandState,
  expandTrace,
} from "@domusops/schema";

// A document whose format has no decoder (a summary, or a ping) is read as it is.
const decoders = {
  "domusops.snapshot/0.1": expand,
  "domusops.logbook/0.1": expandLogbook,
  "domusops.trace/0.1": expandTrace,
  "domusops.state/0.1": expandState,
  "domusops.history/0.1": expandHistory,
};

// The first text block of a tool result is the document; later blocks are notes.
function decode(result) {
  if (result.isError) throw new Error(result.content[0].text);
  const document = JSON.parse(result.content[0].text);
  const decoder = decoders[document.format];
  if (document.detail === "summary" || decoder === undefined) return document;
  return decoder(document);
}
```

## `ha_snapshot`

A read-only inventory of a running instance: every entity (with its current state and attributes),
device, area, integration and config entry, plus the core version. The result is compressed so an
agent can hold it next to a real task, instead of spending its context on repetitive registry JSON.

To install the server and connect a client, see [Install and run](#install-and-run).

### Configuration

| Variable            | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `DOMUSOPS_HA_URL`   | `http://host[:port]` or `https://host[:port]`, with no path                |
| `DOMUSOPS_HA_TOKEN` | A long-lived access token (Profile, then Security, then Long-lived tokens) |

The token must belong to an **administrator** user. Home Assistant filters entity states by the
user's permissions but not the registries, so a restricted user would get registry entries without
their states: a silently partial snapshot. The tool refuses instead. The token is only ever read
from the environment, and never appears in any output or error.

With HTTPS and a self-signed certificate, point `NODE_EXTRA_CA_CERTS` at the CA file.

### Detail levels

| `detail`             | Returns                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `summary`            | Counts and topology only: by domain, by integration, by area                                                               |
| `standard` (default) | The full inventory, grouped, templated, and lossless apart from a closed list of fields that carry no meaning for an agent |
| `full`               | Every field, including those `standard` omits, in the same encoding                                                        |

Every response carries a `compression_ratio`: the size of the payloads as the instance returned
them, divided by the size of the output. `standard` is at least 5 times smaller on the 500-entity
reference fixture, which CI asserts. The ratio on your own instance depends on its contents, and
is reported in every response.

Secrets, credentials, coordinates, and e-mail addresses are redacted at every level, before
anything is serialised; a redacted value is replaced by `[redacted]` and its field is kept. The tool
never mutates the instance, and it never returns a partial snapshot: a failure returns an error
that names the cause and a next step.

### Format

The snapshot format is versioned (`domusops.snapshot/0.1`) and public. Its types, JSON Schema, and
a reference decoder are in `@domusops/schema`. See
[`specs/001-ha-snapshot/data-model.md`](../../specs/001-ha-snapshot/data-model.md).

### Versions

Both tools refuse to run against Home Assistant older than 2025.1.0. That is a refusal threshold,
not a support claim. The supported-version matrix will be generated by the sandbox CI.

## `ha_logbook_query`

A read-only history of what happened on the instance: the logbook events of a time window, in
order, each with its cause (the automation, script, service call, user, or entity behind it). Use
it for questions such as "why did the hallway light turn on at 3 a.m.?". The result is compressed
like a snapshot, so a day of activity fits next to the task.

It uses the same server, the same `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`, and the same
administrator-token requirement as `ha_snapshot`, so one configuration serves both tools.

### Input

| Property   | Meaning                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `start`    | Window start, ISO 8601 (`2026-09-26T03:00`, or with `Z` or an offset). Default: 24 hours before `end`                                |
| `end`      | Window end, ISO 8601. Default: now. A later time is clamped to now                                                                   |
| `entities` | Up to 100 entity IDs or patterns of at most 128 characters, where `*` matches anything (`light.*`, `*_motion`). Default: every event |
| `exclude`  | Entity IDs or patterns to leave out, in the same form as `entities` (`*_firmware`, `button.*`). Applied after `entities`             |
| `detail`   | `summary` (counts per entity, domain, and cause) or `standard` (every event, compressed, the default)                                |

A time without an offset is read in the instance's time zone, and every time in the result is in
that zone. Without `entities`, the result also includes events that belong to no entity, such as
Home Assistant starting or stopping. A selector that matched nothing is listed in `no_events`, so
"no activity" is never confused with "not queried".

`exclude` leaves the events of matching entities out of the result, its counts, its size, and its
`compression_ratio`; events that belong to no entity are never excluded. An entity matched by both
lists is excluded, and a selector whose events were all excluded is not listed in `no_events`. An
event that is kept is returned whole, so its cause can still name an excluded automation or
script. When `exclude` is given, a note after the document lists what was excluded.

### Size limit

A `standard` result larger than 100,000 bytes is refused with an error that states the event count
and how to narrow the query (`summary`, a shorter window, fewer entities, or `exclude` for the
noisiest ones). It is never truncated. Set
`DOMUSOPS_LOGBOOK_MAX_BYTES` in the server configuration to change the limit; it cannot be changed
from a tool call. `summary` is not subject to it.

### What the logbook does not contain

- Continuous entities are not recorded by the logbook: sensors with a unit of measurement or a
  state class, counters, images, and proximity. Asking for one of them returns no events.
- History older than the instance's retention period has been purged. The result's `first` shows
  the earliest event it actually contains.
- Patterns and unfiltered queries follow the `logbook:` exclude settings of the instance's YAML
  configuration; exact entity IDs do not.

### Redaction and format

The redaction of `ha_snapshot` applies to every field: credentials, coordinates (including ones
written inside a message), and e-mail addresses are replaced by `[redacted]`. Hardware identifiers
such as MAC addresses are not redacted.

Every response carries a `compression_ratio`. `standard` is at least 5 times smaller than the raw
logbook on the 24-hour reference fixture, which CI asserts. The format is versioned
(`domusops.logbook/0.1`) and public; its types, JSON Schema, and a reference decoder
(`expandLogbook`) are in `@domusops/schema`. See
[`specs/002-ha-logbook-query/data-model.md`](../../specs/002-ha-logbook-query/data-model.md).

## `ha_trace`

A read-only, step-by-step record of what automations and scripts did: what triggered each run,
which conditions passed or failed, which branches and actions ran with which data, how long each
step took, and where and why the run stopped. Use it for questions such as "why did the hallway
light turn on at full brightness?" or "why did the alarm automation stop halfway?". It also
returns the traces Home Assistant records when a trigger evaluated a change but did not fire
(from 2026.7), which answer "why did it not run?". `ha_logbook_query` says what an automation
changed; `ha_trace` says why.

It uses the same server, the same `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`, and the same
administrator-token requirement as the other tools (Home Assistant itself restricts traces to
administrators).

### Input

| Property   | Meaning                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities` | Up to 100 automation or script entity IDs, or patterns where `*` matches anything (`automation.*`, `script.*_lights`). Default: every automation and script |
| `exclude`  | Automation or script entity IDs or patterns to leave out, in the same form as `entities`. Applied after `entities`                                          |
| `start`    | Keep runs that started at or after this time, ISO 8601. Default when only `end` is given: 24 hours before it                                                |
| `end`      | Keep runs that started at or before this time, ISO 8601. Default when only `start` is given: now                                                            |
| `run`      | A run ID from an earlier response. Returns that run only                                                                                                    |
| `context`  | A context ID from a `ha_trace` or `ha_logbook_query` response (the cause of an event). Returns every run in that context, in one call                       |
| `detail`   | `summary` (one row per run) or `standard` (every step, variable, and result, plus the configuration the run executed; the default)                          |

Without `start` and `end`, every stored run is returned. `exclude` leaves the runs of matching
automations and scripts out of the result, its counts, and its size, and they are not listed in
`no_runs`; a run that is kept is returned whole, including the excluded scripts it called. When
`exclude` is given, a note after the document lists what was excluded. `run` and
`context` each exclude every other selection parameter, `exclude` included; `detail` combines with anything. A time without an offset is read in the
instance's time zone, and every time in the result is in that zone. A selector that matched
nothing, an automation or script with no stored runs, one whose runs all started outside the window,
and an automation that cannot be traced are listed apart in `no_runs`, so "it did not run" is never
confused with "it cannot be traced" or "it does not exist".

Every run carries its context ID. Two context IDs of one context match when their last 16
characters are equal: the number before the colon of the compact form depends on the tool that
wrote it. A step that started a script names the script run it started, so an agent can follow an
automation into its scripts.

### Size limit

A result larger than 100,000 bytes, at either detail level, is refused with an error that states
the run count and how to narrow the query. It is never truncated. Set `DOMUSOPS_TRACE_MAX_BYTES`
in the server configuration to change the limit; it is separate from `DOMUSOPS_LOGBOOK_MAX_BYTES`
and cannot be changed from a tool call.

### What the instance keeps

- Home Assistant keeps only the most recent traces of each automation or script (5 by default;
  `stored_traces` in its `trace:` options keeps more), in memory, and saves them on a clean stop.
  Stored traces are not a complete history: `ha_logbook_query` is.
- When `start` or `end` is given, a note after the document names the automations and scripts
  (at most 10) that already store as many runs as they keep and whose oldest stored run started
  after the window start, with the number each keeps: runs from the window may be gone, so an
  empty or short result does not mean nothing ran.
- Only automations with an `id` in their configuration are traced. The others are listed as
  `untraceable`.

### Redaction and format

The redaction of the other tools applies to every field of every run: variables, action data,
error messages, the automation's configuration, and blueprint inputs. Credentials, coordinates,
and e-mail addresses are replaced by `[redacted]`. Identifiers (entity, device, area, and config
entry IDs, run and context IDs) are kept. Hardware identifiers such as MAC addresses are not
redacted.

Every response carries a `compression_ratio`. Traces are far less repetitive than registries or
logbooks, and `standard` is lossless, so it is at least 3 times smaller than the raw traces on the
reference set, which CI asserts; `summary` is far smaller. The format is versioned
(`domusops.trace/0.1`) and public; its types, JSON Schema, and a reference decoder (`expandTrace`)
are in `@domusops/schema`. See
[`specs/003-ha-trace/data-model.md`](../../specs/003-ha-trace/data-model.md).

## `ha_state`

A read-only view of what entities are doing right now: for each one its state, its attributes,
when it last changed, was last updated and last reported, and the context of the change. Use it
for questions such as "why is the porch light still on?" or "what is the thermostat set to?",
without downloading the whole `ha_snapshot` inventory. `ha_snapshot` is the full inventory with
registries, devices and areas; `ha_state` is the filtered live view.

It uses the same server, the same `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`, and the same
administrator-token requirement as the other tools: a user who is not an administrator can
receive a filtered set of states, which would make the result silently incomplete. It reads the
current user, the core configuration and the current states, on one connection, and nothing else.

### Input

| Property     | Meaning                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `entities`   | Up to 100 entity IDs or patterns of at most 128 characters, where `*` matches anything (`light.*`, `*_battery`). Default: every entity |
| `domain`     | Up to 100 domains to keep (`light`, `sensor`), each 1 to 64 characters of `a-z`, `0-9` and `_`                                         |
| `state`      | Up to 100 state values to keep, compared exactly (`on`, `unavailable`), each 1 to 255 characters                                       |
| `exclude`    | Entity IDs or patterns to leave out, in the same form as `entities` (`*_firmware`, `button.*`). Applied after the other filters        |
| `attributes` | Up to 100 attribute names to keep (`brightness`, `friendly_name`). Default: every attribute. Not with `summary`                        |
| `detail`     | `summary` (counts per domain, with `unavailable` and `unknown`) or `standard` (every selected entity; the default)                     |

The filters apply in that order: `entities`, `domain`, `state`, then `exclude`. `attributes`
only trims each entity's attributes; it never changes which entities are returned. An exact ID
in `entities` that names no entity is listed in a note after the document, not an error, and a
query that selects nothing returns an empty document and a note. When `exclude` is given, a note
lists what was excluded. A problem with `domain`, `state` or `attributes` is an `input_invalid`
error; with `entities` or `exclude`, a `selector_invalid` error, as in the other tools.

Every time is in the instance's time zone, to the second. The context IDs (`st.context`,
`st.parent_id`) are in the compact form that the `context` input of `ha_trace` and
`ha_logbook_query` accepts, so an agent can follow what caused a change.

### Size limit

A `standard` result larger than 100,000 bytes is refused with an error that states the entity
count and how to narrow the query. It is never truncated. Set `DOMUSOPS_STATE_MAX_BYTES` in the
server configuration to change the limit; it is separate from the logbook and trace limits and
cannot be changed from a tool call. `summary` is never refused: it stays small for any home.

### Redaction and format

The redaction of `ha_snapshot` applies to every state and attribute: credentials, the
configured token, coordinates (the instance's own and any other) and e-mail addresses are
replaced by `[redacted]`, and the field is kept. Entity IDs, names, and user IDs are kept.

Every response carries a `compression_ratio`. `standard` groups entities by domain and shares
repeated attribute sets in templates; it is at least 2 times smaller than the raw states on the
reference set, which CI asserts. It is lower than for the other tools because a state is already
compact and every time is written in readable local form. The format is versioned
(`domusops.state/0.1`) and public; its types, JSON Schema, and a reference decoder (`expandState`)
are in `@domusops/schema`. See
[`specs/010-ha-state/contracts/state-format.md`](../../specs/010-ha-state/contracts/state-format.md).

## `ha_history`

A read-only timeline of how entities changed over a time window: for each one, the state it had
at the start of the window, then every recorded change with its time, its state and the attributes
that changed. Use it for questions such as "when did the phone's battery start to drop?" or "at
what time did the porch light change color?". `ha_logbook_query` gives the events with their
causes but no attributes, and `ha_state` gives only the current state; `ha_history` is the
attribute timeline.

It uses the same server, the same `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`, and the same
administrator-token requirement as the other tools, and it needs the instance's `history`
integration (part of `default_config`). It reads the current user, the core configuration, the
current entity IDs when a pattern or no `entities` needs expanding, and the recorded history of
the selected entities, on one connection, and nothing else.

### Input

| Property           | Meaning                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities`         | Up to 100 entity IDs or patterns of at most 128 characters, where `*` matches anything (`light.*`, `*_battery`). Default: every current entity |
| `exclude`          | Entity IDs or patterns to leave out, in the same form as `entities` (`*_power`, `sun.*`). Applied after `entities`                             |
| `start`, `end`     | The window, ISO 8601; without an offset the instance's time zone applies. Default: the 24 hours before now. At most 10 days                    |
| `attributes`       | Up to 100 attribute names to keep (`battery_level`, `brightness`). Default: every attribute. Not with `summary`                                |
| `significant_only` | `true` keeps only the changes the instance considers significant, which leaves out most attribute-only changes. Default: `false`               |
| `detail`           | `summary` (counts of changes per domain, and per entity when `entities` is given) or `standard` (every change; the default)                    |

Patterns are matched against the entities the instance has now; an entity removed since can still
be read by its exact ID. An entity that changed in the window is listed; one that did not is
listed, with only its state at the start of the window, when it was named by exact ID, and left
out when a pattern matched it. An exact ID with no recorded history is named in a note after the
document, not an error. With `attributes`, a change in which neither the state nor a listed
attribute changed is left out, and the entity's `skipped` says how many were. A window longer
than 10 days is a `window_invalid` error; read a longer period in several calls.

Every time is in the instance's time zone, to the second; changes in the same second keep their
order. The history the instance records carries no cause: to see what caused a change, call
`ha_logbook_query` over the same window. History older than the instance's retention (10 days by
default) is gone, and nothing says that more existed.

### Size limit

A `standard` result larger than 100,000 bytes is refused with an error that states the number of
entities and changes and how to narrow the query. It is never truncated. A sensor that reports
every few seconds can fill the limit alone in a day: use `detail=summary` to see which entities
are busy, a shorter window, `exclude`, or `attributes`. Set `DOMUSOPS_HISTORY_MAX_BYTES` in the
server configuration to change the limit; it is separate from the other tools' limits and cannot
be changed from a tool call. A `summary` without `entities` is never refused: it stays small for
any home. With `entities` its rows per entity are subject to the limit.

### Redaction and format

The redaction of `ha_snapshot` applies to every state and attribute of every change:
credentials, the configured token, coordinates (the instance's own and any other) and e-mail
addresses are replaced by `[redacted]`, and the field is kept. Entity IDs and names are kept.

Every response carries a `compression_ratio`. `standard` gives each entity's attributes in full
once, at the start of the window, and then only what changed; it is at least 5 times smaller than
the raw history on the reference set, which CI asserts. The format is versioned
(`domusops.history/0.1`) and public; its types, JSON Schema, and a reference decoder
(`expandHistory`) are in `@domusops/schema`. See
[`specs/011-ha-history/contracts/history-format.md`](../../specs/011-ha-history/contracts/history-format.md).

## `ha_ping`

A cheap, read-only check of whether this server can work with the instance, to run before any
real query, and the first thing to call when something does not work. It reads the current user
and the instance's core configuration, and nothing else: no entities, registries, history or
traces. It takes no input.

It returns a small document (about 500 bytes, under 2,000 in the worst case):

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
  "integrations": { "history": true, "logbook": true, "trace": true },
  "tools": {
    "ha_snapshot": { "ready": true },
    "ha_logbook_query": { "ready": true },
    "ha_trace": { "ready": true },
    "ha_state": { "ready": true },
    "ha_history": { "ready": true }
  },
  "compression_ratio": 5.71
}
```

- `instance` has the instance's version, the least version this server supports, whether the
  instance meets it, and its time zone, in which a `start` or `end` without an offset is read.
- `admin` is whether the token's user is an administrator. Today every tool needs one.
- `integrations` says whether each integration the tools need is loaded.
- `tools` has an entry for every other tool: `ready`, and when it is not, `reasons`:
  `version_unsupported`, `not_admin`, or `integration_missing:<name>`. `next_steps` then says what
  to change. The lists are open: ignore names you do not know, since later tools add theirs.

An instance older than the minimum is reported in the document (`supported` false), not as an
error. When nothing answers, the token is refused, or the configuration is missing, the call
fails as in the other tools, with `unreachable`, `auth_invalid`, `timeout` or `config_missing`.

The token, the instance's address and location, and user names are never returned. The format is
versioned (`domusops.ping/0.1`) and public; its types and JSON Schema are in `@domusops/schema`.
It has no decoder, because it is not compressed. See
[`specs/009-ha-ping/contracts/ping-format.md`](../../specs/009-ha-ping/contracts/ping-format.md).
