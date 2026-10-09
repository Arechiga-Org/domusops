import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Header, Pack, ReadEntry } from "tar";
import { SandboxError } from "../errors.js";
import type { ConfigSummary } from "../types.js";
import { buildSecrets, referencedSecrets, secretValues } from "./secrets.js";

/** Where the instance's configuration lives inside the container. */
export const CONFIG_ROOT = "config";

export const COMPANION_DOMAIN = "domusops_sandbox";

export const BASELINE_CONFIGURATION = `default_config:

${COMPANION_DOMAIN}:
`;

/** Builds a tar archive in memory: nothing is written to the host. */
export class TarBuilder {
  private readonly pack = new Pack({ portable: true });
  private readonly chunks: Buffer[] = [];
  private readonly finished: Promise<void>;

  constructor() {
    this.pack.on("data", (chunk: Buffer) => this.chunks.push(chunk));
    this.finished = new Promise((resolve, reject) => {
      this.pack.on("end", resolve);
      this.pack.on("error", reject);
    });
  }

  addDirectory(path: string, mode = 0o755): void {
    this.add(`${path}/`, Buffer.alloc(0), mode, "Directory");
  }

  addFile(path: string, data: Buffer | string, mode = 0o644): void {
    this.add(
      path,
      typeof data === "string" ? Buffer.from(data) : data,
      mode,
      "File",
    );
  }

  addSymlink(path: string, target: string): void {
    const header = new Header({
      path,
      mode: 0o777,
      size: 0,
      type: "SymbolicLink",
      linkpath: target,
      mtime: new Date(0),
      uid: 0,
      gid: 0,
    });
    const entry = new ReadEntry(header);
    entry.end();
    this.pack.add(entry);
  }

  async finish(): Promise<Buffer> {
    this.pack.end();
    await this.finished;
    return Buffer.concat(this.chunks);
  }

  private add(
    path: string,
    data: Buffer,
    mode: number,
    type: "File" | "Directory",
  ): void {
    const header = new Header({
      path,
      mode,
      size: data.length,
      type,
      mtime: new Date(0),
      uid: 0,
      gid: 0,
    });
    const entry = new ReadEntry(header);
    entry.end(data);
    this.pack.add(entry);
  }
}

/** The companion integration, shipped next to `dist/` and `src/`. */
export function companionDirectory(): string {
  return fileURLToPath(new URL("../../companion/", import.meta.url));
}

function addCompanion(builder: TarBuilder): void {
  const root = join(
    companionDirectory(),
    "custom_components",
    COMPANION_DOMAIN,
  );
  const target = posix.join(CONFIG_ROOT, "custom_components", COMPANION_DOMAIN);
  builder.addDirectory(posix.join(CONFIG_ROOT, "custom_components"));
  builder.addDirectory(target);
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name === "__pycache__") continue;
      const full = join(directory, name);
      const inside = posix.join(prefix, name);
      if (statSync(full).isDirectory()) {
        builder.addDirectory(inside);
        walk(full, inside);
      } else {
        builder.addFile(inside, readFileSync(full));
      }
    }
  };
  walk(root, target);
}

export interface ConfigSource {
  /** The configuration directory; it is only ever read. */
  dir: string;
  /** A plaintext secrets file to use as is, instead of placeholders. */
  secretsFile?: string;
}

export interface PackResult {
  /** The tar archive to extract at the root of the container. */
  archive: Buffer;
  /** What was loaded; `null` for the baseline configuration. */
  summary: ConfigSummary | null;
  /** Values from a caller-named secrets file, to keep out of any error text. */
  secretValues: string[];
}

const ROOT_DIRECTORIES = new Set([
  ".storage",
  ".cloud",
  "deps",
  "tts",
  "backups",
  "media",
]);
const ANY_DIRECTORIES = new Set([
  "__pycache__",
  ".git",
  "node_modules",
  ".venv",
  ".cache",
  ".mypy_cache",
  ".ruff_cache",
  ".pytest_cache",
]);
/** A configuration directory is text; a tree larger than this is carrying something else. */
export const MAX_CONFIG_BYTES = 256 * 1024 * 1024;
const SECRET_FILES = new Set(["secrets.yaml", "secrets.sops.yaml"]);
const AGE_KEY_FILES = new Set(["keys.txt", "age.key", "age-key.txt"]);
const COMPANION_PATH = `custom_components/${COMPANION_DOMAIN}`;

/** The exclusion pattern that applies to an entry, or `null` when it is carried over. */
function excludedBy(
  name: string,
  relativePath: string,
  isDirectory: boolean,
): string | null {
  const atRoot = !relativePath.includes("/");
  if (relativePath === COMPANION_PATH) return `${COMPANION_PATH}/`;
  if (ANY_DIRECTORIES.has(name)) return `${name}/`;
  if (isDirectory) {
    return atRoot && ROOT_DIRECTORIES.has(name) ? `${name}/` : null;
  }
  if (SECRET_FILES.has(name)) return name;
  if (AGE_KEY_FILES.has(name) || name.endsWith(".agekey")) {
    return "age key files";
  }
  if (/\.log(\.(\d+|old|fault))?$/.test(name)) return "*.log*";
  if (atRoot && name.startsWith("home-assistant_v2.db")) {
    return "home-assistant_v2.db*";
  }
  if (atRoot && name === ".HA_VERSION") return name;
  return null;
}

function invalid(message: string): SandboxError {
  return new SandboxError("config_dir_invalid", message);
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function readUtf8(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw invalid(
      `${what} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Opens `source` read-only and adds what belongs in the instance to `builder`. */
function addSource(
  builder: TarBuilder,
  source: ConfigSource,
): { summary: ConfigSummary; secretValues: string[] } {
  let root: string;
  try {
    root = realpathSync(source.dir);
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
  } catch {
    throw invalid(`${source.dir} is not a directory that can be read.`);
  }
  let configuration: string;
  try {
    // A link is fine when it stays inside the directory: the instance gets a regular file.
    const resolved = realpathSync(join(root, "configuration.yaml"));
    if (!inside(root, resolved) || !statSync(resolved).isFile()) {
      throw new Error("not a regular file inside the directory");
    }
    configuration = readFileSync(resolved, "utf8");
  } catch {
    throw invalid(
      `${source.dir} has no configuration.yaml: it is not a Home Assistant configuration directory.`,
    );
  }

  let callerSecrets: string | undefined;
  if (source.secretsFile !== undefined) {
    try {
      if (!statSync(source.secretsFile).isFile()) throw new Error("not a file");
    } catch {
      throw invalid(`${source.secretsFile} is not a file that can be read.`);
    }
    callerSecrets = readUtf8(source.secretsFile, source.secretsFile);
  }

  const excluded = new Set<string>();
  const skippedLinks: string[] = [];
  const referenced: string[] = [];
  let files = 0;
  let bytes = 0;
  let userVirtualIntegration = false;

  const note = (text: string): void => {
    for (const key of referencedSecrets(text)) {
      if (!referenced.includes(key)) referenced.push(key);
    }
  };

  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const target = posix.join(CONFIG_ROOT, relativePath);
      const entry = lstatSync(full);
      const pattern = excludedBy(
        name,
        relativePath,
        entry.isDirectory() || entry.isSymbolicLink(),
      );
      if (pattern !== null) {
        excluded.add(pattern);
        continue;
      }
      if (relativePath === "configuration.yaml") {
        files += 1;
        note(configuration);
        builder.addFile(target, withCompanion(configuration));
        continue;
      }
      if (entry.isSymbolicLink()) {
        let resolved: string | null = null;
        try {
          resolved = realpathSync(full);
        } catch {
          // dangling: reported below
        }
        if (
          resolved === null ||
          !inside(root, resolved) ||
          leadsIntoExcluded(relative(root, resolved))
        ) {
          skippedLinks.push(relativePath);
        } else {
          const link = relative(directory, resolved).split("\\").join("/");
          builder.addSymlink(target, link === "" ? "." : link);
        }
      } else if (entry.isDirectory()) {
        if (relativePath === "custom_components/virtual") {
          userVirtualIntegration = true;
        }
        builder.addDirectory(target);
        walk(full, relativePath);
      } else if (entry.isFile()) {
        files += 1;
        bytes += entry.size;
        if (bytes > MAX_CONFIG_BYTES) {
          throw invalid(
            `${source.dir} holds more than ${String(MAX_CONFIG_BYTES / 1024 / 1024)} MiB of files (passing ${relativePath}): a configuration directory is text, so keep media and caches out of it.`,
          );
        }
        const data = readFileSync(full);
        if (/\.ya?ml$/.test(name)) note(data.toString("utf8"));
        builder.addFile(target, data, entry.mode & 0o111 ? 0o755 : 0o644);
      }
      // Sockets, pipes and devices are not configuration.
    }
  };
  builder.addDirectory(CONFIG_ROOT);
  walk(root, "");

  const sopsPath = join(root, "secrets.sops.yaml");
  const sops =
    callerSecrets === undefined && existsAsFile(sopsPath)
      ? readUtf8(sopsPath, "secrets.sops.yaml")
      : undefined;
  const secrets = buildSecrets({
    referenced,
    ...(sops === undefined ? {} : { sopsText: sops }),
    ...(callerSecrets === undefined ? {} : { callerFile: callerSecrets }),
  });
  if (secrets.content !== null) {
    builder.addFile(posix.join(CONFIG_ROOT, "secrets.yaml"), secrets.content);
  }

  return {
    summary: {
      source: root,
      files,
      excluded: [...excluded].sort(),
      skippedLinks: skippedLinks.sort(),
      secrets: secrets.kind,
      placeholderKeys: secrets.placeholderKeys,
      userVirtualIntegration,
    },
    secretValues: callerSecrets === undefined ? [] : secretValues(callerSecrets),
  };
}

/** True when a path inside the source passes through something that is not carried over. */
function leadsIntoExcluded(relativePath: string): boolean {
  const parts = relativePath.split(sep);
  return parts.some((part, index) => {
    const path = parts.slice(0, index + 1).join("/");
    return (
      excludedBy(part, path, true) !== null ||
      excludedBy(part, path, false) !== null
    );
  });
}

function existsAsFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** The caller's `configuration.yaml` with the line that loads the companion. */
function withCompanion(configuration: string): string {
  if (new RegExp(`^${COMPANION_DOMAIN}:`, "m").test(configuration)) {
    return configuration;
  }
  const separator = configuration.endsWith("\n") ? "" : "\n";
  return `${configuration}${separator}\n${COMPANION_DOMAIN}:\n`;
}

/**
 * The archive for a new instance: the caller's configuration directory when one is given, the
 * baseline otherwise, plus the companion. Nothing is written on the host, source included.
 */
export async function packConfig(source?: ConfigSource): Promise<PackResult> {
  const builder = new TarBuilder();
  let summary: ConfigSummary | null = null;
  let values: string[] = [];
  if (source === undefined) {
    builder.addDirectory(CONFIG_ROOT);
    builder.addFile(
      posix.join(CONFIG_ROOT, "configuration.yaml"),
      BASELINE_CONFIGURATION,
    );
  } else {
    try {
      ({ summary, secretValues: values } = addSource(builder, source));
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw invalid(
        `${source.dir} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  addCompanion(builder);
  return { archive: await builder.finish(), summary, secretValues: values };
}
