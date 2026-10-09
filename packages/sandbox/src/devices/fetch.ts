import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { Parser } from "tar";
import { SandboxError } from "../errors.js";

/** The virtual-device integration the sandbox reuses (research R7), pinned by content. */
export const VIRTUAL_VERSION = "0.9.3";
export const VIRTUAL_SHA256 =
  "78d25f0d886aeaaba69909a5279632600e80e0a1c29a33cfeca272afe94e2e0b";
export const VIRTUAL_URL = `https://github.com/twrecked/hass-virtual/archive/refs/tags/v${VIRTUAL_VERSION}.tar.gz`;

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_TARBALL_BYTES = 8 * 1024 * 1024;

/** One file of the integration, with a path relative to `custom_components/virtual/`. */
export interface VirtualFile {
  path: string;
  data: Buffer;
}

export interface FetchOptions {
  /** Default `$XDG_CACHE_HOME/domusops/sandbox`, else `~/.cache/domusops/sandbox`. */
  cacheDir?: string;
  /** A test seam for the download. */
  download?: (url: string) => Promise<Buffer>;
}

export function defaultCacheDirectory(): string {
  const base = process.env["XDG_CACHE_HOME"];
  return join(
    base !== undefined && base !== "" ? base : join(homedir(), ".cache"),
    "domusops",
    "sandbox",
  );
}

function unavailable(detail: string): SandboxError {
  return new SandboxError(
    "virtual_unavailable",
    `The virtual-device integration (hass-virtual v${VIRTUAL_VERSION}) is not available: ${detail}`,
  );
}

async function downloadTarball(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_TARBALL_BYTES) {
    throw new Error(`${url} is larger than expected`);
  }
  return body;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The cached tarball when it is there and matches the pin, else null. */
function readCached(path: string): Buffer | null {
  try {
    const data = readFileSync(path);
    return sha256(data) === VIRTUAL_SHA256 ? data : null;
  } catch {
    return null;
  }
}

/** The files under `custom_components/virtual/` of a GitHub release tarball. */
export async function extractIntegration(
  tarball: Buffer,
): Promise<VirtualFile[]> {
  const files: VirtualFile[] = [];
  const parser = new Parser({
    filter: (path) => /^[^/]+\/custom_components\/virtual\//.test(path),
    onReadEntry: (entry) => {
      if (entry.type !== "File") {
        entry.resume();
        return;
      }
      const relativePath = entry.path.split("/").slice(3).join("/");
      const chunks: Buffer[] = [];
      entry.on("data", (chunk: Buffer) => chunks.push(chunk));
      entry.on("end", () => {
        if (
          relativePath !== "" &&
          !relativePath.split("/").includes("..") &&
          !posix.isAbsolute(relativePath)
        ) {
          files.push({ path: relativePath, data: Buffer.concat(chunks) });
        }
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    parser.on("end", resolve);
    parser.on("error", reject);
    parser.end(tarball);
  });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The integration's files, from the cache when it holds the pinned tarball, otherwise downloaded,
 * checked against the pinned SHA-256 and cached. A download that fails or does not match is
 * `virtual_unavailable`; nothing unverified is ever cached or used.
 */
export async function ensureVirtualIntegration(
  options: FetchOptions = {},
): Promise<VirtualFile[]> {
  const cacheDir = options.cacheDir ?? defaultCacheDirectory();
  const cached = join(cacheDir, `hass-virtual-${VIRTUAL_VERSION}.tar.gz`);
  let tarball = readCached(cached);
  if (tarball === null) {
    let downloaded: Buffer;
    try {
      downloaded = await (options.download ?? downloadTarball)(VIRTUAL_URL);
    } catch (error) {
      throw unavailable(
        `it could not be downloaded (${error instanceof Error ? error.message : String(error)}). The first run that uses virtual devices needs network access.`,
      );
    }
    if (sha256(downloaded) !== VIRTUAL_SHA256) {
      throw unavailable(
        "the download does not match the pinned checksum, so it was not used.",
      );
    }
    tarball = downloaded;
    try {
      mkdirSync(cacheDir, { recursive: true });
      const temporary = `${cached}.${String(process.pid)}.tmp`;
      writeFileSync(temporary, tarball);
      renameSync(temporary, cached);
    } catch {
      // A cache that cannot be written only costs the next run another download.
    }
  }
  let files: VirtualFile[];
  try {
    files = await extractIntegration(tarball);
  } catch (error) {
    throw unavailable(
      `the archive could not be read (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!files.some((file) => file.path === "manifest.json")) {
    throw unavailable("the archive does not contain the integration.");
  }
  return files;
}
