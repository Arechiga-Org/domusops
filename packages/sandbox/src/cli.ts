#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SandboxError } from "./errors.js";
import { resolve as resolvePath } from "node:path";
import type { Sandbox } from "./instance/handle.js";
import {
  attachSandbox,
  cleanup,
  listSandboxes,
  startSandbox,
  stopSandbox,
} from "./index.js";
import type { SandboxListing } from "./instance/list.js";
import type { ConfigSummary } from "./types.js";
import {
  ownerMayBeAlive,
  processAlive,
  type Removal,
} from "./runtime/reaper.js";
import { validateOptions, type StartOptions } from "./instance/start.js";
import { resolveChannel } from "./release/resolve.js";
import {
  isChannel,
  type Channel,
  type ResolvedRelease,
} from "./release/versions.js";

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_COULD_NOT_RUN = 3;

const COULD_NOT_RUN = new Set<string>([
  "runtime_missing",
  "channel_unresolved",
  "image_unavailable",
]);

export interface CliDeps {
  start(options: StartOptions): Promise<Sandbox>;
  resolve(channel: Channel): Promise<ResolvedRelease>;
  attach(id: string): Promise<Sandbox>;
  list(): Promise<SandboxListing[]>;
  /** True for a tied instance whose owner may still be using it. */
  held(listing: SandboxListing): boolean;
  stop(id: string): Promise<void>;
  cleanup(): Promise<{ removed: Removal[] }>;
  /** Runs the command with the given environment; resolves to its exit code. */
  run(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number>;
  out(text: string): void;
  err(text: string): void;
  env: NodeJS.ProcessEnv;
}

class UsageError extends Error {}

const USAGE = `Usage:
  domusops-sandbox resolve <stable|previous-stable|beta> [--json]
  domusops-sandbox start [--channel <c> | --release <r>] [--max-lifetime <min>] [--readiness-timeout <s>] [--config <dir> [--secrets-file <file>]] [--json] -- <command> [args...]
  domusops-sandbox start --background [--channel <c> | --release <r>] [--max-lifetime <min>] [--readiness-timeout <s>] [--config <dir> [--secrets-file <file>]] [--json]
  domusops-sandbox env <id>
  domusops-sandbox list [--json]
  domusops-sandbox stop <id>... | --all [--force]
  domusops-sandbox cleanup [--json]
`;

function splitAtDashes(argv: readonly string[]): {
  own: string[];
  command: string[] | null;
} {
  const at = argv.indexOf("--");
  if (at === -1) return { own: [...argv], command: null };
  return { own: argv.slice(0, at), command: argv.slice(at + 1) };
}

function parseNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new UsageError(`--${name} needs a number, not "${raw}".`);
  }
  return value;
}

async function runResolve(own: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: own,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: true,
    strict: true,
  });
  const [channel, ...extra] = positionals;
  if (channel === undefined || extra.length > 0 || !isChannel(channel)) {
    throw new UsageError(
      "resolve takes one channel: stable, previous-stable or beta.",
    );
  }
  try {
    const resolved = await deps.resolve(channel);
    deps.out(
      values.json
        ? `${JSON.stringify({ channel, release: resolved.release, beta: resolved.beta })}\n`
        : `${resolved.release}\n`,
    );
    return EXIT_OK;
  } catch (error) {
    if (error instanceof SandboxError && error.code === "no_beta_in_progress") {
      deps.out(
        values.json
          ? `${JSON.stringify({ channel, release: null, reason: "no-beta-in-progress" })}\n`
          : "no beta in progress\n",
      );
      return EXIT_OK;
    }
    throw error;
  }
}

/** What was loaded from the configuration directory, as plain lines; empty without one. */
function describeConfig(config: ConfigSummary | null): string {
  if (config === null) return "";
  const secrets =
    config.secrets === "placeholders"
      ? `placeholders for ${String(config.placeholderKeys.length)} keys`
      : config.secrets === "caller-file"
        ? "the file you named"
        : "none referenced";
  const lines = [
    `config ${config.source}: ${String(config.files)} files, secrets: ${secrets}`,
  ];
  if (config.excluded.length > 0) {
    lines.push(`config left out: ${config.excluded.join(", ")}`);
  }
  if (config.skippedLinks.length > 0) {
    lines.push(
      `config skipped links that leave the directory: ${config.skippedLinks.join(", ")}`,
    );
  }
  if (config.userVirtualIntegration) {
    lines.push(
      "config ships its own custom_components/virtual: that copy is used",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function runStart(
  own: string[],
  command: string[] | null,
  deps: CliDeps,
): Promise<number> {
  const { values } = parseArgs({
    args: own,
    options: {
      channel: { type: "string" },
      release: { type: "string" },
      "readiness-timeout": { type: "string" },
      "max-lifetime": { type: "string" },
      config: { type: "string" },
      "secrets-file": { type: "string" },
      background: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  const background = values.background === true;
  if (background && command !== null) {
    throw new UsageError("--background takes no command.");
  }
  if (!background && (command === null || command.length === 0)) {
    throw new UsageError("start needs a command after `--`.");
  }
  if (values.channel !== undefined && values.release !== undefined) {
    throw new UsageError("Give either --channel or --release, not both.");
  }
  const options: StartOptions = {
    mode: background ? "background" : "tied",
    onProgress: (state, note) => {
      deps.err(note === undefined ? `${state}\n` : `${state}: ${note}\n`);
    },
  };
  if (values.channel !== undefined) {
    if (!isChannel(values.channel)) {
      throw new UsageError(
        "--channel must be stable, previous-stable or beta.",
      );
    }
    options.channel = values.channel;
  }
  if (values.release !== undefined) options.release = values.release;
  if (values["secrets-file"] !== undefined && values.config === undefined) {
    throw new UsageError("--secrets-file only goes with --config.");
  }
  if (values.config === "" || values["secrets-file"] === "") {
    throw new UsageError("--config and --secrets-file need a path.");
  }
  if (values.config !== undefined) {
    options.config = { dir: resolvePath(values.config) };
    if (values["secrets-file"] !== undefined) {
      options.config.secretsFile = resolvePath(values["secrets-file"]);
    }
  }
  const lifetime = values["max-lifetime"];
  if (lifetime !== undefined) {
    options.maxLifetimeMinutes = parseNumber("max-lifetime", lifetime);
  }
  const timeout = values["readiness-timeout"];
  if (timeout !== undefined) {
    options.readinessTimeoutSeconds = parseNumber("readiness-timeout", timeout);
  }

  try {
    validateOptions(options);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new UsageError(error.message);
    }
    throw error;
  }
  const sandbox = await deps.start(options);
  for (const removal of sandbox.reaped) {
    deps.err(`removed ${removal.id}: ${removal.reason}\n`);
  }
  if (background) {
    // Detached on purpose: the instance outlives this process. The token is never printed.
    await sandbox.detach();
    deps.out(
      values.json
        ? `${JSON.stringify(sandbox)}\n`
        : `id ${sandbox.id}\nrelease ${sandbox.release.release}\nurl ${sandbox.url}\ndeadline ${sandbox.deadline}\n${describeConfig(sandbox.config)}`,
    );
    return EXIT_OK;
  }
  try {
    deps.err(
      values.json
        ? `${JSON.stringify(sandbox)}\n`
        : describeConfig(sandbox.config),
    );
    // The CLI never reads DOMUSOPS_HA_* from its own environment; the child gets this instance's.
    const env: NodeJS.ProcessEnv = { ...deps.env, ...sandbox.mcpEnv() };
    const [program, ...args] = command as string[];
    return await deps.run([program as string, ...args], env);
  } finally {
    await sandbox.stop();
  }
}

async function runEnv(own: string[], deps: CliDeps): Promise<number> {
  const { positionals } = parseArgs({
    args: own,
    allowPositionals: true,
    strict: true,
  });
  const [id, ...extra] = positionals;
  if (id === undefined || extra.length > 0) {
    throw new UsageError("env takes exactly one instance id.");
  }
  const env = (await deps.attach(id)).mcpEnv();
  deps.out(
    `DOMUSOPS_HA_URL=${env.DOMUSOPS_HA_URL}\nDOMUSOPS_HA_TOKEN=${env.DOMUSOPS_HA_TOKEN}\n`,
  );
  return EXIT_OK;
}

async function runList(own: string[], deps: CliDeps): Promise<number> {
  const { values } = parseArgs({
    args: own,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
    strict: true,
  });
  const listings = await deps.list();
  if (values.json) {
    deps.out(`${JSON.stringify(listings)}\n`);
  } else if (listings.length === 0) {
    deps.out("no sandbox instances\n");
  } else {
    for (const l of listings) {
      const owner =
        l.owner === null ? "-" : `${l.owner.host}:${String(l.owner.pid)}`;
      deps.out(
        `${l.id}  ${l.mode}  ${l.release}  ${l.url ?? "-"}  until ${l.deadline}  owner ${owner}\n`,
      );
    }
  }
  return EXIT_OK;
}

async function runStop(own: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: own,
    options: {
      all: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.all === positionals.length > 0) {
    throw new UsageError("stop takes instance ids, or --all, not both.");
  }
  if (values.force && !values.all) {
    throw new UsageError("--force only goes with --all.");
  }
  let ids = positionals;
  if (values.all) {
    // Another process is using a tied instance while its owner lives: only --force takes it.
    ids = [];
    for (const listing of await deps.list()) {
      if (!values.force && deps.held(listing) && listing.owner !== null) {
        deps.err(
          `kept ${listing.id}: tied to ${listing.owner.host}:${String(listing.owner.pid)}, which may still be running (--force stops it anyway)\n`,
        );
      } else {
        ids.push(listing.id);
      }
    }
  }
  let failed = false;
  for (const id of ids) {
    try {
      await deps.stop(id);
      deps.out(`stopped ${id}\n`);
    } catch (error) {
      if (!(error instanceof SandboxError)) throw error;
      failed = true;
      deps.err(`Error (${error.code}): ${error.message}\n`);
    }
  }
  return failed ? EXIT_FAILURE : EXIT_OK;
}

async function runCleanup(own: string[], deps: CliDeps): Promise<number> {
  const { values } = parseArgs({
    args: own,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: false,
    strict: true,
  });
  const { removed } = await deps.cleanup();
  if (values.json) {
    deps.out(
      `${JSON.stringify(removed.map(({ id, reason }) => ({ id, reason })))}\n`,
    );
  } else if (removed.length === 0) {
    deps.out("nothing to clean up\n");
  } else {
    for (const removal of removed)
      deps.out(`removed ${removal.id}: ${removal.reason}\n`);
  }
  return EXIT_OK;
}

export async function main(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  try {
    const { own, command } = splitAtDashes(argv);
    const [name, ...rest] = own;
    if (name === "resolve") return await runResolve(rest, deps);
    if (name === "start") return await runStart(rest, command, deps);
    if (command !== null) throw new UsageError("`--` is only used by start.");
    if (name === "env") return await runEnv(rest, deps);
    if (name === "list") return await runList(rest, deps);
    if (name === "stop") return await runStop(rest, deps);
    if (name === "cleanup") return await runCleanup(rest, deps);
    throw new UsageError(
      name === undefined ? "No command given." : `Unknown command "${name}".`,
    );
  } catch (error) {
    if (error instanceof UsageError) {
      deps.err(`${error.message}\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof TypeError && "code" in error) {
      // parseArgs reports unknown flags and missing values as coded TypeErrors.
      deps.err(`${error.message}\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof SandboxError) {
      deps.err(`Error (${error.code}): ${error.message}\n`);
      for (const line of error.logs ?? []) deps.err(`  ${line}\n`);
      return COULD_NOT_RUN.has(error.code) ? EXIT_COULD_NOT_RUN : EXIT_FAILURE;
    }
    deps.err(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_FAILURE;
  }
}

function runCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve) => {
    const [program, ...args] = argv;
    const child = spawn(program as string, args, { env, stdio: "inherit" });
    child.on("error", (error) => {
      process.stderr.write(`Could not run ${program}: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      resolve(code ?? (signal === null ? 1 : 128));
    });
  });
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1])) {
  const code = await main(process.argv.slice(2), {
    start: startSandbox,
    resolve: (channel) => resolveChannel(channel),
    attach: attachSandbox,
    list: listSandboxes,
    held: (listing) => ownerMayBeAlive(listing, hostname(), processAlive),
    stop: stopSandbox,
    cleanup,
    run: runCommand,
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    env: process.env,
  });
  process.exit(code);
}
