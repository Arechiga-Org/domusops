import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CliArgs } from "../cli-args.js";
import { EXIT_OK, EXIT_PROBLEMS, EXIT_STOPPED } from "../exit-codes.js";
import {
  isConfigDir,
  notConfigDirStop,
  runScopeGuard,
} from "../cli-support.js";
import { lsFilesAll, lsFilesUntrackedNotIgnored } from "../env/git.js";
import { detectRuntime, runCheckConfig } from "../env/container.js";
import { readRecordedInstanceVersion } from "../baseline/instance-version.js";
import { parseEncType } from "../env/sops.js";

/** research R7's typed default, keyed by the SOPS `type:` tag and a hint from the key's name. */
function typedDefault(key: string, sopsType: string | null): unknown {
  switch (sopsType) {
    case "int":
      return /port/i.test(key) ? 8080 : 1;
    case "float":
      return 0.0;
    case "bool":
      return false;
    default:
      if (/url/i.test(key)) return "http://placeholder.invalid";
      if (/email/i.test(key)) return "placeholder@example.com";
      return "domusops-placeholder";
  }
}

/**
 * Placeholder secrets for validation only (research R7): one per key of `secrets.sops.yaml`,
 * typed from SOPS's own `ENC[...,type:x]` tag, overridden by `.domusops/placeholders.yaml`.
 * Throws when the override file exists but its top level is not a mapping.
 */
export function buildPlaceholderSecrets(dir: string): Record<string, unknown> {
  const placeholders: Record<string, unknown> = {};
  const encPath = join(dir, "secrets.sops.yaml");
  if (existsSync(encPath)) {
    const doc = parseYaml(readFileSync(encPath, "utf8")) as Record<
      string,
      unknown
    > | null;
    for (const [key, value] of Object.entries(doc ?? {})) {
      if (key === "sops") continue;
      const sopsType = typeof value === "string" ? parseEncType(value) : null;
      placeholders[key] = typedDefault(key, sopsType);
    }
  }
  const overridePath = join(dir, ".domusops", "placeholders.yaml");
  if (existsSync(overridePath)) {
    const overrides = parseYaml(readFileSync(overridePath, "utf8"));
    if (
      typeof overrides !== "object" ||
      overrides === null ||
      Array.isArray(overrides)
    ) {
      throw new Error(
        ".domusops/placeholders.yaml: the top level must be a mapping",
      );
    }
    Object.assign(placeholders, overrides as Record<string, unknown>);
  }
  return placeholders;
}

function copyTrackedTree(dir: string, dest: string): void {
  const files = [
    ...new Set([...lsFilesAll(dir), ...lsFilesUntrackedNotIgnored(dir)]),
  ];
  for (const rel of files) {
    const src = join(dir, rel);
    const target = join(dest, rel);
    try {
      const content = readFileSync(src);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    } catch {
      // Racily removed or unreadable; validate proceeds without it, as check_config would.
    }
  }
}

interface CheckConfigJson {
  total_errors: number;
  total_warnings: number;
  errors: Record<string, unknown[]>;
  warnings: Record<string, unknown[]>;
  components: string[];
}

function printMessages(
  domainMessages: Record<string, unknown[]>,
  level: "error" | "warning",
  ci: boolean,
): void {
  const log = level === "error" ? console.error : console.log;
  for (const [domain, entries] of Object.entries(domainMessages)) {
    for (const entry of entries) {
      if (typeof entry !== "string") continue; // the rest is the raw config, printed only above
      log(`${level}(${domain}): ${entry}`);
      if (ci) console.log(`::${level}::${domain}: ${entry}`);
    }
  }
}

/** `validate [--ci]` (research R9, [cli.md](../../../../specs/004-ha-bootstrap/contracts/cli.md)). */
export function runValidate(args: CliArgs): number {
  const stop = runScopeGuard(["git"]);
  if (stop !== null) {
    console.error(`Stopped: ${stop.reason}\n${stop.message}`);
    for (const detail of stop.details ?? []) console.error(`  - ${detail}`);
    return EXIT_STOPPED;
  }
  if (!isConfigDir(args.dir)) {
    const cfgStop = notConfigDirStop();
    console.error(`Stopped: ${cfgStop.reason}\n${cfgStop.message}`);
    return EXIT_STOPPED;
  }
  const runtime = detectRuntime();
  if (runtime === null) {
    console.error(
      "validate needs a container runtime; neither docker nor podman was found on PATH.\n" +
        "  macOS: brew install --cask docker (or: brew install podman)\n" +
        "  Debian/Ubuntu: sudo apt install docker.io (or: sudo apt install podman)",
    );
    return EXIT_STOPPED;
  }
  const version = readRecordedInstanceVersion(args.dir);
  if (version === null) {
    console.error(
      "No usable .domusops/instance-version was found (expected YYYY.M.P, e.g. 2026.9.3).",
    );
    return EXIT_STOPPED;
  }

  let placeholders: Record<string, unknown>;
  try {
    placeholders = buildPlaceholderSecrets(args.dir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_PROBLEMS;
  }

  const tmp = mkdtempSync(join(tmpdir(), "domusops-validate-"));
  try {
    copyTrackedTree(args.dir, tmp);
    writeFileSync(join(tmp, "secrets.yaml"), stringifyYaml(placeholders));
    const result = runCheckConfig(runtime, version, tmp);
    let parsed: CheckConfigJson;
    try {
      parsed = JSON.parse(result.stdout) as CheckConfigJson;
    } catch {
      console.error("Could not parse the validator's output:");
      console.error(result.stdout || result.stderr);
      return EXIT_PROBLEMS;
    }
    printMessages(parsed.errors, "error", args.ci);
    printMessages(parsed.warnings, "warning", args.ci);
    console.log(
      `${parsed.total_errors} error(s), ${parsed.total_warnings} warning(s).`,
    );
    return parsed.total_errors > 0 ? EXIT_PROBLEMS : EXIT_OK;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
