import { createHash } from "node:crypto";

/**
 * Deterministic renderers for every skill-owned generated file
 * ([generated-files.md](../../../../specs/004-ha-bootstrap/contracts/generated-files.md)).
 * No function here reads the clock, the machine, or the user's name (research R12): the same
 * inputs always produce the same bytes, which is what lets `baseline/record.ts` tell an edited
 * file apart from one that is merely outdated.
 */

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const GITIGNORE_BLOCK_START =
  "# >>> DomusOps baseline (managed by ha-bootstrap; edit outside this block) >>>";
const GITIGNORE_BLOCK_END = "# <<< DomusOps baseline <<<";

/** Every entry the block may hold, in the fixed order of research R4. */
export const GITIGNORE_ENTRIES = [
  "secrets.yaml",
  "*.db",
  "*.db-shm",
  "*.db-wal",
  "*.log",
  "*.log.*",
  ".storage/",
  ".cloud/",
  ".ssh/",
  ".cache/",
  "__pycache__/",
  "deps/",
  "tts/",
  ".HA_VERSION",
  ".ha_run.lock",
  ".uuid",
  "ip_bans.yaml",
  ".google.token",
  "custom_components/",
  "www/community/",
] as const;

/**
 * `custom_components/` and `www/community/` are left out when the user already tracks files
 * under them (research R4, spec edge case).
 */
export function renderGitignoreBlock(
  omit: ReadonlySet<string> = new Set(),
): string {
  const entries = GITIGNORE_ENTRIES.filter((entry) => !omit.has(entry));
  const lines = [
    GITIGNORE_BLOCK_START,
    "# Runtime files written by the instance, credentials, and installed artefacts.",
    ...entries,
    GITIGNORE_BLOCK_END,
  ];
  return `${lines.join("\n")}\n`;
}

export function gitignoreBlockBounds(
  text: string,
): { start: number; end: number } | null {
  const start = text.indexOf(GITIGNORE_BLOCK_START);
  if (start === -1) return null;
  const endLine = text.indexOf(GITIGNORE_BLOCK_END, start);
  if (endLine === -1) return null;
  const afterEnd = text.indexOf("\n", endLine);
  return { start, end: afterEnd === -1 ? text.length : afterEnd + 1 };
}

export function renderPackagesReadme(): string {
  return `# packages/

Each \`*.yaml\` file in this directory is a package for Home Assistant, named after the file (a
package named \`lighting.yaml\` is the package \`lighting\`). It is loaded automatically by the
\`packages: !include_dir_named packages\` line in \`configuration.yaml\`, managed by ha-bootstrap.

A package groups every piece of configuration for one feature — helpers, automations, scripts,
templates — that would otherwise be scattered across \`configuration.yaml\`, \`automations.yaml\`,
and the rest. For example, \`packages/porch_light.yaml\`:

\`\`\`yaml
input_boolean:
  porch_light_override:
    name: Porch light override

automation:
  - alias: Turn on the porch light at dusk
    trigger:
      - platform: sun
        event: sunset
    condition:
      - condition: state
        entity_id: input_boolean.porch_light_override
        state: "off"
    action:
      - service: light.turn_on
        target:
          entity_id: light.porch
\`\`\`

Non-YAML files in this directory, such as this one, are ignored by the loader.
`;
}

export function renderSopsConfig(recipients: readonly string[]): string {
  const age =
    recipients.length === 1
      ? recipients[0]
      : `>-\n      ${recipients.join(",\n      ")}`;
  return `# Encryption rules for secrets.sops.yaml, managed by ha-bootstrap.
# Add or remove keys with: domusops-bootstrap secrets add-key|remove-key <age public key>
creation_rules:
  - path_regex: (^|/)secrets\\.sops\\.yaml$
    age: ${age}
`;
}

export function renderPlaceholders(): string {
  return `# Placeholder values used only to validate the configuration in CI and with
# \`domusops-bootstrap validate\`. They are not your secrets and must never be.
# Add an entry when a default placeholder fails validation, for example:
#   weather_api_url: https://placeholder.invalid/api
{}
`;
}

export function renderHook(release: string): string {
  return `#!/bin/sh
# Pre-commit checks for this configuration, managed by ha-bootstrap.
if [ -n "$DOMUSOPS_BOOTSTRAP_CLI" ]; then
  exec "$DOMUSOPS_BOOTSTRAP_CLI" check --staged
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "DomusOps pre-commit: npx not found. Install Node 22 or later to run these checks." >&2
  exit 1
fi
exec npx --prefer-offline --yes @domusops/bootstrap@${release} check --staged
`;
}

export function renderWorkflow(release: string): string {
  return `# Checks and validation for this configuration, managed by ha-bootstrap.
name: domusops
on:
  push:
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes @domusops/bootstrap@${release} check --all --ci
  validate:
    needs: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes @domusops/bootstrap@${release} validate --ci
`;
}
