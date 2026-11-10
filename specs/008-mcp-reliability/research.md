# Research: mcp reliability

Decisions for `@domusops/mcp` 0.1.2. Each entry gives the decision, why, and what was rejected.
Facts about Home Assistant were read from the source of the 2026.10.0 (stable) and 2026.9.4
(previous stable) images; the container tests re-check them on every supported release (§8).

## R1. Where the reported version comes from

- **Decision**: `createServer` reads `version` from the package's own `package.json`, located next
  to the compiled module (`../package.json` from `dist/` and from `src/`). A missing or unreadable
  file throws at start, so the server never reports an invented version.
- **Rationale**: npm always publishes `package.json`, and changesets edits only that file on a
  release, so the reported version cannot drift. Throwing keeps FR-001 honest; the bootstrap's
  `packageVersion()` falls back to `0.0.0` silently, which is the defect this story removes.
- **Test**: the version reported by an in-memory client equals `package.json`'s; a second test
  starts the built `dist/cli.js` over stdio and checks the same.
- **Rejected**: generating a `version.ts` at build time (an extra build step for one string);
  importing JSON with an import attribute (ties the build to a TypeScript and Node combination
  for no gain).

## R2. How notes travel next to the document

- **Decision**: the internal pipelines return `{ document, notes }`, and `asToolResult` sends the
  document as the first text block and each note as a further text block. `runLogbookQuery` and
  `runTrace` keep their signatures and return the document only, so every existing test keeps
  its expectations; the server calls the new functions. Errors are unchanged.
- **Format**: plain English, one block per note, starting with `Note:`; contract in
  [contracts/response-notes.md](./contracts/response-notes.md). Notes are not counted by the size
  check and are not compressed: each is bounded (R5).
- **Rationale**: clarification 1 (no format change, §5). MCP tool results carry a list of content
  blocks, and every client shows all of them to the model.
- **Rejected**: one block holding the document followed by a note (the block would no longer be
  valid JSON, and decoders would fail); a field inside the document (format change).

## R3. Exclusion semantics

- **Decision**: `exclude` reuses `parseSelectors` (same syntax, limit of 100, 128 characters each)
  and `matches`. It is applied after `entities` and after the instance returns its rows:
  - **logbook**: a row with an `entity_id` matched by `exclude` is dropped before the raw size is
    measured, so `compression_ratio`, counts and the size check all describe what is returned.
    Rows without an entity are never dropped. With exact `entities`, the instance is still asked
    for those IDs only; an exact ID that is also excluded is not requested at all.
  - **trace**: a run whose item key is matched by `exclude` is dropped in `selectTraces` before
    `chosen` is built, and excluded IDs are removed from every `no_runs` list and from the
    warning (R4).
  - **`no_events` and `no_match`**: they keep their 0.1.1 meaning, "matched nothing before
    exclusion", with one exception: an exact selector that is itself excluded is never listed.
    A pattern whose matches were all excluded is therefore not reported as having no events.
- **Validation**: `exclude` follows the order of `entities` in validation and errors
  (`selector_invalid`). In `ha_trace`, `exclude` joins the parameters that `run` and `context`
  refuse (`selection_invalid`).
- **Rationale**: one matcher, one validator, and FR-008's "nothing of an excluded entity
  appears". Pre-exclusion `no_events` avoids telling the agent "nothing happened" when the agent
  itself removed the events.
- **Rejected**: sending `exclude` to the instance (the logbook API has no exclusion parameter);
  reporting all-excluded patterns in `no_events` (misleading).

## R4. Detecting runs that may have been discarded

- **Facts** (trace integration, `trace/util.py`):
  - each automation or script keeps two independent buckets, `runs` and `not_triggered`, each
    limited to `stored_traces` (default `DEFAULT_STORED_TRACES = 5`); a new trace evicts the
    oldest of its own bucket;
  - restored traces are capped by the same limit when the item is already loaded, and are never
    more than were saved;
  - `stored_traces` lives in the item's configuration under `trace:`; `automation/config` and
    `script/config` (admin only, which the tools already require) return `raw_config`, which
    holds `trace.stored_traces` only when the user set it. Both commands exist on both releases
    checked.
- **Decision**: for a query with a window, after selection and exclusion:
  1. for each selected item, count its stored records per bucket (`not_triggered` true or not)
     from the `trace/list` result already fetched, and take the oldest start in each bucket;
  2. candidates are items with a bucket whose oldest start is after the window start (no `start`:
     always) and whose count is at least 1;
  3. for candidates only, read the limit with `automation/config` or `script/config`
     (concurrently, within `MAX_IN_FLIGHT`); absent `trace.stored_traces` means 5; a failed read
     means 5 and the note says the limit was assumed;
  4. an item is affected when a candidate bucket's count is at or above its limit.
- **Why per bucket**: a flood of not-triggered traces does not evict runs, so counting them
  together would raise false warnings. On an older release that shares one bucket, counting
  separately can only miss a warning, never invent one.
- **Cost**: one extra round trip per candidate, and none when no query window is given. The
  extra reads never change the document.
- **Rejected**: reading `trace.stored_traces` from the `config` of an extended record (it needs
  `trace/get` for every candidate, a larger read); assuming 5 for everyone (false alarms for
  users who keep more, missed ones for users who keep fewer).

## R5. Bounding the notes

- **Decision**: the discarded-runs note names at most 10 items, ordered by entity ID, and ends with
  `and N more` when more are affected (clarification 4). The exclusion note lists the exclusion
  list as given (at most 100 selectors of at most 128 characters, already bounded by validation).
- **Rationale**: a note stays a few hundred bytes, small next to any result.

## R6. Where the tool contracts live

- **Decision**: the current contracts of both tools move to
  `specs/008-mcp-reliability/contracts/*.tool.json`; the contract tests and the comments in
  `server.ts` point there. The 002 and 003 contracts stay as the history of what 0.1.x shipped
  before this feature.
- **Rationale**: a spec describes its own feature; editing an earlier feature's contract hides
  when the interface changed.

## R7. The recommended installation in Claude Code

- **Decision**: the README recommends `npm install --save-dev @domusops/mcp` in the configuration
  repository and a project-scoped server in `.mcp.json` whose command runs the local binary;
  `node_modules/` goes in `.gitignore`. Alternatives: `npm install --global` with
  `"command": "domusops-mcp"`, and `npx --yes @domusops/mcp@~0.1`.
- **Verified** (2026-11-09, `@domusops/mcp` 0.1.1 installed as a development dependency in an
  empty repository, both forms started with the registry unreachable and answering
  `initialize`):
  - `"command": "npx", "args": ["--no", "domusops-mcp"]` starts from the repository root and from
    any subdirectory, because npx looks for the binary up the directory tree. **The README
    documents this form.**
  - `"command": "./node_modules/.bin/domusops-mcp"` starts from the root only; from a
    subdirectory the spawn fails with `ENOENT`. Rejected.
  - Neither form contacts the registry when the package is installed. When it is not, `npx --no`
    asks the registry before giving up, so without network access it waits instead of failing;
    the README's troubleshooting list says to run `npm install`.
  - Confirmed in Claude Code (T008, a configuration repository with 0.1.1 installed this way): the
    project-scoped server connects and lists the three tools; `${DOMUSOPS_HA_URL}` and
    `${DOMUSOPS_HA_TOKEN}` are expanded from the environment Claude Code started in (a
    `ha_snapshot` call succeeded with no secret in any file); started from that repository with
    the registry unreachable, the server answered `initialize` in about 0.6 s. A Claude Code
    session cannot run with the network off (it needs the model API), so "no registry request"
    (SC-003) is proven by that unreachable-registry start, not by an offline session.
- **Token**: `.mcp.json` names `${DOMUSOPS_HA_URL}` and `${DOMUSOPS_HA_TOKEN}`, which Claude Code
  expands from the environment, so the committed file carries no secret.
- **Troubleshooting list**: waiting for approval (`/mcp`), command not found (dependencies not
  installed), missing or wrong URL or token variable, token user not an administrator.

## R8. Keeping the README correct

- **Decision**: a test reads `packages/mcp/README.md` and checks that every
  `@domusops/mcp@~X.Y` matches the major and minor of `package.json`, and that the decoding
  example (a fenced JavaScript block marked as the tested example) decodes a fixture document
  from each tool with the decoder it names. The example is extracted and run as written, as an
  ES module, so it needs no compile step.
- **Rationale**: FR-005 and FR-006 without a hand step per release; the README ships in the
  package, so a stale one is a published defect.
- **Rejected**: pinning an exact version in the README (wrong after every patch).
