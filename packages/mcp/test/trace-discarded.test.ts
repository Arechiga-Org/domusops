import {
  formatIsoMicros,
  parseIsoMicros,
  type TraceExtendedRecord,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { queryTrace, type TraceOptions } from "../src/tools/ha-trace.js";
import {
  generateTraces,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";

/**
 * The discarded-runs note of a windowed ha_trace (specs/008-mcp-reliability US4, FR-011 to
 * FR-014, SC-005, research R4, R5, contracts/response-notes.md).
 */

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function query(
  fixture: TraceFixture,
  options: TraceOptions = {},
  fake: Partial<FakeHaOptions> = {},
): Promise<{ ha: FakeHa; document: string; notes: string[] }> {
  const ha = await startFakeHa({ fixture, ...fake });
  running.push(ha);
  const response = await queryTrace(
    {
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
      DOMUSOPS_TRACE_MAX_BYTES: "10000000",
    },
    { now: fixture.windowEnd * 1000, ...options },
  );
  return { ha, ...response };
}

/** A window that starts `fromAgo` before the fixture's end and ends `toAgo` before it. */
const window = (
  fixture: TraceFixture,
  fromAgo: number,
  toAgo = 0,
): { start: string; end: string } => ({
  start: new Date(fixture.windowEnd * 1000 - fromAgo).toISOString(),
  end: new Date(fixture.windowEnd * 1000 - toAgo).toISOString(),
});

/** Every run of the generated fixtures started in the 2 days before its end. */
const BEFORE_ALL = 3 * DAY;

const entityIds = (fixture: TraceFixture, domain?: string): string[] =>
  (
    fixture.records.entity_registry as unknown as {
      entity_id: string;
      platform: string;
    }[]
  )
    .filter((e) => domain === undefined || e.platform === domain)
    .map((e) => e.entity_id)
    .sort();

const note = (...items: string[]): string =>
  `Note: these automations and scripts store as many runs as they keep, so older runs from the window may be gone: ${items.join("; ")}. To keep more, raise stored_traces in the trace options of the automation or script. ha_logbook_query has the full history.`;

/** One automation with `runs` stored runs. */
const single = (runs: number): TraceFixture => generateTraces(1, runs, 8);

/**
 * Adds `count` not-triggered records of the fixture's first automation, newer than its runs. They
 * are stored apart from the runs, with a limit of their own.
 */
function withNotTriggered(fixture: TraceFixture, count: number): TraceFixture {
  const copy = structuredClone(fixture);
  const base = copy.traces[0] as TraceExtendedRecord;
  const start = parseIsoMicros(base.timestamp.start) as number;
  for (let i = 0; i < count; i++) {
    const at = start + (i + 1) * 1_000_000;
    copy.traces.push({
      ...structuredClone(base),
      run_id: `${"f".repeat(30)}${String(i).padStart(2, "0")}`,
      not_triggered: true,
      script_execution: "not_triggered",
      timestamp: { start: formatIsoMicros(at), finish: formatIsoMicros(at) },
    });
  }
  return copy;
}

describe("ha_trace's discarded-runs note", () => {
  it("names an automation that stores as many runs as it keeps, the oldest after the window start", async () => {
    const fixture = single(5);
    const [id] = entityIds(fixture);
    const { notes } = await query(fixture, window(fixture, BEFORE_ALL));
    expect(notes).toEqual([note(`${id} (keeps 5)`)]);
  });

  it("reads the limits alongside the runs, not after the document", async () => {
    const fixture = single(5);
    const { ha } = await query(fixture, window(fixture, BEFORE_ALL));
    const config = ha.received.indexOf("automation/config");
    expect(config).toBeGreaterThan(-1);
    expect(config).toBeLessThan(ha.received.indexOf("trace/get"));
  });

  it("leaves the document exactly as it is without the note", async () => {
    const fixture = single(5);
    const [id] = entityIds(fixture);
    const args = window(fixture, BEFORE_ALL);
    const withNote = await query(fixture, args);
    const without = await query(fixture, args, {
      storedTraces: { [id as string]: 20 },
    });
    expect(withNote.notes).toHaveLength(1);
    expect(without.notes).toEqual([]);
    expect(withNote.document).toBe(without.document);
  });

  it("is not sent for an automation that stores fewer runs than it keeps", async () => {
    const fixture = single(6);
    const [id] = entityIds(fixture);
    const { notes } = await query(fixture, window(fixture, BEFORE_ALL), {
      storedTraces: { [id as string]: 20 },
    });
    expect(notes).toEqual([]);
  });

  it("states a lower limit the automation sets", async () => {
    const fixture = single(2);
    const [id] = entityIds(fixture);
    const { notes } = await query(fixture, window(fixture, BEFORE_ALL), {
      storedTraces: { [id as string]: 2 },
    });
    expect(notes).toEqual([note(`${id} (keeps 2)`)]);
  });

  it("assumes 5 when the configuration cannot be read, and says so", async () => {
    const fixture = single(5);
    const [id] = entityIds(fixture);
    const { notes } = await query(fixture, window(fixture, BEFORE_ALL), {
      failCommand: { type: "automation/config" },
    });
    expect(notes).toEqual([note(`${id} (keeps 5, limit assumed)`)]);
  });

  it("counts runs only: not-triggered records are stored apart and never replace runs", async () => {
    // 2 runs and 5 newer not-triggered records: the runs are far from their limit.
    const fixture = withNotTriggered(single(2), 5);
    expect((await query(fixture, window(fixture, BEFORE_ALL))).notes).toEqual(
      [],
    );
  });

  it("assumes the limit of an item built from a blueprint that does not set it", async () => {
    const fixture = single(5);
    const [id] = entityIds(fixture);
    const { notes } = await query(fixture, window(fixture, BEFORE_ALL), {
      blueprints: [id as string],
    });
    expect(notes).toEqual([note(`${id} (keeps 5, limit assumed)`)]);
    // A limit its own configuration sets is read as given.
    const own = await query(fixture, window(fixture, BEFORE_ALL), {
      blueprints: [id as string],
      storedTraces: { [id as string]: 20 },
    });
    expect(own.notes).toEqual([]);
  });

  it("names at most 10 items, in entity-ID order, then how many more", async () => {
    const fixture = generateTraces(12, 5, 12);
    const ids = entityIds(fixture);
    expect(ids).toHaveLength(12);
    const { notes } = await query(fixture, window(fixture, BEFORE_ALL));
    expect(notes).toEqual([
      note(...ids.slice(0, 10).map((id) => `${id} (keeps 5)`)).replace(
        ". To keep more",
        "; and 2 more. To keep more",
      ),
    ]);
  });

  it("is sent with an empty result", async () => {
    const fixture = single(5);
    const [id] = entityIds(fixture);
    const { document, notes } = await query(
      fixture,
      window(fixture, BEFORE_ALL, BEFORE_ALL - DAY),
    );
    expect(
      (JSON.parse(document) as { counts: { runs: number } }).counts.runs,
    ).toBe(0);
    expect(notes).toEqual([note(`${id} (keeps 5)`)]);
  });

  it("reads no configuration and sends no note when the oldest run is inside the window", async () => {
    const fixture = single(5);
    const { ha, notes } = await query(fixture, window(fixture, 30_000));
    expect(notes).toEqual([]);
    expect(ha.receivedConfigIds).toEqual([]);
  });

  it("follows the exclusion note, and never names or reads an excluded item", async () => {
    const fixture = generateTraces(3, 5, 3);
    const [excluded, ...kept] = entityIds(fixture);
    const { ha, notes } = await query(fixture, {
      ...window(fixture, BEFORE_ALL),
      exclude: [excluded as string],
    });
    expect(notes).toEqual([
      `Note: excluded ${excluded}. Counts, the size check and compression_ratio leave them out.`,
      note(...kept.map((id) => `${id} (keeps 5)`)),
    ]);
    expect(ha.receivedConfigIds.sort()).toEqual(kept);
  });

  it("reads scripts with script/config", async () => {
    const fixture = generateTraces(4, 5, 4);
    const scripts = entityIds(fixture, "script");
    expect(scripts.length).toBeGreaterThan(0);
    const { ha, notes } = await query(fixture, {
      ...window(fixture, BEFORE_ALL),
      entities: ["script.*"],
    });
    expect(notes).toEqual([note(...scripts.map((id) => `${id} (keeps 5)`))]);
    expect(ha.received.filter((type) => type.endsWith("/config"))).toEqual(
      scripts.map(() => "script/config"),
    );
  });

  it.each([
    ["no window", {}],
    ["a run", { run: "run" }],
    ["a context", { context: "context" }],
  ])("is not sent, and no configuration is read, for %s", async (_, given) => {
    const fixture = single(5);
    const record = fixture.traces[0] as TraceExtendedRecord;
    const options =
      "run" in given
        ? { run: record.run_id }
        : "context" in given
          ? { context: record.context.id }
          : {};
    const { ha, notes } = await query(fixture, options);
    expect(notes).toEqual([]);
    expect(ha.received.some((type) => type.endsWith("/config"))).toBe(false);
  });
});
