import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packConfig } from "../src/config/pack.js";
import {
  buildSecrets,
  placeholderValue,
  referencedSecrets,
  secretValues,
  sopsTypes,
} from "../src/config/secrets.js";
import { readArchive } from "./support/archive.js";

const SOPS = `wifi_password: ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:str]
mqtt_port: ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:int]
gain: ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:float]
use_tls: 'ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:bool]'
sops:
    version: 3.9.0
    age:
        - recipient: age1abc
`;

describe("secret references", () => {
  it("are collected once each, in order", () => {
    expect(
      referencedSecrets(
        [
          "a: !secret first",
          "b: !secret 'second'",
          "c: !secret first",
          'd: !secret "third" # !secret commented',
          "# !secret ignored",
          "e: not a secret",
        ].join("\n"),
      ),
    ).toEqual(["first", "second", "third"]);
  });
});

describe("SOPS markers", () => {
  it("give the type of each key without decrypting anything", () => {
    expect([...sopsTypes(SOPS)]).toEqual([
      ["wifi_password", "str"],
      ["mqtt_port", "int"],
      ["gain", "float"],
      ["use_tls", "bool"],
    ]);
  });
});

describe("placeholders", () => {
  it("are typed placeholders, or zeros and false for numeric and boolean secrets", () => {
    expect(placeholderValue("wifi", "str")).toBe("domusops-placeholder-wifi");
    expect(placeholderValue("wifi", undefined)).toBe("domusops-placeholder-wifi");
    expect(placeholderValue("port", "int")).toBe("0");
    expect(placeholderValue("gain", "float")).toBe("0.0");
    expect(placeholderValue("tls", "bool")).toBe("false");
  });

  it("are generated for every referenced key, typed from the markers", () => {
    const secrets = buildSecrets({
      referenced: ["wifi_password", "mqtt_port", "use_tls", "unknown_key"],
      sopsText: SOPS,
    });
    expect(secrets.kind).toBe("placeholders");
    expect(secrets.content).toBe(
      [
        "wifi_password: domusops-placeholder-wifi_password",
        "mqtt_port: 0",
        "use_tls: false",
        "unknown_key: domusops-placeholder-unknown_key",
        "",
      ].join("\n"),
    );
    expect(secrets.placeholderKeys).toHaveLength(4);
  });

  it("quote a key that is not a plain word", () => {
    expect(
      buildSecrets({ referenced: ["odd.key"] }).content,
    ).toBe('"odd.key": domusops-placeholder-odd.key\n');
  });

  it("are not generated when nothing is referenced", () => {
    expect(buildSecrets({ referenced: [], sopsText: SOPS })).toEqual({
      kind: "none-referenced",
      content: null,
      placeholderKeys: [],
    });
  });
});

describe("a secrets file the caller names", () => {
  it("wins over placeholders and is used as is", () => {
    const secrets = buildSecrets({
      referenced: ["a"],
      sopsText: SOPS,
      callerFile: "a: hunter2\n",
    });
    expect(secrets).toEqual({
      kind: "caller-file",
      content: "a: hunter2\n",
      placeholderKeys: [],
    });
  });
});

describe("secrets in a packed directory", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "domusops-secrets-"));
    directories.push(root);
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }

  it("never carry a value from the real secrets.yaml", async () => {
    const root = project({
      "configuration.yaml": "api: !secret api_key\nport: !secret mqtt_port\n",
      "secrets.yaml": "api_key: REAL-VALUE-12345\nmqtt_port: 1883\n",
      "secrets.sops.yaml": SOPS,
    });
    const { archive, summary } = await packConfig({ dir: root });
    for (const entry of (await readArchive(archive)).values()) {
      expect(entry.content).not.toContain("REAL-VALUE-12345");
      expect(entry.content).not.toContain("1883");
    }
    expect(summary?.secrets).toBe("placeholders");
  });

  it("take their types from secrets.sops.yaml", async () => {
    const root = project({
      "configuration.yaml": "port: !secret mqtt_port\n",
      "secrets.sops.yaml": SOPS,
    });
    const entries = await readArchive((await packConfig({ dir: root })).archive);
    expect(entries.get("config/secrets.yaml")?.content).toBe("mqtt_port: 0\n");
  });

  it("find references in every YAML file", async () => {
    const root = project({
      "configuration.yaml": "homeassistant:\n  packages: !include_dir_named packages\n",
      "packages/a.yaml": "x: !secret from_package\n",
      "packages/b.yml": "y: !secret from_yml\n",
      "notes.txt": "!secret not_yaml\n",
    });
    const { summary } = await packConfig({ dir: root });
    expect(summary?.placeholderKeys).toEqual(["from_package", "from_yml"]);
  });

  it("use the file the caller names, whatever the directory holds", async () => {
    const root = project({
      "configuration.yaml": "api: !secret api_key\n",
      "secrets.yaml": "api_key: REAL-VALUE-12345\n",
    });
    const file = join(project({ "own.yaml": "api_key: test-value-9\n" }), "own.yaml");
    const { archive, summary } = await packConfig({
      dir: root,
      secretsFile: file,
    });
    const entries = await readArchive(archive);
    expect(entries.get("config/secrets.yaml")?.content).toBe(
      "api_key: test-value-9\n",
    );
    expect(summary).toMatchObject({ secrets: "caller-file", placeholderKeys: [] });
    for (const entry of entries.values()) {
      expect(entry.content).not.toContain("REAL-VALUE-12345");
    }
  });
});

describe("secretValues", () => {
  it("reads top-level values without quotes or comments", () => {
    expect(
      secretValues(
        "# header\nkey: abc\nquoted: 'x y'\ndq: \"z\"\nempty:\n  nested: skip\nkey2: abc # note\n",
      ),
    ).toEqual(["abc", "x y", "z"]);
  });
});
