import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expand, expandLogbook, expandTrace } from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { errors } from "../src/errors.js";
import { encodeStandard as encodeLogbook } from "../src/logbook/encode-standard.js";
import { encodeSummary as encodeLogbookSummary } from "../src/logbook/encode-summary.js";
import { encodeFull as encodeSnapshotFull } from "../src/snapshot/encode-full.js";
import { encodeStandard as encodeSnapshot } from "../src/snapshot/encode-standard.js";
import { encodeSummary as encodeSnapshotSummary } from "../src/snapshot/encode-summary.js";
import { project } from "../src/snapshot/project.js";
import { REFERENCE_500 } from "./fixtures/generate.js";
import { REFERENCE_LOGBOOK_24H } from "./fixtures/generate-logbook.js";
import { REFERENCE_TRACES } from "./fixtures/generate-traces.js";
import { contextFor } from "./support/logbook.js";
import { encodeRecords } from "./support/trace-helpers.js";

/**
 * The package README is published, so a stale command or a broken example is a published defect
 * (specs/008-mcp-reliability FR-005, FR-006, research R8, contracts/readme.md).
 */
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

/** The fenced code blocks of the README, with their language. */
function codeBlocks(): { lang: string; body: string; index: number }[] {
  return [...README.matchAll(/^ *```(\w*)\n([\s\S]*?)^ *```$/gm)].map((m) => ({
    lang: m[1] ?? "",
    body: m[2] ?? "",
    index: m.index,
  }));
}

describe("the @domusops/mcp README", () => {
  it("pins the on-demand form to the package's current minor", () => {
    const [major, minor] = pkg.version.split(".");
    const pins = [...README.matchAll(/@domusops\/mcp@~(\d+)\.(\d+)/g)];
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins)
      expect(`${pin[1]}.${pin[2]}`).toBe(`${major}.${minor}`);
  });

  it.each(["Install and run", "Claude Code", "Reading responses"])(
    "has the %s section",
    (heading) => {
      expect(README).toMatch(new RegExp(`^## ${heading}$`, "m"));
    },
  );

  it("holds no token and points every example URL at an invented host", () => {
    expect(README).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/);
    const urls = codeBlocks().flatMap(({ body }) => [
      ...body.matchAll(
        /"DOMUSOPS_HA_URL"\s*:\s*"([^"]+)"|DOMUSOPS_HA_URL=["']?([^"'\s]+)/g,
      ),
    ]);
    expect(urls.length).toBeGreaterThan(0);
    for (const match of urls) {
      let value = match[1] ?? match[2] ?? "";
      // A reference to the environment is checked through its default, when it has one.
      const reference = /^\$\{\w+(?::?-(.*))?\}$/.exec(value);
      if (reference !== null) {
        if (reference[1] === undefined) continue;
        value = reference[1];
      }
      expect(["homeassistant.local", "localhost"]).toContain(
        new URL(value).hostname,
      );
    }
  });
});

describe("the README's tested decoding example", () => {
  const written: string[] = [];
  afterEach(() => {
    while (written.length > 0) rmSync(written.pop()!, { force: true });
  });

  function testedExample(): string {
    const marker = README.indexOf("<!-- tested example -->");
    expect(marker, "no <!-- tested example --> marker").toBeGreaterThan(-1);
    const block = codeBlocks().find((b) => b.index > marker);
    expect(block?.lang).toBe("js");
    const body = block?.body ?? "";
    expect(body.match(/^import .* from "@domusops\/schema";$/gm)).toHaveLength(
      1,
    );
    return body;
  }

  /**
   * Runs the example as written, then calls the `decode` function it defines on `result`. The
   * module sits inside the package so the workspace resolves `@domusops/schema`; its name carries
   * the process ID so parallel runs never share a file, and `.gitignore` covers any left behind.
   */
  async function runExample(result: unknown, name: string): Promise<unknown> {
    const file = fileURLToPath(
      new URL(
        `../readme-example-${name}-${process.pid}.tmp.mjs`,
        import.meta.url,
      ),
    );
    written.push(file);
    writeFileSync(
      file,
      [
        testedExample(),
        "",
        `export const decoded = decode(${JSON.stringify(result)});`,
      ].join("\n"),
    );
    const module = (await import(pathToFileURL(file).href)) as {
      decoded: unknown;
    };
    return module.decoded;
  }

  /** Runs the example on a successful result whose first block is `document`, then a note. */
  function decode(document: unknown, name: string): Promise<unknown> {
    return runExample(
      {
        content: [
          { type: "text", text: JSON.stringify(document) },
          { type: "text", text: "Note: a note the example must leave alone." },
        ],
      },
      name,
    );
  }

  it("decodes a standard snapshot with expand", async () => {
    const doc = encodeSnapshot(
      project(REFERENCE_500.records, { omit: true }),
      REFERENCE_500.haVersion,
    );
    expect(await decode(doc, "snapshot")).toEqual(
      expand(JSON.parse(JSON.stringify(doc))),
    );
  });

  it("decodes a full snapshot with expand", async () => {
    const doc = encodeSnapshotFull(
      project(REFERENCE_500.records, { omit: false }),
      REFERENCE_500.haVersion,
    );
    expect(await decode(doc, "snapshot-full")).toEqual(
      expand(JSON.parse(JSON.stringify(doc))),
    );
  });

  it.each([
    [
      "snapshot",
      () =>
        encodeSnapshotSummary(
          project(REFERENCE_500.records, { omit: true }),
          REFERENCE_500.haVersion,
        ),
    ],
    [
      "logbook",
      () =>
        encodeLogbookSummary(
          REFERENCE_LOGBOOK_24H.logbook,
          contextFor(REFERENCE_LOGBOOK_24H),
        ),
    ],
  ])("returns a %s summary as it is", async (name, encode) => {
    const doc = JSON.parse(JSON.stringify(encode())) as unknown;
    expect(await decode(doc, `${name}-summary`)).toEqual(doc);
  });

  it("throws the error text of a failed call instead of parsing it", async () => {
    const text = errors
      .configMissing("DOMUSOPS_HA_URL")
      .toToolText("ha_snapshot");
    await expect(
      runExample({ isError: true, content: [{ type: "text", text }] }, "error"),
    ).rejects.toThrow(text);
  });

  it("decodes a standard logbook document with expandLogbook", async () => {
    const doc = encodeLogbook(
      REFERENCE_LOGBOOK_24H.logbook,
      contextFor(REFERENCE_LOGBOOK_24H),
    );
    expect(await decode(doc, "logbook")).toEqual(
      expandLogbook(JSON.parse(JSON.stringify(doc))),
    );
  });

  it("decodes a standard trace document with expandTrace", async () => {
    const { text } = encodeRecords(REFERENCE_TRACES.traces, REFERENCE_TRACES);
    const doc = JSON.parse(text) as Parameters<typeof expandTrace>[0];
    expect(await decode(doc, "trace")).toEqual(expandTrace(doc));
  });
});
