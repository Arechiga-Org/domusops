import { describe, expect, it } from "vitest";
import {
  findChildKey,
  findTopKey,
  indentAt,
  isBlockMap,
  parse,
  sliceOf,
  tagOf,
} from "../src/yaml/ha-yaml.js";

describe("parse", () => {
  it("resolves every instance tag as an opaque scalar", () => {
    const text = [
      "automation: !include_dir_merge_list automations",
      "script: !include_dir_named scripts",
      "group: !include groups.yaml",
      "template: !include_dir_merge_named templates",
      "input: !input some_input",
      "env: !env_var SOME_ENV default",
      "api_key: !secret my_api_key",
      "",
    ].join("\n");
    const { doc, errors } = parse(text);
    expect(errors).toEqual([]);
    const automation = findTopKey(doc, "automation");
    expect(tagOf(automation?.valueNode)).toBe("!include_dir_merge_list");
    const apiKey = findTopKey(doc, "api_key");
    expect(tagOf(apiKey?.valueNode)).toBe("!secret");
    expect((apiKey?.valueNode as { value: unknown })?.value).toBe("my_api_key");
  });

  it("reports a syntax error with line and column", () => {
    const bad = "a:\n  b: 1\n foo: [1,2\n";
    const { errors } = parse(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.line).toBeGreaterThan(0);
    expect(errors[0]?.column).toBeGreaterThan(0);
    expect(errors[0]?.message.length).toBeGreaterThan(0);
  });

  it("reports a duplicate key with line and column", () => {
    const text = "dup: 1\ndup: 2\n";
    const { errors } = parse(text);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/unique/i);
    expect(errors[0]?.line).toBe(2);
  });
});

describe("findChildKey / findTopKey / isBlockMap (research R5)", () => {
  it("reports no homeassistant key", () => {
    const { doc } = parse("frontend:\n");
    expect(findTopKey(doc, "homeassistant")).toBeNull();
  });

  it("reports a block mapping without packages", () => {
    const { doc } = parse("homeassistant:\n  name: Home\n");
    const found = findTopKey(doc, "homeassistant");
    expect(found).not.toBeNull();
    expect(isBlockMap(found?.valueNode)).toBe(true);
    expect(findChildKey(found?.valueNode, "packages")).toBeNull();
  });

  it("reports an existing packages key in any form", () => {
    const { doc } = parse(
      "homeassistant:\n  name: Home\n  packages: !include_dir_merge_named packages\n",
    );
    const found = findTopKey(doc, "homeassistant");
    const packages = findChildKey(found?.valueNode, "packages");
    expect(packages).not.toBeNull();
    expect(tagOf(packages?.valueNode)).toBe("!include_dir_merge_named");
  });

  it("reports a flow mapping as not a block map", () => {
    const { doc } = parse("homeassistant: { name: Home }\n");
    const found = findTopKey(doc, "homeassistant");
    expect(isBlockMap(found?.valueNode)).toBe(false);
  });

  it("reports an !include tag as not a block map", () => {
    const { doc } = parse("homeassistant: !include homeassistant.yaml\n");
    const found = findTopKey(doc, "homeassistant");
    expect(isBlockMap(found?.valueNode)).toBe(false);
    expect(tagOf(found?.valueNode)).toBe("!include");
  });
});

describe("sliceOf / indentAt", () => {
  it("slices the raw source text of a node's range", () => {
    const text = "homeassistant:\n  name: Home\n";
    const { doc } = parse(text);
    const found = findTopKey(doc, "homeassistant");
    const name = findChildKey(found?.valueNode, "name");
    expect(
      sliceOf(text, name?.valueNode as { range?: readonly number[] }),
    ).toBe("Home");
  });

  it("finds the indentation of the line a node starts on", () => {
    const text = "homeassistant:\n  name: Home\n";
    const { doc } = parse(text);
    const found = findTopKey(doc, "homeassistant");
    const name = findChildKey(found?.valueNode, "name");
    const offset =
      (name?.keyNode as { range?: readonly number[] })?.range?.[0] ?? 0;
    expect(indentAt(text, offset)).toBe("  ");
  });
});
