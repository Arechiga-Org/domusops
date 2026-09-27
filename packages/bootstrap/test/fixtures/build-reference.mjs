#!/usr/bin/env node
/**
 * Builds a reference Home Assistant configuration directory for the ha-bootstrap tests and
 * quickstart scenarios (quickstart.md "Prerequisites"). Every value is fake; nothing here is a
 * real credential. Options select the spec's edge-case variants.
 *
 * Usage: node build-reference.mjs <dir> [--config-error] [--no-secrets]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {{
 *   alreadyRepo?: boolean,
 *   existingGitignore?: boolean,
 *   packagesForm?: "absent" | "block" | "declared" | "flow-map" | "include-tag",
 *   noSecrets?: boolean,
 *   nestedSecrets?: boolean,
 *   secretsTracked?: boolean,
 *   secretsInHistory?: boolean,
 *   customComponentsTracked?: boolean,
 *   configError?: boolean,
 *   manyYamlFiles?: number,
 * }} FixtureOptions
 */

const FAKE_WIFI_PASSWORD = "fake-wifi-password-1";
const FAKE_WEBHOOK_SECRET = "fake-webhook-secret-2";
const FAKE_INLINE_SECRET = "fake-inline-backup-secret-3";

/** The five `homeassistant`/`packages` shapes of research R5. `null` means the key is absent. */
function homeassistantBlock(packagesForm) {
  switch (packagesForm) {
    case "absent":
      return null;
    case "declared":
      // Any existing `packages` key, in whatever form: leave as is, report it (research R5).
      return [
        "homeassistant:",
        "  name: Home",
        "  time_zone: Europe/Amsterdam",
        "  unit_system: metric",
        "  packages: !include_dir_merge_named packages",
      ].join("\n");
    case "flow-map":
      return "homeassistant: { name: Home, time_zone: Europe/Amsterdam }";
    case "include-tag":
      return "homeassistant: !include homeassistant.yaml";
    case "block":
    default:
      return [
        "homeassistant:",
        "  name: Home",
        "  time_zone: Europe/Amsterdam",
        "  unit_system: metric",
      ].join("\n");
  }
}

/**
 * @param {string} dir
 * @param {FixtureOptions} [options]
 */
export function buildReference(dir, options = {}) {
  mkdirSync(dir, { recursive: true });

  if (options.alreadyRepo) {
    execFileSync("git", ["init", "--quiet"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: dir });
  }

  const shellCommand = options.noSecrets
    ? `shell_command:\n  backup_password: "${FAKE_INLINE_SECRET}"\n`
    : `shell_command:\n  backup_password: "${FAKE_INLINE_SECRET}"\n  notify_webhook: !secret webhook_secret\n`;

  const frontend = options.configError
    ? "frontend:\n  this_key_does_not_exist: true\n"
    : "frontend:\n";

  const haBlock = homeassistantBlock(options.packagesForm ?? "block");
  const configLines = [
    ...(haBlock === null ? [] : [haBlock, ""]),
    frontend,
    "automation: !include automations.yaml",
    "",
    "example:",
    "",
    shellCommand,
  ];
  writeFileSync(join(dir, "configuration.yaml"), `${configLines.join("\n")}\n`);
  if (options.packagesForm === "include-tag") {
    writeFileSync(
      join(dir, "homeassistant.yaml"),
      "name: Home\ntime_zone: Europe/Amsterdam\nunit_system: metric\n",
    );
  }

  writeFileSync(
    join(dir, "automations.yaml"),
    [
      '- id: "1"',
      "  alias: Example automation",
      "  trigger:",
      "    - platform: time",
      '      at: "07:00:00"',
      "  action:",
      "    - service: light.turn_on",
      "      target:",
      "        entity_id: light.example",
      "",
    ].join("\n"),
  );

  if (!options.noSecrets) {
    writeFileSync(
      join(dir, "secrets.yaml"),
      `wifi_password: ${FAKE_WIFI_PASSWORD}\nwebhook_secret: ${FAKE_WEBHOOK_SECRET}\n`,
    );
  }

  if (options.nestedSecrets) {
    mkdirSync(join(dir, "some_subdir"), { recursive: true });
    writeFileSync(join(dir, "some_subdir", "secrets.yaml"), "nested_key: fake-nested-value\n");
  }

  if (options.existingGitignore) {
    writeFileSync(join(dir, ".gitignore"), "*.bak\nmy-own-notes.md\n");
  }

  // Runtime files the instance itself writes; excluded by the baseline (research R4).
  writeFileSync(join(dir, "home-assistant_v2.db"), "sqlite-fixture");
  writeFileSync(join(dir, "home-assistant_v2.db-shm"), "shm-fixture");
  writeFileSync(join(dir, "home-assistant_v2.db-wal"), "wal-fixture");
  writeFileSync(join(dir, "home-assistant.log"), "fixture log line\n");
  mkdirSync(join(dir, ".storage"), { recursive: true });
  writeFileSync(join(dir, ".storage", "lovelace"), '{"version":1,"data":{}}\n');
  writeFileSync(join(dir, ".HA_VERSION"), "2026.9.3\n");

  // A custom integration: not referenced by anything real, so it is a filesystem-only finding
  // (`findCustomIntegrations`) here, and — because custom_components/ is excluded from version
  // control — an `IntegrationNotFound` *warning*, not an error, when `validate` copies only
  // tracked and untracked-not-ignored files (research R9): `example:` above resolves against
  // nothing in that copy.
  mkdirSync(join(dir, "custom_components", "example"), { recursive: true });
  writeFileSync(
    join(dir, "custom_components", "example", "manifest.json"),
    `${JSON.stringify(
      {
        domain: "example",
        name: "Example",
        version: "1.0.0",
        documentation: "https://example.invalid",
        requirements: [],
        codeowners: [],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "custom_components", "example", "__init__.py"),
    "# fixture-only, never loaded by the tests\n",
  );

  mkdirSync(join(dir, "www", "community", "example-card"), { recursive: true });
  writeFileSync(join(dir, "www", "community", "example-card", "card.js"), "// fixture\n");

  if (options.manyYamlFiles !== undefined && options.manyYamlFiles > 0) {
    const perfDir = join(dir, "perf_yaml");
    mkdirSync(perfDir, { recursive: true });
    for (let i = 0; i < options.manyYamlFiles; i++) {
      writeFileSync(join(perfDir, `file_${i}.yaml`), `key_${i}: value_${i}\n`);
    }
  }

  if (options.alreadyRepo && (options.secretsTracked || options.secretsInHistory)) {
    execFileSync("git", ["add", "secrets.yaml"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture: add secrets.yaml"], { cwd: dir });
    if (options.secretsInHistory && !options.secretsTracked) {
      execFileSync("git", ["rm", "--cached", "--quiet", "secrets.yaml"], { cwd: dir });
      execFileSync("git", ["commit", "--quiet", "-m", "fixture: untrack secrets.yaml"], {
        cwd: dir,
      });
    }
  }

  if (options.alreadyRepo && options.customComponentsTracked) {
    execFileSync("git", ["add", "custom_components", "www/community"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture: track custom_components"], {
      cwd: dir,
    });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(process.argv[1], "file:").href;
if (isMain) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("usage: build-reference.mjs <dir> [--config-error] [--no-secrets]");
    process.exit(64);
  }
  buildReference(dir, {
    configError: process.argv.includes("--config-error"),
    noSecrets: process.argv.includes("--no-secrets"),
  });
  console.log(`Reference fixture written to ${dir}`);
}
