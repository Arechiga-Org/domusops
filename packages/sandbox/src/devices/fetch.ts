import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { Parser } from "tar";
import { SandboxError } from "../errors.js";

/**
 * The virtual-device integration the sandbox reuses (research R7), pinned by an immutable commit
 * and verified by a digest of its files, not of the archive GitHub builds from it: GitHub does not
 * promise the bytes of an archive stay the same, and the digest survives that (specs/007-debt-paydown
 * research R13). `VIRTUAL_VERSION` is for display; the commit is what `v0.9.4` pointed to when it
 * was pinned, and the digest was taken from that release's files.
 */
export const VIRTUAL_VERSION = "0.9.4";
export const VIRTUAL_COMMIT = "a056ceaf73d4907e258ae055c3541342a3275400";
export const VIRTUAL_CONTENT_SHA256 =
  "20f02c630d5ce22f169e0a39efeb600b9e9e5f50c3dbfab8c120e57ad27ae2a3";
export const VIRTUAL_URL = `https://github.com/twrecked/hass-virtual/archive/${VIRTUAL_COMMIT}.tar.gz`;

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
  /** A test seam for the pinned content digest. */
  digest?: string;
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
  const tooLarge = new Error(`${url} is larger than expected`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_TARBALL_BYTES) throw tooLarge;
  if (response.body === null) throw new Error(`${url} sent no body`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_TARBALL_BYTES) throw tooLarge;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The digest the pin is checked against: the SHA-256 of one line per file, sorted by path, with the
 * path, a NUL, the SHA-256 of the file in lowercase hex, and a newline.
 */
export function contentDigest(files: readonly VirtualFile[]): string {
  const lines = [...files]
    .sort((a, b) => byPath(a.path, b.path))
    .map((file) => `${file.path}\0${sha256(file.data)}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** Where the extracted files of the pinned commit are kept. */
function cacheEntry(cacheDir: string): string {
  return join(cacheDir, `hass-virtual-${VIRTUAL_COMMIT}`);
}

/** The files under `directory`, relative to it; null when it holds anything but plain files. */
function readTree(directory: string, prefix = ""): VirtualFile[] | null {
  const files: VirtualFile[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    const info = lstatSync(path);
    if (info.isDirectory()) {
      const inner = readTree(path, relative);
      if (inner === null) return null;
      files.push(...inner);
    } else if (info.isFile()) {
      files.push({ path: relative, data: readFileSync(path) });
    } else {
      return null;
    }
  }
  return files;
}

/**
 * The cached files when they are there and match the pin. An entry that does not match is deleted,
 * so the next step downloads it again once.
 */
function readCached(directory: string, digest: string): VirtualFile[] | null {
  let files: VirtualFile[] | null;
  try {
    files = readTree(directory);
  } catch {
    return null;
  }
  if (files !== null && contentDigest(files) === digest) {
    return files;
  }
  rmSync(directory, { recursive: true, force: true });
  return null;
}

/** Writes verified files next to the cache entry and renames them into place. */
function writeCache(directory: string, files: readonly VirtualFile[]): void {
  const temporary = `${directory}.${String(process.pid)}.tmp`;
  try {
    rmSync(temporary, { recursive: true, force: true });
    for (const file of files) {
      const target = join(temporary, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.data);
    }
    renameSync(temporary, directory);
  } catch {
    // A cache that cannot be written only costs the next run another download.
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** The files under `custom_components/virtual/` of a GitHub release tarball. */
export async function extractIntegration(
  tarball: Buffer,
): Promise<VirtualFile[]> {
  const files: VirtualFile[] = [];
  let link: string | null = null;
  const parser = new Parser({
    filter: (path) => /^[^/]+\/custom_components\/virtual\//.test(path),
    onReadEntry: (entry) => {
      if (entry.type === "SymbolicLink" || entry.type === "Link") {
        link = entry.path;
        entry.resume();
        return;
      }
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
  // A link inside the integration could point anywhere once it is unpacked.
  if (link !== null) throw new Error(`it contains a link (${String(link)})`);
  return files.sort((a, b) => byPath(a.path, b.path));
}

/**
 * The integration's files, from the cache when it holds files that match the pin, otherwise
 * downloaded by the pinned commit and checked against the content digest before anything is cached
 * or used. A download that fails, cannot be read, or does not match is `virtual_unavailable`.
 */
export async function ensureVirtualIntegration(
  options: FetchOptions = {},
): Promise<VirtualFile[]> {
  const entry = cacheEntry(options.cacheDir ?? defaultCacheDirectory());
  const digest = options.digest ?? VIRTUAL_CONTENT_SHA256;
  const cached = readCached(entry, digest);
  if (cached !== null) return cached;

  let downloaded: Buffer;
  try {
    downloaded = await (options.download ?? downloadTarball)(VIRTUAL_URL);
  } catch (error) {
    throw unavailable(
      `it could not be downloaded (${error instanceof Error ? error.message : String(error)}). The first run that uses virtual devices needs network access.`,
    );
  }
  let files: VirtualFile[];
  try {
    files = await extractIntegration(downloaded);
  } catch (error) {
    throw unavailable(
      `the archive could not be read (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (contentDigest(files) !== digest) {
    throw unavailable("the download failed its integrity check.");
  }
  writeCache(entry, files);
  return files;
}
