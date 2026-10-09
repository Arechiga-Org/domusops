import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packConfig } from "../src/config/pack.js";
import {
  VIRTUAL_SHA256,
  VIRTUAL_VERSION,
  ensureVirtualIntegration,
  extractIntegration,
} from "../src/devices/fetch.js";
import {
  DEVICE_FILE,
  DEVICE_KINDS,
  MAX_DEVICE_NAME,
  renderDeviceFile,
  validateDevices,
} from "../src/devices/spec.js";
import { SandboxError } from "../src/errors.js";
import { readArchive } from "./support/archive.js";

const directories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "domusops-virtual-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("validating devices", () => {
  it.each(DEVICE_KINDS)("accepts the kind %s", (kind) => {
    expect(validateDevices([{ kind, name: "One" }])).toEqual([
      { kind, name: "One" },
    ]);
  });

  it("passes class and initial through and trims names", () => {
    expect(
      validateDevices([
        {
          kind: "binary_sensor",
          name: "  Door ",
          class: "door",
          initial: "on",
        },
      ]),
    ).toEqual([
      { kind: "binary_sensor", name: "Door", class: "door", initial: "on" },
    ]);
  });

  it("names a kind the integration does not offer", () => {
    try {
      validateDevices([{ kind: "toaster", name: "x" } as never]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxError);
      expect((error as SandboxError).code).toBe("unsupported_device_kind");
      expect((error as Error).message).toContain("toaster");
    }
  });

  it.each([
    ["an empty name", [{ kind: "light", name: " " }]],
    [
      "a name that is too long",
      [{ kind: "light", name: "x".repeat(MAX_DEVICE_NAME + 1) }],
    ],
    ["a name starting with +", [{ kind: "light", name: "+Hall" }]],
    ["a name starting with !", [{ kind: "light", name: "!Hall" }]],
    ["a name with a newline", [{ kind: "light", name: "Hall\nLamp" }]],
    ["a name with a tab", [{ kind: "light", name: "Hall\tLamp" }]],
    ["a name with a NUL", [{ kind: "light", name: "Hall\u0000" }]],
    [
      "a duplicate across kinds, ignoring case",
      [
        { kind: "light", name: "Hall" },
        { kind: "binary_sensor", name: "hall" },
      ],
    ],
    ["an empty class", [{ kind: "light", name: "A", class: "" }]],
    ["not an array", "light"],
    ["a non-object entry", [null]],
  ])("rejects %s with a TypeError", (_label, input) => {
    expect(() => validateDevices(input as never)).toThrow(TypeError);
  });

  it.each([
    ["Hall Light", "hall-light"],
    ["Hall", "HALL"],
    ["Café", "Cafe"],
  ])("rejects %j and %j, which make the same entity id", (first, second) => {
    expect(() =>
      validateDevices([
        { kind: "light", name: first },
        { kind: "switch", name: second },
      ]),
    ).toThrow(TypeError);
  });

  it("compares a new name with the slugs of the names already taken", () => {
    expect(() =>
      validateDevices([{ kind: "switch", name: "hall_light" }], ["Hall Light"]),
    ).toThrow(TypeError);
  });

  it("keeps names with no letters or digits apart by their own text", () => {
    expect(
      validateDevices([
        { kind: "light", name: "★" },
        { kind: "light", name: "☆" },
      ]),
    ).toHaveLength(2);
  });

  it("counts names already in the instance as taken", () => {
    expect(() =>
      validateDevices([{ kind: "switch", name: "Porch" }], ["porch"]),
    ).toThrow(TypeError);
  });
});

describe("the device file", () => {
  it("is empty but valid without devices", () => {
    expect(renderDeviceFile([])).toBe("version: 1\ndevices: {}\n");
  });

  it("holds one device per specification, with quoted strings", () => {
    expect(
      renderDeviceFile([
        {
          kind: "binary_sensor",
          name: 'Door "front"',
          class: "door",
          initial: "on",
        },
        { kind: "light", name: "Hall" },
      ]),
    ).toBe(
      [
        "version: 1",
        "devices:",
        '  "Door \\"front\\"":',
        "    - platform: binary_sensor",
        '      name: "Door \\"front\\""',
        '      class: "door"',
        '      initial_value: "on"',
        '  "Hall":',
        "    - platform: light",
        '      name: "Hall"',
        "",
      ].join("\n"),
    );
  });
});

const INTEGRATION = [
  { path: "manifest.json", data: Buffer.from('{"domain":"virtual"}') },
  { path: "translations/en.json", data: Buffer.from("{}") },
];
const DEVICE_TEXT = renderDeviceFile([{ kind: "light", name: "Hall" }]);

describe("packing with virtual devices", () => {
  it("adds the integration and the device file when devices are requested", async () => {
    const { archive } = await packConfig(undefined, {
      integration: INTEGRATION,
      deviceFile: DEVICE_TEXT,
    });
    const entries = await readArchive(archive);
    expect(
      entries.get("config/custom_components/virtual/manifest.json")?.content,
    ).toBe('{"domain":"virtual"}');
    expect(
      entries.has("config/custom_components/virtual/translations/en.json"),
    ).toBe(true);
    expect(entries.get(`config/${DEVICE_FILE}`)?.content).toBe(DEVICE_TEXT);
  });

  it("adds neither without devices", async () => {
    const { archive } = await packConfig();
    const entries = await readArchive(archive);
    expect(entries.has(`config/${DEVICE_FILE}`)).toBe(false);
    expect(
      [...entries.keys()].some((path) =>
        path.includes("custom_components/virtual"),
      ),
    ).toBe(false);
  });

  it("keeps the caller's own virtual integration and still writes the device file", async () => {
    const dir = scratch();
    writeFileSync(
      join(dir, "configuration.yaml"),
      "homeassistant:\n  name: Test\n",
    );
    const own = join(dir, "custom_components", "virtual");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(own, { recursive: true });
    writeFileSync(
      join(own, "manifest.json"),
      '{"domain":"virtual","own":true}',
    );
    const { archive, summary } = await packConfig(
      { dir },
      { integration: INTEGRATION, deviceFile: DEVICE_TEXT },
    );
    expect(summary?.userVirtualIntegration).toBe(true);
    const entries = await readArchive(archive);
    expect(
      entries.get("config/custom_components/virtual/manifest.json")?.content,
    ).toContain('"own":true');
    expect(
      entries.has("config/custom_components/virtual/translations/en.json"),
    ).toBe(false);
    expect(entries.get(`config/${DEVICE_FILE}`)?.content).toBe(DEVICE_TEXT);
  });
});

describe("a symlinked virtual integration", () => {
  it("is the user's own and ours is not added", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "configuration.yaml"), "default_config:\n");
    mkdirSync(join(dir, "vendor", "virtual"), { recursive: true });
    writeFileSync(
      join(dir, "vendor", "virtual", "manifest.json"),
      '{"domain":"virtual","own":true}',
    );
    mkdirSync(join(dir, "custom_components"), { recursive: true });
    symlinkSync(
      join("..", "vendor", "virtual"),
      join(dir, "custom_components", "virtual"),
    );
    const { archive, summary } = await packConfig(
      { dir },
      { integration: INTEGRATION, deviceFile: DEVICE_TEXT },
    );
    expect(summary?.userVirtualIntegration).toBe(true);
    const entries = await readArchive(archive);
    expect(
      entries.has("config/custom_components/virtual/translations/en.json"),
    ).toBe(false);
  });
});

/** A GitHub-style release tarball holding the files under `custom_components/virtual/`. */
async function releaseTarball(): Promise<Buffer> {
  const root = scratch();
  const base = join(root, "hass-virtual-9.9.9", "custom_components", "virtual");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(base, "translations"), { recursive: true });
  writeFileSync(join(base, "manifest.json"), '{"domain":"virtual"}');
  writeFileSync(join(base, "translations", "en.json"), "{}");
  mkdirSync(join(root, "hass-virtual-9.9.9", "docs"), { recursive: true });
  writeFileSync(join(root, "hass-virtual-9.9.9", "docs", "readme.md"), "x");
  const chunks: Buffer[] = [];
  const stream = create({ gzip: true, cwd: root }, ["hass-virtual-9.9.9"]);
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("fetching the integration", () => {
  it("extracts only the integration files", async () => {
    const files = await extractIntegration(await releaseTarball());
    expect(files.map((file) => file.path)).toEqual([
      "manifest.json",
      "translations/en.json",
    ]);
  });

  it("refuses a download that does not match the pinned checksum, and caches nothing", async () => {
    const cacheDir = scratch();
    const tarball = await releaseTarball();
    expect(createHash("sha256").update(tarball).digest("hex")).not.toBe(
      VIRTUAL_SHA256,
    );
    await expect(
      ensureVirtualIntegration({ cacheDir, download: async () => tarball }),
    ).rejects.toMatchObject({ code: "virtual_unavailable" });
    expect(
      existsSync(join(cacheDir, `hass-virtual-${VIRTUAL_VERSION}.tar.gz`)),
    ).toBe(false);
  });

  it("reports a failed download as virtual_unavailable", async () => {
    await expect(
      ensureVirtualIntegration({
        cacheDir: scratch(),
        download: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toMatchObject({ code: "virtual_unavailable" });
  });

  it("refuses a download that declares or streams more than the size cap", async () => {
    const big = Buffer.alloc(9 * 1024 * 1024);
    const declared = new Response(big, {
      headers: { "content-length": String(big.length) },
    });
    const streamed = new Response(big);
    streamed.headers.delete("content-length");
    for (const response of [declared, streamed]) {
      vi.stubGlobal("fetch", async () => response);
      try {
        await expect(
          ensureVirtualIntegration({ cacheDir: scratch() }),
        ).rejects.toMatchObject({
          code: "virtual_unavailable",
          message: expect.stringContaining("larger than expected"),
        });
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it("ignores a cached tarball that no longer matches the pin", async () => {
    const cacheDir = scratch();
    writeFileSync(
      join(cacheDir, `hass-virtual-${VIRTUAL_VERSION}.tar.gz`),
      "corrupt",
    );
    await expect(
      ensureVirtualIntegration({
        cacheDir,
        download: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toMatchObject({ code: "virtual_unavailable" });
  });
});
