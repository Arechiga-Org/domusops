import {
  expandTrace,
  type TraceStandardDocument,
  type TraceSummaryDocument,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { runTrace } from "../src/tools/ha-trace.js";
import {
  EDGE_TRACES,
  REFERENCE_TRACES,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";
import { encodeRecords } from "./support/trace-helpers.js";

/** `exclude` on ha_trace (specs/008-mcp-reliability US3, FR-007, FR-008, research R3). */

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function query(
  options: Parameters<typeof runTrace>[1] = {},
  extraEnv: Record<string, string> = {},
  fixture: TraceFixture = REFERENCE_TRACES,
): Promise<string> {
  const ha = await startFakeHa({ fixture });
  running.push(ha);
  return runTrace(
    {
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
      DOMUSOPS_TRACE_MAX_BYTES: "10000000",
      ...extraEnv,
    },
    { now: fixture.windowEnd * 1000, ...options },
  );
}

const registry = (fixture: TraceFixture) =>
  fixture.records.entity_registry as unknown as {
    entity_id: string;
    unique_id: string;
    platform: string;
  }[];

const entityOf = (
  fixture: TraceFixture,
  record: { domain: string; item_id: string },
): string | undefined =>
  registry(fixture).find(
    (e) => e.platform === record.domain && e.unique_id === record.item_id,
  )?.entity_id;

/** Automations of the reference set with stored runs, in entity-ID order. */
const AUTOMATIONS = [
  ...new Set(
    REFERENCE_TRACES.traces
      .filter((t) => t.domain === "automation")
      .map((t) => entityOf(REFERENCE_TRACES, t) as string),
  ),
].sort();
const EXCLUDED = AUTOMATIONS.slice(0, 3);
const KEPT_RUNS = REFERENCE_TRACES.traces.filter(
  (t) =>
    t.domain === "automation" &&
    !EXCLUDED.includes(entityOf(REFERENCE_TRACES, t) as string),
);

describe("ha_trace with exclude", () => {
  it("returns no run of an excluded automation in a standard document", async () => {
    const doc = JSON.parse(
      await query({ entities: ["automation.*"], exclude: EXCLUDED }),
    ) as TraceStandardDocument;
    expect(EXCLUDED.length).toBe(3);
    expect(
      expandTrace(doc)
        .map((r) => r.run_id)
        .sort(),
    ).toEqual(KEPT_RUNS.map((r) => r.run_id).sort());
    for (const id of EXCLUDED) expect(doc.items[id]).toBeUndefined();
  });

  it("returns no run of an excluded automation in a summary document, and counts without them", async () => {
    const doc = JSON.parse(
      await query({
        detail: "summary",
        entities: ["automation.*"],
        exclude: EXCLUDED,
      }),
    ) as TraceSummaryDocument;
    const text = JSON.stringify(doc.items);
    for (const id of EXCLUDED) expect(text).not.toContain(`"${id}"`);
    expect(doc.counts.runs + doc.counts.not_triggered).toBe(KEPT_RUNS.length);
  });

  it("applies the size check to what is returned", async () => {
    const { text: keptOnly } = encodeRecords(KEPT_RUNS, REFERENCE_TRACES);
    const all = await query({ entities: ["automation.*"] });
    const limit = Math.floor(
      (new TextEncoder().encode(all).length +
        new TextEncoder().encode(keptOnly).length) /
        2,
    );
    const env = { DOMUSOPS_TRACE_MAX_BYTES: String(limit) };
    await expect(
      query({ entities: ["automation.*"] }, env),
    ).rejects.toMatchObject({
      kind: "too_large",
      nextStep: expect.stringContaining("exclude") as unknown,
    });
    await expect(
      query({ entities: ["automation.*"], exclude: EXCLUDED }, env),
    ).resolves.toBeTypeOf("string");
  });

  it("works without entities: every automation and script except the excluded ones", async () => {
    const doc = JSON.parse(
      await query({ exclude: ["script.*"] }),
    ) as TraceStandardDocument;
    expect(
      expandTrace(doc)
        .map((r) => r.run_id)
        .sort(),
    ).toEqual(
      REFERENCE_TRACES.traces
        .filter((t) => t.domain === "automation")
        .map((r) => r.run_id)
        .sort(),
    );
  });

  it("does not ask the instance for the runs of a domain that exclude covers whole", async () => {
    const ha = await startFakeHa({ fixture: REFERENCE_TRACES });
    running.push(ha);
    await runTrace(
      {
        DOMUSOPS_HA_URL: ha.url,
        DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
        DOMUSOPS_TRACE_MAX_BYTES: "10000000",
      },
      { now: REFERENCE_TRACES.windowEnd * 1000, exclude: ["script.*"] },
    );
    const listed = ha.receivedTraceParams
      .filter((p) => !("run_id" in p))
      .map((p) => p["domain"]);
    expect(listed).toEqual(["automation"]);
  });

  it("lists no excluded ID in no_runs, and keeps the meaning of no_match", async () => {
    const doc = JSON.parse(
      await query(
        {
          entities: [
            "automation.never_ran",
            "automation.no_id",
            "automation.does_not_exist",
            "automation.also_missing",
          ],
          exclude: [
            "automation.never_ran",
            "automation.no_id",
            "automation.also_missing",
          ],
        },
        {},
        EDGE_TRACES,
      ),
    ) as TraceStandardDocument;
    const listed = JSON.stringify(doc.no_runs ?? {});
    expect(listed).not.toContain("automation.never_ran");
    expect(listed).not.toContain("automation.no_id");
    expect(listed).not.toContain("automation.also_missing");
    expect(doc.no_runs?.no_match).toEqual(["automation.does_not_exist"]);
  });

  it.each([["run"], ["context"]])(
    "refuses exclude with %s, as entities is refused",
    async (exclusive) => {
      const value =
        exclusive === "run"
          ? "0123456789abcdef0123456789abcdef"
          : "01JABCDEFGHJKMNPQRSTVWXYZ0";
      await expect(
        query({ [exclusive]: value, exclude: ["automation.*"] }),
      ).rejects.toMatchObject({ kind: "selection_invalid" });
    },
  );

  it.each([[[]], [["Automation.X"]], [["automation.x y"]]])(
    "refuses an invalid exclude list %j like an invalid entities list",
    async (exclude) => {
      await expect(query({ exclude })).rejects.toMatchObject({
        kind: "selector_invalid",
      });
    },
  );
});
