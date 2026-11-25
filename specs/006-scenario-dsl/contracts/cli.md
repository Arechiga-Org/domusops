# Contract: `domusops-sandbox test`

One new subcommand of the existing `domusops-sandbox` binary. It parses options, calls
`loadScenarios`, `runScenarios` and `renderReport`, and prints; it adds no logic (FR-021).

## Usage

```text
domusops-sandbox test [<name or path>...] [--config <dir>] [--secrets-file <file>]
                      [--channel <c>]... [--release <r>]...
                      [--scenario-timeout <s>] [--parallel <n>]
                      [--report <file>] [--json] [--check]
```

- `--config <dir>`: the configuration directory; default the current directory. Scenarios are read
  from `<dir>/scenarios` unless positional paths are given.
- Positional arguments: a value that names an existing file or directory is a path; any other value
  is a scenario name. Names and paths combine: paths choose the files, names filter them
  (FR-023). A name that matches nothing is a usage error naming it.
- `--channel` and `--release` repeat; default `--channel stable`. Each scenario runs on each
  target, in the order given (FR-022).
- `--scenario-timeout`: seconds, 30 to 3600, default 300: the limit of every scenario that sets no
  `timeout` of its own; a scenario's `timeout` wins (FR-020).
- `--parallel`: 1 to 8, default 1.
- `--report <file>`: writes the machine-readable report there (FR-027).
- `--json`: prints the machine-readable report on standard output instead of the readable one.
- `--check`: checks the files and exits; no instance starts. Useful in editors and pre-commit.

## Output

The readable report of [report-format.md](./report-format.md) §3 on standard output; progress
lines (`starting hallway_night_motion on 2026.11.2`) on standard error. Invalid files print one
line per issue, `file:line:column code message`, and nothing runs (FR-005).

## Exit status

| Code | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 0    | Every scenario passed (or, with `--check`, every file is valid).                    |
| 1    | At least one scenario failed.                                                       |
| 2    | Usage error or invalid scenario files; nothing ran.                                 |
| 3    | None failed, but at least one could not run (no runtime, invalid configuration, …). |

A target with no beta in progress gives `not_run` rows and does not change the status.
