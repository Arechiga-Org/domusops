import type { SystemLogStandardDocument } from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import type { RawLogEntry } from "../src/ha/system-log.js";
import { byteLength, finalize } from "../src/snapshot/ratio.js";
import { encodeStandardSystemLog } from "../src/system-log/encode-standard.js";
import {
  classify,
  prepareEntry,
  selectEntries,
} from "../src/system-log/entries.js";
import { systemLogFrame } from "../src/system-log/envelope.js";
import { splitTraceback } from "../src/system-log/traceback.js";
import { querySystemLog } from "../src/tools/ha-system-log.js";
import {
  generateSystemLog,
  LOG_NOW_MS,
  REFERENCE_SYSTEM_LOG,
  systemLogFixture,
} from "./fixtures/generate-system-log.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";
import { entry, NOW_MS } from "./support/system-log.js";

/** The standard encoding (specs/012-ha-system-log data-model §2 and §3, research R6, R11, R12). */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const frameAt = (nowMs = NOW_MS, extra: { custom?: string[] } = {}) =>
  systemLogFrame({
    detail: "standard",
    haVersion: "2026.10.0",
    timeZone: "Europe/Madrid",
    nowMs,
    custom: extra.custom ?? [],
  });

/** The standard document of `entries`, in the tool's order, without roots or redaction. */
function encode(
  entries: RawLogEntry[],
  nowMs = NOW_MS,
): SystemLogStandardDocument {
  const same = (text: string): string => text;
  const selected = selectEntries(entries.map(classify), {});
  return encodeStandardSystemLog(
    frameAt(nowMs),
    selected.map((e) => prepareEntry(e, same, same)),
  );
}

const frame = (path: string, line: number, fn: string, code?: string) =>
  `  File "${path}", line ${line}, in ${fn}${code === undefined ? "" : `\n${code}`}`;

async function call(
  log: RawLogEntry[],
  options: { integrations?: string[] } = {},
  env: Record<string, string> = {},
) {
  const ha = await startFakeHa({ fixture: systemLogFixture(log) });
  cleanups.push(() => ha.close());
  return querySystemLog(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...env },
    { ...options, now: LOG_NOW_MS },
  );
}

describe("the envelope", () => {
  it("has the keys of data-model §2 in order, the optional ones only when given", () => {
    expect(Object.keys(frameAt().envelope)).toEqual([
      "format",
      "detail",
      "ha_version",
      "compression_ratio",
      "time_zone",
      "utc_offset",
    ]);
    const full = systemLogFrame({
      detail: "standard",
      haVersion: "2026.10.0",
      timeZone: "Europe/Madrid",
      nowMs: NOW_MS,
      integrations: ["mqtt"],
      level: "error",
      startMs: NOW_MS - 3_600_000,
      custom: ["acme_cloud"],
    }).envelope;
    expect(full).toEqual({
      format: "domusops.system_log/0.1",
      detail: "standard",
      ha_version: "2026.10.0",
      compression_ratio: 0,
      time_zone: "Europe/Madrid",
      utc_offset: "+01:00",
      integrations: ["mqtt"],
      level: "error",
      start: "2026-11-13T11:00:00+01:00",
      custom: ["acme_cloud"],
    });
    expect(Object.keys(full).slice(6)).toEqual([
      "integrations",
      "level",
      "start",
      "custom",
    ]);
  });

  it("takes utc_offset at the time of the call", () => {
    expect(frameAt(Date.UTC(2026, 6, 1)).envelope.utc_offset).toBe("+02:00");
  });
});

describe("entries", () => {
  it("are grouped by local date, to the second, with the first occurrence as short as it can be", () => {
    const document = encode([
      entry({ name: "a", source: ["a.py", 1], last: "2026-11-12T23:59:59" }),
      entry({
        name: "b",
        source: ["b.py", 2],
        last: "2026-11-13T00:00:01",
        first: "2026-11-12T20:00:00",
        count: 2,
      }),
      entry({
        name: "c",
        source: ["c.py", 3],
        last: "2026-11-13T10:00:00",
        first: "2026-11-13T09:00:00",
        count: 2,
      }),
    ]);
    expect(document.entries).toEqual({
      "2026-11-12": [
        ["23:59:59", "error", "a", null, [0, 1], 1, ["Something went wrong"]],
      ],
      "2026-11-13": [
        [
          "00:00:01",
          "error",
          "b",
          null,
          [1, 2],
          2,
          ["Something went wrong"],
          "2026-11-12T20:00:00",
        ],
        [
          "10:00:00",
          "error",
          "c",
          null,
          [2, 3],
          2,
          ["Something went wrong"],
          "09:00:00",
        ],
      ],
    });
  });

  it("drops trailing nulls and ends with 1 when the integration came from the source", () => {
    const document = encode([
      entry({
        name: "pyacme.client",
        source: ["custom_components/acme_cloud/__init__.py", 5],
        last: "2026-11-13T10:00:00",
      }),
    ]);
    expect(document.entries["2026-11-13"]?.[0]).toEqual([
      "10:00:00",
      "error",
      "pyacme.client",
      "acme_cloud",
      [0, 5],
      1,
      ["Something went wrong"],
      null,
      null,
      1,
    ]);
  });
});

describe("files and parts", () => {
  const shared = frame(
    "{ha}/helpers/update_coordinator.py",
    380,
    "_async_refresh",
    "    self.data = await self._async_update_data()",
  );
  const tracebackOf = (...lines: string[]) =>
    ["Traceback (most recent call last):", ...lines].join("\n");

  it("give every path once in order of first use, sources and frames alike", () => {
    const document = encode([
      entry({
        name: "x",
        source: ["helpers/update_coordinator.py", 393],
        last: "2026-11-13T10:00:00",
        exception: tracebackOf(
          shared,
          frame(
            "{ha}/components/zha/coordinator.py",
            50,
            "fetch",
            "    return 1",
          ),
          "ValueError: x",
        ),
      }),
      entry({
        name: "y",
        source: ["helpers/update_coordinator.py", 393],
        last: "2026-11-13T10:01:00",
        exception: tracebackOf(shared, "ValueError: y"),
      }),
    ]);
    expect(document.files).toEqual([
      "helpers/update_coordinator.py",
      "{ha}/helpers/update_coordinator.py",
      "{ha}/components/zha/coordinator.py",
    ]);
    // The shared frame is one part; the header is used twice and is a part; the rest is inline.
    expect(document.parts).toEqual([
      "Traceback (most recent call last):",
      [
        1,
        380,
        "_async_refresh",
        "    self.data = await self._async_update_data()",
      ],
      [2, 50, "fetch", "    return 1"],
    ]);
    expect(document.entries["2026-11-13"]?.map((row) => row[8])).toEqual([
      [0, 1, 2, "ValueError: x"],
      [0, 1, "ValueError: y"],
    ]);
  });

  it("make every frame a part, keep a frame's code with its caret lines, and omit code a frame lacks", () => {
    const document = encode([
      entry({
        name: "x",
        source: ["helpers/template/__init__.py", 466],
        last: "2026-11-13T10:00:00",
        exception: tracebackOf(
          frame(
            "{ha}/helpers/template/__init__.py",
            664,
            "async_render",
            "    return x()\n           ~^^",
          ),
          frame("<template>", 1, "top-level template code"),
          "ZeroDivisionError: division by zero",
        ),
      }),
    ]);
    expect(document.parts).toEqual([
      [1, 664, "async_render", "    return x()\n           ~^^"],
      [2, 1, "top-level template code"],
    ]);
    expect(document.entries["2026-11-13"]?.[0]?.[8]).toEqual([
      "Traceback (most recent call last):",
      0,
      1,
      "ZeroDivisionError: division by zero",
    ]);
  });

  it("join consecutive inline lines, and never make an empty line a part", () => {
    const chained = [
      tracebackOf(
        frame(
          "{config}/custom_components/a/api.py",
          41,
          "get",
          "    return p['v']",
        ),
        "KeyError: 'v'",
      ),
      "",
      "The above exception was the direct cause of the following exception:",
      "",
      tracebackOf(
        frame(
          "{config}/custom_components/a/api.py",
          43,
          "get",
          "    raise Failed()",
        ),
        "Failed: bad",
      ),
    ].join("\n");
    const document = encode([
      entry({
        name: "custom_components.a",
        source: ["custom_components/a/api.py", 43],
        last: "2026-11-13T10:00:00",
        exception: chained,
      }),
    ]);
    expect(document.entries["2026-11-13"]?.[0]?.[8]).toEqual([
      0,
      1,
      "KeyError: 'v'\n\nThe above exception was the direct cause of the following exception:\n",
      0,
      2,
      "Failed: bad",
    ]);
    expect(document.parts[0]).toBe("Traceback (most recent call last):");
  });

  it("keep a line that only looks like a frame as a line", () => {
    expect(
      splitTraceback('  File "x.py", line 007, in f\n    y()').map(
        (i) => i.kind,
      ),
    ).toEqual(["line", "line"]);
  });
});

describe("compression_ratio (FR-017, research R12)", () => {
  it("is at least 1.8 on the reference log (SC-002)", async () => {
    const response = await call(REFERENCE_SYSTEM_LOG.systemLog);
    const document = JSON.parse(response.document) as SystemLogStandardDocument;
    expect(document.compression_ratio).toBeGreaterThanOrEqual(1.8);
  });

  it("measures only the selected entries as received", async () => {
    const log = REFERENCE_SYSTEM_LOG.systemLog;
    const response = await call(log, { integrations: ["recorder"] });
    const selected = log.filter((e) =>
      e.name.startsWith("homeassistant.components.recorder"),
    );
    expect(selected).toHaveLength(1);
    const document = JSON.parse(response.document) as SystemLogStandardDocument;
    const emitted = byteLength(
      JSON.stringify({ ...document, compression_ratio: 0 }),
    );
    expect(document.compression_ratio).toBe(
      Math.round((byteLength(JSON.stringify(selected)) / emitted) * 100) / 100,
    );
    expect(finalize(document, byteLength(JSON.stringify(selected)))).toBe(
      response.document,
    );
  });

  it("lets a log of 500 entries with long tracebacks exceed the default limit (research R9)", async () => {
    const big = Array.from({ length: 10 }, (_, i) =>
      generateSystemLog(100 + i).map((e) => ({ ...e, name: `${e.name}_${i}` })),
    ).flat();
    expect(big).toHaveLength(500);
    await expect(call(big)).rejects.toMatchObject({ kind: "too_large" });
  });
});
