import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { SandboxError } from "../src/errors.js";
import { startSandbox } from "../src/index.js";
import { createRuntime } from "../src/runtime/docker.js";
import { startTarget } from "./support/channels.js";

const runtime = createRuntime();
const MINUTE = 60_000;
const REFERENCE = fileURLToPath(
  new URL("../fixtures/reference-config", import.meta.url),
);

const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "domusops-config-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function checksum(root: string): string {
  const hash = createHash("sha256");
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      hash.update(`${prefix}${name}|${String(lstatSync(full).mode)}|`);
      if (lstatSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else hash.update(readFileSync(full));
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

async function get<T>(
  url: string,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

describe("loading a configuration directory", () => {
  it(
    "loads the reference configuration and leaves the source untouched",
    async () => {
      const before = checksum(REFERENCE);
      const sandbox = await startSandbox({
        ...startTarget("stable"),
        config: { dir: REFERENCE },
      });
      try {
        const { url, token } = sandbox.connection();
        expect(sandbox.config).toMatchObject({
          secrets: "none-referenced",
          userVirtualIntegration: false,
        });
        expect(sandbox.config?.files).toBe(2);
        const config = await get<{ location_name: string }>(
          url,
          token,
          "/api/config",
        );
        expect(config.location_name).toBe("DomusOps Reference");
        const states = await get<
          { entity_id: string; attributes: { id?: string } }[]
        >(url, token, "/api/states");
        expect(
          states.some(
            (state) =>
              state.entity_id.startsWith("automation.") &&
              state.attributes.id === "domusops_reference_hall_light_at_three",
          ),
        ).toBe(true);
      } finally {
        await sandbox.stop();
      }
      expect(checksum(REFERENCE)).toBe(before);
    },
    8 * MINUTE,
  );

  it(
    "boots with placeholders for a secret that has no file",
    async () => {
      const root = project({
        "configuration.yaml":
          "default_config:\nhomeassistant:\n  name: !secret site_name\n",
        "secrets.yaml": "site_name: REAL-NAME-DO-NOT-LEAK\n",
      });
      const sandbox = await startSandbox({
        ...startTarget("stable"),
        config: { dir: root },
      });
      try {
        const { url, token } = sandbox.connection();
        expect(sandbox.config).toMatchObject({
          secrets: "placeholders",
          placeholderKeys: ["site_name"],
        });
        const config = await get<{ location_name: string }>(
          url,
          token,
          "/api/config",
        );
        expect(config.location_name).toBe("domusops-placeholder-site_name");
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );

  it(
    "uses the plaintext secrets file the caller names",
    async () => {
      const root = project({
        "configuration.yaml":
          "default_config:\nhomeassistant:\n  name: !secret site_name\n",
      });
      const own = join(
        project({ "own.yaml": "site_name: Named By The Caller\n" }),
        "own.yaml",
      );
      const sandbox = await startSandbox({
        ...startTarget("stable"),
        config: { dir: root, secretsFile: own },
      });
      try {
        const { url, token } = sandbox.connection();
        expect(sandbox.config?.secrets).toBe("caller-file");
        const config = await get<{ location_name: string }>(
          url,
          token,
          "/api/config",
        );
        expect(config.location_name).toBe("Named By The Caller");
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );
});

describe("a configuration that does not pass", () => {
  it.each([
    ["a YAML syntax error", "default_config:\n  bad: [unclosed\n"],
    [
      "a core setting that breaks its schema",
      "default_config:\nhomeassistant:\n  unit_system: domusops_no_such_system\n",
    ],
  ])(
    "ends with config_invalid and no container left, for %s",
    async (_name, configuration) => {
      const root = project({ "configuration.yaml": configuration });
      const before = await runtime.list();
      let caught: unknown;
      try {
        const started = await startSandbox({
          ...startTarget("stable"),
          config: { dir: root },
        });
        await started.stop();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SandboxError);
      expect((caught as SandboxError).code).toBe("config_invalid");
      expect((caught as SandboxError).message.length).toBeGreaterThan(40);
      expect(await runtime.list()).toHaveLength(before.length);
    },
    8 * MINUTE,
  );

  it("is refused before any container exists when the directory is unusable", async () => {
    const before = await runtime.list();
    await expect(
      startSandbox({
        ...startTarget("stable"),
        config: { dir: join(tmpdir(), "domusops-does-not-exist") },
      }),
    ).rejects.toMatchObject({ code: "config_dir_invalid" });
    expect(await runtime.list()).toHaveLength(before.length);
  });
});
