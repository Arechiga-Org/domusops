import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "./support/tmp.js";
import { isEntryPoint } from "../src/cli-support.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("isEntryPoint", () => {
  function module(): { dir: string; file: string; url: string } {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    mkdirSync(join(dir, "dist"));
    const file = join(dir, "dist", "cli.js");
    writeFileSync(file, "");
    return { dir, file, url: pathToFileURL(file).href };
  }

  it("is true when the process entry is the module itself", () => {
    const { file, url } = module();
    expect(isEntryPoint(file, url)).toBe(true);
  });

  it("is true when the entry is a bin symlink to the module", () => {
    const { dir, file, url } = module();
    const link = join(dir, "domusops-bootstrap");
    symlinkSync(file, link);
    expect(isEntryPoint(link, url)).toBe(true);
  });

  it("is false for another file, a missing entry, or no entry", () => {
    const { dir, url } = module();
    const other = join(dir, "other.js");
    writeFileSync(other, "");
    expect(isEntryPoint(other, url)).toBe(false);
    expect(isEntryPoint(join(dir, "missing.js"), url)).toBe(false);
    expect(isEntryPoint(undefined, url)).toBe(false);
  });
});
