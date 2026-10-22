# Contract: release workflow and published package contents (US2)

## Release workflow (`.github/workflows/release.yml`)

| Aspect            | Contract                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Trigger           | push to `main` (unchanged)                                                                 |
| Permissions       | `contents: write`, `pull-requests: write`, `id-token: write`                               |
| Secrets read      | `GITHUB_TOKEN` only, passed as the changesets action's `github-token` input; no npm secret |
| npm CLI           | ≥ 11.5.1, installed explicitly before publishing                                           |
| `.npmrc`          | none written by the workflow (no `registry-url` on setup-node)                             |
| Version step      | `version-script: pnpm version-packages` (unchanged script)                                 |
| Publish step      | `publish-script: pnpm release` (unchanged script)                                          |
| Action references | full commit SHAs, each with its version in a trailing comment                              |
| Failure mode      | if the registry refuses the OIDC identity, the job fails; nothing falls back to a token    |

## Registry side, one-time, per package (maintainer)

The following is set for each of `@domusops/schema`, `@domusops/mcp`, `@domusops/sandbox` and
`@domusops/bootstrap`, under the package's settings on npmjs.com ("Trusted publishing", then
"GitHub Actions"):

| Field             | Value          |
| ----------------- | -------------- |
| Organization/user | `Arechiga-Org` |
| Repository        | `domusops`     |
| Workflow filename | `release.yml`  |
| Environment       | (empty)        |

After the first successful OIDC publish:

- In each package's "Publishing access", select "Require two-factor authentication and disallow
  tokens".
- Delete the repository secret `NPM_TOKEN`.
- Revoke the granular token `domusops-release-ci`.

## Every workflow

Every `uses:` names a version whose `action.yml` declares `runs.using: node24`, or a composite or
Docker action. CI fails on no such check, but the quickstart verifies it after merge (SC-006).

## Published package contents (all four packages)

| Rule                                                                                               | Checked by                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `README.md` is in the tarball                                                                      | `scripts/test/package-contents.test.ts` |
| `src/**/*.ts` is in the tarball; `test/` is not                                                    | same                                    |
| every `sources` entry of every `.map`, resolved from the map's directory, is a file in the tarball | same                                    |
| `package.json` `files` is `["dist", "src"]` plus each package's existing extras                    | same, by the two rules above            |
