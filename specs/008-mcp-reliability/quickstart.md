# Quickstart: validating mcp reliability

Runnable checks that prove each story. None of them touches a real Home Assistant instance: unit
tests use the simulated instance in `packages/mcp/test/support/fake-ha.ts`, container tests use
the sandbox.

## Prerequisites

- `pnpm install && pnpm build` at the repository root.
- For scenario 5: Docker, and a local image of the release under test
  (`DOMUSOPS_SANDBOX_RELEASE=<tag>` avoids pulling a newer stable).

## 1. The reported version (US1)

```sh
pnpm exec vitest run packages/mcp/test/server-version.test.ts
```

Expected: the version reported during the handshake equals `packages/mcp/package.json`, both
in memory and through `dist/cli.js` over stdio.

## 2. The README setup (US2)

Automated:

```sh
pnpm exec vitest run packages/mcp/test/readme.test.ts
```

Expected: every `@domusops/mcp@~X.Y` matches the package's minor, and the tested decoding example
runs against the fixture documents of all three tools.

By hand, once per release, with a sandbox instance as the target:

1. In an empty Git repository, follow README §1 (recommended form) and §2.
2. Open Claude Code in it, approve the server, run `/mcp`: `domusops` is connected and lists
   three tools.
3. From the repository, start the server with the registry unreachable
   (`npm_config_registry=http://127.0.0.1:9/`) and send `initialize`: it answers (no registry
   request, SC-003). A Claude Code session cannot run offline, since it needs the model API.
4. Check `git status`: `.mcp.json`, `package.json` and the lockfile are tracked; `node_modules/`
   is ignored; no file contains the token.

## 3. Exclusion (US3)

```sh
pnpm exec vitest run packages/mcp/test/logbook-exclude.test.ts packages/mcp/test/trace-exclude.test.ts
```

Expected:

- no excluded entity in events, runs, counts or `no_runs`; logbook rows without an entity kept;
- a standard logbook query refused for size on the reference window fits once its noisiest
  entities are excluded (SC-004);
- `exclude` with `run` or `context` refused with `selection_invalid`;
- the exclusion note after the document; without `exclude`, the response is one block,
  identical to 0.1.1.

## 4. Discarded-runs warning (US4)

```sh
pnpm exec vitest run packages/mcp/test/trace-discarded.test.ts
```

Expected, on the simulated instance:

- an automation at its limit whose oldest run is after `start`: one note naming it with
  `(keeps 5)`;
- the same automation with `trace.stored_traces: 20` and 6 stored runs: no note;
- a failed config read: `(keeps 5, limit assumed)`;
- 12 affected items: 10 named, then `and 2 more`;
- an empty result: the note is still sent; `run` or `context` queries, or no window: no note;
- in every case, the document block is identical to the one without the note.

## 5. Against real releases (US3, US4, §8)

```sh
DOMUSOPS_SANDBOX_RELEASE=2026.10.0 pnpm --filter @domusops/sandbox test:container -- mcp.container
```

Expected: the built server, against a sandbox instance with an automation that sets
`trace: { stored_traces: 2 }` and has run three times, returns the discarded-runs note for a
window that starts before its first run, and `exclude` leaves it out. Repeat with the previous
stable release.

## 6. The gate

```sh
pnpm lint && pnpm typecheck && pnpm test
```

Expected: green; every existing output test passes unchanged; compression floors unchanged.
