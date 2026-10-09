import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  lstatSync,
  readlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_CONFIG_BYTES, packConfig } from "../src/config/pack.js";
import { SandboxError } from "../src/errors.js";
import { readArchive } from "./support/archive.js";

const directories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "domusops-pack-"));
  directories.push(directory);
  return directory;
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/** A hash over names, kinds, modes, link targets and bytes: any change to the tree changes it. */
function fingerprint(root: string): string {
  const hash = createHash("sha256");
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const entry = lstatSync(full);
      hash.update(`${prefix}${name}|${String(entry.mode)}|`);
      if (entry.isSymbolicLink()) hash.update(readlinkSync(full));
      else if (entry.isDirectory()) walk(full, `${prefix}${name}/`);
      else hash.update(readFileSync(full));
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("packing a configuration directory", () => {
  it("carries the configuration and appends the companion line", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "packages/lights.yaml", "light: []\n");
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    expect(entries.get("config/configuration.yaml")?.content).toBe(
      "default_config:\n\ndomusops_sandbox:\n",
    );
    expect(entries.get("config/packages/lights.yaml")?.content).toBe(
      "light: []\n",
    );
    expect(
      entries.has("config/custom_components/domusops_sandbox/__init__.py"),
    ).toBe(true);
    expect(summary?.files).toBe(2);
  });

  it("adds the separator when the file does not end with a newline", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:");
    const entries = await readArchive((await packConfig({ dir: root })).archive);
    expect(entries.get("config/configuration.yaml")?.content).toBe(
      "default_config:\n\ndomusops_sandbox:\n",
    );
  });

  it("leaves out runtime files, private files and key files", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    for (const path of [
      ".storage/auth",
      ".cloud/token",
      "deps/lib/x.py",
      "tts/a.mp3",
      "backups/b.tar",
      "__pycache__/x.pyc",
      "packages/__pycache__/y.pyc",
      ".git/HEAD",
      "home-assistant_v2.db",
      "home-assistant_v2.db-wal",
      "home-assistant.log",
      "home-assistant.log.1",
      ".HA_VERSION",
      "secrets.yaml",
      "secrets.sops.yaml",
      "packages/secrets.yaml",
      "keys.txt",
      "age.key",
      "backup.agekey",
    ]) {
      write(root, path, "x");
    }
    const { archive, summary } = await packConfig({ dir: root });
    const paths = [...(await readArchive(archive)).keys()].filter((path) =>
      path.startsWith("config/"),
    );
    for (const path of paths) {
      expect(path).not.toMatch(
        /\.storage|\.cloud|deps|tts|backups|pycache|\.git|\.db|\.log|HA_VERSION|secrets|keys\.txt|age\.key|agekey/,
      );
    }
    expect(summary?.files).toBe(1);
    expect(summary?.excluded).toEqual(
      expect.arrayContaining([
        ".storage/",
        ".cloud/",
        "deps/",
        "tts/",
        "backups/",
        "__pycache__/",
        ".git/",
        "home-assistant_v2.db*",
        "*.log*",
        ".HA_VERSION",
        "secrets.yaml",
        "secrets.sops.yaml",
        "age key files",
      ]),
    );
  });

  it("keeps files whose names only look like excluded ones", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "packages/catalog.yaml", "a: 1\n");
    write(root, "custom_components/media/tts/__init__.py", "");
    write(root, "www/blog.log_helper.png", "x");
    const entries = await readArchive((await packConfig({ dir: root })).archive);
    expect(entries.has("config/packages/catalog.yaml")).toBe(true);
    expect(entries.has("config/custom_components/media/tts/__init__.py")).toBe(
      true,
    );
  });

  it("keeps links that stay inside and reports the ones that leave", async () => {
    const outside = scratch();
    write(outside, "elsewhere.yaml", "secret: true\n");
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "packages/real.yaml", "a: 1\n");
    symlinkSync("real.yaml", join(root, "packages/alias.yaml"));
    symlinkSync(join(root, "packages/real.yaml"), join(root, "absolute.yaml"));
    symlinkSync(join(outside, "elsewhere.yaml"), join(root, "leaves.yaml"));
    symlinkSync("../../../etc/passwd", join(root, "relative-leaves.yaml"));
    symlinkSync("missing.yaml", join(root, "dangling.yaml"));
    symlinkSync(outside, join(root, "directory-leaves"));
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    expect(entries.get("config/packages/alias.yaml")).toMatchObject({
      type: "SymbolicLink",
      linkpath: "real.yaml",
    });
    expect(entries.get("config/absolute.yaml")).toMatchObject({
      type: "SymbolicLink",
      linkpath: "packages/real.yaml",
    });
    for (const skipped of [
      "leaves.yaml",
      "relative-leaves.yaml",
      "dangling.yaml",
      "directory-leaves",
    ]) {
      expect(entries.has(`config/${skipped}`)).toBe(false);
    }
    expect(summary?.skippedLinks).toEqual([
      "dangling.yaml",
      "directory-leaves",
      "leaves.yaml",
      "relative-leaves.yaml",
    ]);
    for (const entry of entries.values()) {
      expect(entry.content).not.toContain("secret: true");
    }
  });

  it("follows a source directory that is itself a link", async () => {
    const real = scratch();
    write(real, "configuration.yaml", "default_config:\n");
    const holder = scratch();
    const link = join(holder, "config-link");
    symlinkSync(real, link);
    const { summary } = await packConfig({ dir: link });
    expect(summary?.files).toBe(1);
  });

  it("is byte-identical after packing it 20 times, and writes nothing", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "homeassistant:\n  name: x\n");
    write(root, "packages/a.yaml", "a: !secret key_a\n");
    write(root, "scripts/run.sh", "#!/bin/sh\n");
    chmodSync(join(root, "scripts/run.sh"), 0o755);
    symlinkSync("a.yaml", join(root, "packages/b.yaml"));
    const before = fingerprint(root);
    const mtime = statSync(join(root, "configuration.yaml")).mtimeMs;
    const archives: Buffer[] = [];
    for (let i = 0; i < 20; i += 1) {
      archives.push((await packConfig({ dir: root })).archive);
    }
    expect(fingerprint(root)).toBe(before);
    expect(statSync(join(root, "configuration.yaml")).mtimeMs).toBe(mtime);
    expect(readdirSync(root).sort()).toEqual([
      "configuration.yaml",
      "packages",
      "scripts",
    ]);
    for (const archive of archives) expect(archive.equals(archives[0]!)).toBe(true);
  });

  it("keeps the executable bit and nothing else of the mode", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "scripts/run.sh", "#!/bin/sh\n");
    chmodSync(join(root, "scripts/run.sh"), 0o750);
    const entries = await readArchive((await packConfig({ dir: root })).archive);
    expect(entries.get("config/scripts/run.sh")?.type).toBe("File");
  });

  it("appends the generated secrets and reports them", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "api_key: !secret api_key\n");
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    expect(entries.get("config/secrets.yaml")?.content).toBe(
      "api_key: domusops-placeholder-api_key\n",
    );
    expect(summary).toMatchObject({
      secrets: "placeholders",
      placeholderKeys: ["api_key"],
    });
  });

  it("puts no secrets file in the instance when nothing references one", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "secrets.yaml", "real: value\n");
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    expect(entries.has("config/secrets.yaml")).toBe(false);
    expect(summary?.secrets).toBe("none-referenced");
  });

  it("notices a user's own virtual integration", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "custom_components/virtual/__init__.py", "");
    expect((await packConfig({ dir: root })).summary?.userVirtualIntegration).toBe(
      true,
    );
  });

  it("loads a configuration.yaml that is a link inside the directory", async () => {
    const root = scratch();
    write(root, "main/real.yaml", "default_config:\n");
    symlinkSync("main/real.yaml", join(root, "configuration.yaml"));
    const { archive } = await packConfig({ dir: root });
    const entry = (await readArchive(archive)).get("config/configuration.yaml");
    expect(entry?.type).toBe("File");
    expect(entry?.content).toContain("default_config:");
    expect(entry?.content).toContain("domusops_sandbox:");
  });

  it("does not add the companion line twice", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n\ndomusops_sandbox:\n");
    const { archive } = await packConfig({ dir: root });
    const content = (await readArchive(archive)).get("config/configuration.yaml")
      ?.content;
    expect(content?.match(/domusops_sandbox:/g)).toHaveLength(1);
  });

  it("leaves out media, tool caches and rotated logs", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "media/clip.mp4", "x");
    write(root, ".cache/a", "x");
    write(root, ".mypy_cache/a", "x");
    write(root, "home-assistant.log.1", "x");
    write(root, "home-assistant.log.old", "x");
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    for (const name of [
      "media/clip.mp4",
      ".cache/a",
      ".mypy_cache/a",
      "home-assistant.log.1",
      "home-assistant.log.old",
    ]) {
      expect(entries.has(`config/${name}`)).toBe(false);
    }
    expect(summary?.excluded).toEqual(
      expect.arrayContaining(["media/", ".cache/", ".mypy_cache/", "*.log*"]),
    );
  });

  it("skips a link whose target is not carried over, and a link that is itself excluded", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "secrets.yaml", "key: real-value-123\n");
    write(root, ".storage/auth", "{}");
    symlinkSync("secrets.yaml", join(root, "alias-secrets.yaml"));
    symlinkSync(".storage", join(root, "alias-storage"));
    symlinkSync("secrets.yaml", join(root, "media"));
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    expect(entries.has("config/alias-secrets.yaml")).toBe(false);
    expect(entries.has("config/alias-storage")).toBe(false);
    expect(entries.has("config/media")).toBe(false);
    expect(summary?.skippedLinks).toEqual(["alias-secrets.yaml", "alias-storage"]);
    expect(summary?.excluded).toContain("media/");
  });

  it("reports the values of a caller secrets file for redaction", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "api: !secret api_key\n");
    const holder = scratch();
    write(holder, "own.yaml", 'api_key: "test-value-9"\nother: plain-value # c\n');
    const file = join(holder, "own.yaml");
    const result = await packConfig({ dir: root, secretsFile: file });
    expect(result.secretValues).toEqual(["test-value-9", "plain-value"]);
  });

  it("does not let the source replace the companion", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    write(root, "custom_components/domusops_sandbox/__init__.py", "evil = 1\n");
    const { archive, summary } = await packConfig({ dir: root });
    const entries = await readArchive(archive);
    expect(
      entries.get("config/custom_components/domusops_sandbox/__init__.py")
        ?.content,
    ).not.toContain("evil");
    expect(summary?.excluded).toContain("custom_components/domusops_sandbox/");
  });
});

describe("a directory that cannot be used", () => {
  async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof SandboxError) return error.code;
      throw error;
    }
    throw new Error("expected packing to fail");
  }

  it("is rejected when it does not exist", async () => {
    expect(await codeOf(packConfig({ dir: join(scratch(), "nope") }))).toBe(
      "config_dir_invalid",
    );
  });

  it("is rejected when it is a file", async () => {
    const root = scratch();
    write(root, "file", "x");
    expect(await codeOf(packConfig({ dir: join(root, "file") }))).toBe(
      "config_dir_invalid",
    );
  });

  it("is rejected without a configuration.yaml", async () => {
    const root = scratch();
    write(root, "packages/a.yaml", "a: 1\n");
    expect(await codeOf(packConfig({ dir: root }))).toBe("config_dir_invalid");
  });

  it("is rejected when configuration.yaml is a link that leaves the directory", async () => {
    const outside = scratch();
    write(outside, "real.yaml", "default_config:\n");
    const root = scratch();
    symlinkSync(join(outside, "real.yaml"), join(root, "configuration.yaml"));
    expect(await codeOf(packConfig({ dir: root }))).toBe("config_dir_invalid");
  });

  it("is rejected when it holds more than the size limit", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    // A sparse file: it reports the size without taking the space.
    truncateSync(
      (writeFileSync(join(root, "big.bin"), ""), join(root, "big.bin")),
      MAX_CONFIG_BYTES + 1,
    );
    expect(await codeOf(packConfig({ dir: root }))).toBe("config_dir_invalid");
  });

  it("is rejected when the named secrets file is missing", async () => {
    const root = scratch();
    write(root, "configuration.yaml", "default_config:\n");
    expect(
      await codeOf(
        packConfig({ dir: root, secretsFile: join(root, "missing.yaml") }),
      ),
    ).toBe("config_dir_invalid");
  });
});
