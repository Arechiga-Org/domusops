# Quickstart: validating the debt paydown

Run every command from the repository root. The gate (`pnpm lint && pnpm typecheck && pnpm test`)
must be green after each story. None of this touches a real Home Assistant instance (FR-033):
unit tests use simulated instances, and container tests use the sandbox.

## US1 — MCP correctness

```sh
node_modules/.bin/vitest run packages/mcp/test < /dev/null
```

Expected:

- A failing `trace/get` among ten: the result is `retrieval_failed`, and the simulated instance
  counts no `trace/get` received after the failure (SC-001).
- `HaClient.close()` with three pending commands: all three reject within one second with "the
  connection closed before a reply arrived" (SC-002).
- Reads with a 300 ms simulated delay: a request for one run finishes in under 1500 ms, where
  reading them one after another takes about 1900 ms (SC-003).
- 500 stored runs, `detail=standard`, default limit: `too_large` with "bytes or more", and
  fewer than 250 `trace/get` received (SC-004).
- The monotonicity property test of research R4 passes.
- Every existing `ha_trace` output test passes unedited (FR-005).

## US2 — Release hardening

Before merge:

```sh
pnpm typecheck && node_modules/.bin/vitest run scripts/test < /dev/null
```

- `package-contents.test.ts` passes: four READMEs, `src/` shipped, every map resolves (SC-007).
- To prove the test, remove `"src"` from one package's `files`: the test fails.

After merge, done by the maintainer, in this order:

1. On npmjs.com, add the trusted publisher to each of the four packages
   ([contracts/release.md](./contracts/release.md)).
2. Merge the open "Version Packages" pull request, which carries US1's changeset.
3. Watch the `release` run. It must succeed with no npm secret read.
4. On each package's npm page, confirm the new version shows its provenance, published from
   `Arechiga-Org/domusops` by `release.yml` (SC-005).
5. Only then:
   - set "Require two-factor authentication and disallow tokens" on each package;
   - run `! gh secret delete NPM_TOKEN`;
   - revoke the `domusops-release-ci` token on npmjs.com.
6. Open the logs of the latest `ci` and `release` runs on `main` and search for "Node.js 20".
   There must be no match (SC-006).

If step 3 fails with a registry refusal, fix the trusted-publisher fields and re-run the job.
Never add a token back.

## US3 — Sandbox robustness

Unit tests:

```sh
node_modules/.bin/vitest run packages/sandbox/test < /dev/null
```

- Ownership decision table (data-model §2): every row, including a simulated host-name change
  with a dead owner (removed) and a live owner (kept) (SC-008).
- Integration pin: a tampered archive and a substituted file both fail with the integrity error,
  and nothing is cached (SC-009).
- Teardown redaction: the test passes. To prove it, temporarily drop the `secrets` argument on
  the teardown path; the test must fail (FR-019).

Container tests (Docker required):

```sh
DOMUSOPS_CONTAINER_TESTS=1 node_modules/.bin/vitest run packages/sandbox/test < /dev/null
```

- Attach and add: start a background instance with `devices: []`, attach from a second process,
  add a device, and see it in that handle's `devices`.
- Time control unavailable: the companion test with a probe stub reports `time_unavailable`, and
  the instance still answers `get_states`.

The matrix (`sandbox-matrix` and `sandbox-gate`) stays green on stable and previous stable.

## US4 — Bootstrap

```sh
node_modules/.bin/vitest run packages/bootstrap/test < /dev/null
```

- Rendered templates contain no bare `domusops-bootstrap` command (SC-010).
- With a hand-edited `.sops.yaml`, add-key and remove-key exit `1`, print the refusal, and leave
  `.sops.yaml`, `secrets.sops.yaml` and the record byte-identical (SC-011).
- `init` against a fixture with recipients that do not include the local key: `next_steps`
  contains the add-key line with the local public key.

The macOS job (`bootstrap-macos`) runs the same tests with real `sops` and `age`.

## US5 — MCP internals

```sh
git diff main --stat -- packages/mcp/test
node_modules/.bin/vitest run packages/mcp/test < /dev/null
```

- The diff shows additions only: no existing expectation is edited (SC-012).
- The compression-floor tests pass with the same floors.
- `grep -rn "const refOf" packages/mcp/src` prints one line.

## US6 — Housekeeping

```sh
node_modules/.bin/prettier --check CLAUDE.md packages/sandbox/package.json
```

- Both files pass, and the "Current focus" names the 0.1.x packages, feature 007 as current, and
  006 as next.
