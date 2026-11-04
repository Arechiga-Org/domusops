# Contract: `@domusops/mcp` README

What the package README must contain after this feature (spec FR-003 to FR-006). Sections are
listed in reading order; existing sections on the three tools stay as they are, with `exclude`
and the notes added to the logbook and trace sections.

## 1. Install and run

- **Recommended**: a development dependency of the Home Assistant configuration repository.
  - `npm install --save-dev @domusops/mcp` (creates `package.json` and the lockfile when the
    repository has none), and `node_modules/` in `.gitignore`.
  - A project-scoped `.mcp.json` whose command runs the local binary (exact form chosen in
    research R7), with `DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN` taken from the environment as
    `${DOMUSOPS_HA_URL}` and `${DOMUSOPS_HA_TOKEN}`.
  - Updating: change the dependency in a pull request, like any other dependency.
- **Alternatives**, each with its configuration:
  - global: `npm install --global @domusops/mcp`, then `"command": "domusops-mcp"`;
  - on demand: `npx --yes @domusops/mcp@~X.Y`, where `X.Y` is the current minor (checked by a
    test); it resolves the package at start and needs network access.

## 2. Claude Code

- Register for one repository (the `.mcp.json` above, or `claude mcp add --scope project`) and
  for all repositories (`claude mcp add --scope user`).
- Approve a project-scoped server: Claude Code asks once; `/mcp` shows its state and approves it.
- The token stays out of version control: set it in the shell environment or a local, ignored
  file; never in `.mcp.json`.
- Troubleshooting, one line each: waiting for approval; command not found (run
  `npm install`); URL or token variable missing or wrong; the token's user is not an
  administrator; how to see the server's own error output.

## 3. Reading responses

- One table: tool, detail level, decoder in `@domusops/schema` (`expand` for snapshots,
  `expandLogbook` and `expandTrace` for `standard` documents; `summary` documents are read as
  they are).
- One JavaScript example (an ES module), marked as the tested example, that decodes a document;
  a test runs it as written against fixture documents.
- A sentence on notes: text blocks after the document are notes, not part of it.

## Invented names only

Every entity ID, host and token in the README is invented (`light.hallway`,
`http://homeassistant.local:8123`, `<long-lived access token>`).
