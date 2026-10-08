import { describe, expect, it } from "vitest";
import { Parser } from "tar";
import { packConfig } from "../src/config/pack.js";

async function entriesOf(archive: Buffer): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const parser = new Parser();
  parser.on("entry", (entry) => {
    const chunks: Buffer[] = [];
    entry.on("data", (chunk: Buffer) => chunks.push(chunk));
    entry.on("end", () =>
      out.set(entry.path, Buffer.concat(chunks).toString("utf8")),
    );
  });
  await new Promise<void>((resolve, reject) => {
    parser.on("end", resolve);
    parser.on("error", reject);
    parser.end(archive);
  });
  return out;
}

describe("packConfig", () => {
  it("builds the baseline configuration and the companion in memory", async () => {
    const packed = await packConfig();
    expect(packed.summary).toBeNull();
    const entries = await entriesOf(packed.archive);
    expect(entries.get("config/configuration.yaml")).toContain(
      "default_config:",
    );
    expect(entries.get("config/configuration.yaml")).toContain(
      "domusops_sandbox:",
    );
    expect(
      entries.get("config/custom_components/domusops_sandbox/manifest.json"),
    ).toContain('"domain": "domusops_sandbox"');
    expect(
      entries.has("config/custom_components/domusops_sandbox/__init__.py"),
    ).toBe(true);
  });
});
