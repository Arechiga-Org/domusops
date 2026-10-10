import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_VERSIONS_FORMAT,
  TABLE_END,
  TABLE_START,
  renderSupportedVersions,
  replaceTableBlock,
  type SupportedVersions,
} from "../src/results/table.js";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("the README table (constitution section 8)", () => {
  const readme = read("../../../README.md");
  const document = JSON.parse(
    read("../../../docs/supported-versions.json"),
  ) as SupportedVersions;

  it("is generated from docs/supported-versions.json, not written by hand", () => {
    expect(document.format).toBe(SUPPORTED_VERSIONS_FORMAT);
    expect(replaceTableBlock(readme, renderSupportedVersions(document))).toBe(
      readme,
    );
  });

  it("has exactly one block between the markers", () => {
    expect(readme.split(TABLE_START)).toHaveLength(2);
    expect(readme.split(TABLE_END)).toHaveLength(2);
  });

  it("links every checked row to the CI run behind it", () => {
    for (const row of document.rows) {
      expect(row.ciRunUrl).toMatch(/^https:\/\/\S+\/actions\/runs\/\d+$/);
    }
  });
});
