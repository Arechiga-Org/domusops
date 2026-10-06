import {
  encodeContextId,
  type TraceExtendedRecord,
  type TraceShortRecord,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/errors.js";
import type { ContextEntry, TraceRef } from "../src/ha/trace.js";
import { parseWindowInput, resolveWindow } from "../src/logbook/window.js";
import {
  contextKey,
  contextTimeMs,
  parseContextId,
  parseRunId,
  sameContext,
} from "../src/trace/context-id.js";
import { resolveItems } from "../src/trace/items.js";
import {
  domainsFor,
  parseRequest,
  selectTraces,
  type SelectInput,
} from "../src/trace/select.js";
import { EDGE_TRACES } from "./fixtures/generate-traces.js";

const NOW = EDGE_TRACES.windowEnd * 1000;
const traces = EDGE_TRACES.traces;

const items = resolveItems({
  registry: (
    EDGE_TRACES.records.entity_registry as unknown as {
      entity_id: string;
      unique_id: string;
      platform: "automation" | "script";
    }[]
  ).map(({ entity_id, unique_id, platform }) => ({
    entity_id,
    unique_id,
    platform,
  })),
  untraceable: ["automation.no_id"],
});

const LONG = new Set(["trace", "config", "blueprint_inputs", "context"]);
const shortOf = (record: TraceExtendedRecord): TraceShortRecord =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !LONG.has(key)),
  ) as TraceShortRecord;
const short = traces.map(shortOf);
const contexts = new Map<string, ContextEntry>(
  traces.map((t) => [
    t.context.id,
    { run_id: t.run_id, domain: t.domain, item_id: t.item_id },
  ]),
);
const byRun = new Map(traces.map((t) => [t.run_id, t]));

let fetched: string[] = [];
const input = (over: Partial<SelectInput>): SelectInput => ({
  request: {},
  items,
  short,
  contexts,
  window: null,
  fetch: async (refs: TraceRef[]) => {
    fetched.push(...refs.map((r) => r.run_id));
    return refs.map((r) => byRun.get(r.run_id) as TraceExtendedRecord);
  },
  ...over,
});

const kindOf = async (action: () => unknown): Promise<string> => {
  try {
    await action();
  } catch (error) {
    return (error as ToolError).kind;
  }
  return "none";
};

describe("context IDs (research R8, R14)", () => {
  const A = "01KMNPQRSTVWXYZ0123456789A";
  it("matches on the last 16 characters, whatever the anchor", () => {
    const one = encodeContextId(A, 1_000) as string;
    const two = encodeContextId(A, 9_000) as string;
    expect(one).not.toBe(two);
    expect(sameContext(one, two)).toBe(true);
    expect(sameContext(A, one)).toBe(true);
    expect(contextKey(A)).toBe(contextKey(two));
  });

  it("never matches a ULID with a different random part", () => {
    const other = `${A.slice(0, 10)}${"Z".repeat(16)}`;
    expect(sameContext(A, other)).toBe(false);
  });

  it("matches an ID that is not a ULID only exactly", () => {
    expect(sameContext("abc", "abc")).toBe(true);
    expect(sameContext("abc", "abd")).toBe(false);
    expect(sameContext("abc", A)).toBe(false);
  });

  it("reads the time of a full ULID and of nothing else", () => {
    expect(typeof contextTimeMs(A)).toBe("number");
    expect(contextTimeMs("abc")).toBeNull();
    expect(contextTimeMs(encodeContextId(A, 1_000) as string)).toBeNull();
  });

  it("validates the forms of the inputs", () => {
    expect(parseRunId("0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b")).toHaveLength(32);
    for (const bad of [
      "0F3C9A2B7D1E4C5F8A6B9C0D1E2F3A4B",
      "abc",
      `${"a".repeat(31)}g`,
    ]) {
      expect(() => parseRunId(bad)).toThrowError(/run ID/);
    }
    expect(parseContextId(A)).toBe(A);
    expect(parseContextId("-3570:PDZXR3NWJNS83TS2")).toBe(
      "-3570:PDZXR3NWJNS83TS2",
    );
    expect(parseContextId("some-other-id")).toBe("some-other-id");
    for (const bad of ["a\u0001b", "x".repeat(65), ""]) {
      expect(() => parseContextId(bad)).toThrowError(/context ID/);
    }
  });
});

describe("item resolution (research R3)", () => {
  it("maps a trace to its entity ID through the registry", () => {
    const registered = items.registered;
    const some = traces.find((t) =>
      items.keyOf(t.domain, t.item_id).includes("."),
    );
    expect(some).toBeDefined();
    expect(registered).toContain(items.keyOf(some!.domain, some!.item_id));
  });

  it("keys a trace of a removed item by domain and item ID", () => {
    expect(items.keyOf("automation", "1699999999999")).toBe(
      "automation:1699999999999",
    );
  });

  it("knows the untraceable automations, which have no trace", () => {
    expect(items.untraceable.has("automation.no_id")).toBe(true);
    expect(items.registered).not.toContain("automation.no_id");
  });
});

describe("parseRequest (research R14)", () => {
  const RUN = "0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b";
  it("accepts each selection on its own, and detail-free combinations", () => {
    expect(parseRequest({ run: RUN }).run).toBe(RUN);
    expect(parseRequest({ context: "abc" }).context).toBe("abc");
    expect(
      parseRequest({ entities: ["automation.*", "automation.*"] }).selectors,
    ).toEqual(["automation.*"]);
    expect(
      parseRequest({ entities: ["script.*"], start: "2026-03-14T00:00" })
        .window,
    ).toBeDefined();
    expect(parseRequest({}).window).toBeUndefined();
  });

  it.each([
    [{ run: RUN, context: "abc" }],
    [{ run: RUN, entities: ["automation.*"] }],
    [{ run: RUN, start: "2026-03-14T00:00" }],
    [{ run: RUN, end: "2026-03-14T00:00" }],
    [{ context: "abc", entities: ["automation.*"] }],
    [{ context: "abc", start: "2026-03-14T00:00" }],
    [{ run: "not-a-run-id" }],
    [{ context: "a\u0001b" }],
  ])("rejects %j as selection_invalid", (bad) => {
    expect(() => parseRequest(bad)).toThrowError(ToolError);
    try {
      parseRequest(bad);
    } catch (error) {
      expect((error as ToolError).kind).toBe("selection_invalid");
    }
  });

  it("rejects an invalid selector and an invalid window with their own kinds", () => {
    expect(() => parseRequest({ entities: ["Automation.X"] })).toThrowError(
      /selector/,
    );
    expect(() => parseRequest({ start: "2026-13-01" })).toThrowError(/window/);
  });
});

describe("domainsFor", () => {
  it("lists both domains without selectors, and only the ones a selector can match", () => {
    expect(domainsFor({})).toEqual(["automation", "script"]);
    expect(domainsFor({ selectors: ["automation.x"] })).toEqual(["automation"]);
    expect(domainsFor({ selectors: ["script.*_lights"] })).toEqual(["script"]);
    expect(domainsFor({ selectors: ["*_motion"] })).toEqual([
      "automation",
      "script",
    ]);
    expect(domainsFor({ selectors: ["auto*"] })).toEqual(["automation"]);
    expect(domainsFor({ selectors: ["light.*"] })).toEqual([]);
  });
});

describe("selectTraces: selectors", () => {
  it("selects every stored trace without a selector, removed items included", async () => {
    const got = await selectTraces(input({}));
    expect(got.shorts).toHaveLength(traces.length);
    expect(got.noRuns).toBeNull();
  });

  it("selects the traces of the items a pattern matches, never a removed item's", async () => {
    const got = await selectTraces(
      input({ request: { selectors: ["automation.*"] } }),
    );
    expect(got.shorts.length).toBeGreaterThan(0);
    for (const record of got.shorts) expect(record.domain).toBe("automation");
    expect(got.shorts.some((r) => r.item_id === "1699999999999")).toBe(false);
  });

  it("selects each trace once for duplicate and overlapping selectors", async () => {
    const one = await selectTraces(
      input({ request: { selectors: ["script.*"] } }),
    );
    const many = await selectTraces(
      input({ request: { selectors: ["script.*", "script.*", "*"] } }),
    );
    const scripts = many.shorts.filter((r) => r.domain === "script");
    expect(scripts).toHaveLength(one.shorts.length);
    expect(new Set(many.shorts.map((r) => r.run_id)).size).toBe(
      many.shorts.length,
    );
  });

  it("selects one item by its exact entity ID", async () => {
    const id = items.registered.find((e) =>
      e.startsWith("automation."),
    ) as string;
    const got = await selectTraces(input({ request: { selectors: [id] } }));
    for (const record of got.shorts) {
      expect(items.keyOf(record.domain, record.item_id)).toBe(id);
    }
  });
});

describe("selectTraces: run", () => {
  it("selects exactly the run", async () => {
    const wanted = traces[3] as TraceExtendedRecord;
    const got = await selectTraces(input({ request: { run: wanted.run_id } }));
    expect(got.shorts.map((r) => r.run_id)).toEqual([wanted.run_id]);
  });

  it("fails with run_not_found for a run that is not stored", async () => {
    expect(
      await kindOf(() =>
        selectTraces(input({ request: { run: "0".repeat(32) } })),
      ),
    ).toBe("run_not_found");
  });
});

describe("selectTraces: context", () => {
  const shared = (): TraceExtendedRecord[] => {
    const by = new Map<string, TraceExtendedRecord[]>();
    for (const t of traces)
      by.set(t.context.id, [...(by.get(t.context.id) ?? []), t]);
    return [...by.values()].find(
      (group) => group.length > 1,
    ) as TraceExtendedRecord[];
  };

  it("has a context shared by an automation run and a script run in the fixture", () => {
    const group = shared();
    expect(group).toBeDefined();
    expect(new Set(group.map((t) => t.domain)).size).toBe(2);
  });

  it("returns every run in a context, by full ID and by either compact form", async () => {
    const group = shared();
    const id = (group[0] as TraceExtendedRecord).context.id;
    const want = group.map((t) => t.run_id).sort();
    for (const form of [
      id,
      encodeContextId(id, 5_000) as string,
      encodeContextId(id, 90_000) as string,
    ]) {
      fetched = [];
      const got = await selectTraces(input({ request: { context: form } }));
      expect(got.shorts.map((r) => r.run_id).sort()).toEqual(want);
    }
  });

  it("does not read a trace that started before the context existed", async () => {
    const group = shared();
    const id = (group[0] as TraceExtendedRecord).context.id;
    const created = contextTimeMs(id) as number;
    const earlier = traces.filter(
      (t) => Date.parse(t.timestamp.start.replace("+00:00", "Z")) < created,
    );
    expect(earlier.length).toBeGreaterThan(0);
    fetched = [];
    await selectTraces(input({ request: { context: id } }));
    for (const t of earlier) expect(fetched).not.toContain(t.run_id);
  });

  it("fails with run_not_found for a context no stored run ran in", async () => {
    expect(
      await kindOf(() =>
        selectTraces(input({ request: { context: "no-such-context" } })),
      ),
    ).toBe("run_not_found");
  });
});

describe("selectTraces: runs that were not selected (spec FR-004)", () => {
  it("reports no_match, no_stored_runs, and untraceable apart", async () => {
    const got = await selectTraces(
      input({
        request: {
          selectors: [
            "light.*",
            "automation.never_ran",
            "automation.no_id",
            "automation.x_none",
          ],
        },
      }),
    );
    expect(got.shorts).toEqual([]);
    expect(got.noRuns).toEqual({
      no_match: ["light.*", "automation.x_none"],
      no_stored_runs: ["automation.never_ran"],
      untraceable: ["automation.no_id"],
    });
  });

  it("reports an item whose traces are all outside the window as none_in_window", async () => {
    const window = resolveWindow(
      parseWindowInput({ start: "2020-01-01T00:00", end: "2020-01-02T00:00" }),
      NOW,
      "Europe/Madrid",
    );
    const got = await selectTraces(
      input({
        request: { selectors: ["automation.*"] },
        window,
      }),
    );
    expect(got.shorts).toEqual([]);
    expect(got.noRuns?.none_in_window?.length).toBeGreaterThan(0);
    expect(got.noRuns?.no_stored_runs).toEqual(["automation.never_ran"]);
  });

  it("keeps only traces that started inside the window", async () => {
    const starts = traces
      .map((t) => Date.parse(t.timestamp.start.replace("+00:00", "Z")))
      .sort();
    const mid = starts[Math.floor(starts.length / 2)] as number;
    const window = {
      startMs: mid,
      endMs: (starts.at(-1) as number) + 1,
      startIso: "",
      endIso: "",
    };
    const got = await selectTraces(input({ window }));
    expect(got.shorts.length).toBeGreaterThan(0);
    expect(got.shorts.length).toBeLessThan(traces.length);
    for (const record of got.shorts) {
      const at = Date.parse(record.timestamp.start.replace("+00:00", "Z"));
      expect(at).toBeGreaterThanOrEqual(mid - 1);
    }
  });

  it("has no reasons without selectors, or with a run or a context", async () => {
    const got = await selectTraces(
      input({ request: { run: (traces[0] as TraceExtendedRecord).run_id } }),
    );
    expect(got.noRuns).toBeNull();
  });
});
