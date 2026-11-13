import {
  expandHistory,
  historyJsonSchema,
  type HistoryStandardDocument,
  type HistorySummaryDocument,
} from "@domusops/schema";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError, type ErrorKind } from "../src/errors.js";
import type { Timeouts } from "../src/ha/client.js";
import type { Response } from "../src/notes.js";
import { byteLength } from "../src/snapshot/ratio.js";
import { queryHistory, type HistoryOptions } from "../src/tools/ha-history.js";
import type { Fixture } from "./fixtures/generate.js";
import { REFERENCE_HISTORY } from "./fixtures/generate-history.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";
import {
  historyFixture,
  NOW_MS,
  SMALL_HISTORY,
  SMALL_HOME,
  timeline,
  W0,
  W1,
  WINDOW,
} from "./support/history.js";

/** The `ha_history` tool on a simulated instance (specs/011-ha-history, quickstart §2). */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  historyJsonSchema,
);

const SHORT: Partial<Timeouts> = {
  connectMs: 300,
  commandMs: 300,
  totalMs: 1500,
};

type Setup = {
  fixture?: Fixture;
  fake?: Partial<FakeHaOptions>;
  env?: Record<string, string | undefined>;
};

async function query(
  options: Omit<HistoryOptions, "now" | "timeouts"> = {},
  setup: Setup = {},
): Promise<{ response: Response; ha: FakeHa }> {
  const ha = await startFakeHa({
    fixture: setup.fixture ?? SMALL_HOME,
    ...setup.fake,
  });
  cleanups.push(() => ha.close());
  const response = await queryHistory(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...setup.env },
    { ...WINDOW, ...options, now: NOW_MS, timeouts: SHORT },
  );
  return { response, ha };
}

async function failure(
  options: Omit<HistoryOptions, "now" | "timeouts"> = {},
  setup: Setup = {},
): Promise<{ error: ToolError; ha: FakeHa }> {
  const ha = await startFakeHa({
    fixture: setup.fixture ?? SMALL_HOME,
    ...setup.fake,
  });
  cleanups.push(() => ha.close());
  try {
    await queryHistory(
      { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...setup.env },
      { ...WINDOW, ...options, now: NOW_MS, timeouts: SHORT },
    );
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return { error: error as ToolError, ha };
  }
  throw new Error("the call succeeded");
}

const standard = (response: Response): HistoryStandardDocument => {
  const document = JSON.parse(response.document) as HistoryStandardDocument;
  expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  return document;
};

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

describe("ha_history: following changes through a window (User Story 1)", () => {
  it("gives each named entity's start state and every change, in time order (SC-001)", async () => {
    const { response } = await query({
      entities: ["light.porch", "device_tracker.phone"],
    });
    const document = standard(response);
    expect(document.window).toEqual({
      start: "2026-09-28T08:00:00+02:00",
      end: "2026-09-28T10:00:00+02:00",
    });
    expect(document.utc_offset).toBe("+02:00");
    expect(document.selectors).toEqual(["light.porch", "device_tracker.phone"]);
    expect(document.entities).toEqual({
      "device_tracker.phone": {
        start: [
          "home",
          { battery_level: 80, friendly_name: "Phone" },
          "2026-09-28T06:00:00",
        ],
        changes: {
          "2026-09-28": {
            "08:00": [
              ["05:00", null, { battery_level: 79 }],
              ["20:00", "not_home"],
            ],
          },
        },
      },
      "light.porch": {
        start: ["off", { brightness: null, friendly_name: "Porch" }],
        changes: {
          "2026-09-28": {
            "08:00": [
              ["10:00", "on", { brightness: 100 }],
              ["15:00", null, { brightness: 150 }],
              ["30:00", "off", { brightness: null }],
            ],
          },
        },
      },
    });
    expect(Object.keys(document.entities)).toEqual([
      "device_tracker.phone",
      "light.porch",
    ]);
    expect(document.compression_ratio).toBeGreaterThan(0);
    expect(response.notes).toEqual([]);
  });

  it("lists unavailable and unknown states as changes like any other", async () => {
    const { response } = await query({ entities: ["sensor.outdoor"] });
    expect(standard(response).entities["sensor.outdoor"]?.changes).toEqual({
      "2026-09-28": {
        "08:00": [
          ["06:40", "unavailable"],
          ["08:20", "unknown"],
        ],
      },
    });
  });

  it("gives an entity created in the window without a start, changes in the same second in order", async () => {
    const { response } = await query({ entities: ["switch.new"] });
    expect(standard(response).entities["switch.new"]).toEqual({
      changes: {
        "2026-09-28": {
          "08:00": [
            ["16:40", "on", { friendly_name: "New" }],
            ["16:40", "off"],
          ],
        },
      },
    });
  });

  it("lists an unchanged entity named by exact ID with its start state only", async () => {
    const { response } = await query({ entities: ["switch.kettle"] });
    expect(standard(response).entities).toEqual({
      "switch.kettle": { start: ["off", { friendly_name: "Kettle" }] },
    });
    expect(response.notes).toEqual([]);
  });

  it("leaves out an unchanged entity matched by a pattern", async () => {
    const { response } = await query({ entities: ["switch.*"] });
    expect(Object.keys(standard(response).entities)).toEqual(["switch.new"]);
  });

  it("says when no selected entity changed", async () => {
    const { response } = await query({ entities: ["switch.k*"] });
    expect(standard(response).entities).toEqual({});
    expect(response.notes).toEqual([
      "Note: no selected entity changed in the window.",
    ]);
  });

  it("expands patterns against the current entities and sends exact IDs as given", async () => {
    const { response, ha } = await query({
      entities: ["sensor.*", "sensor.gone"],
    });
    expect(ha.receivedHistoryParams[0]?.["entity_ids"]).toEqual([
      "sensor.gone",
      "sensor.outdoor",
    ]);
    expect(Object.keys(standard(response).entities)).toEqual([
      "sensor.gone",
      "sensor.outdoor",
    ]);
  });

  it("considers every current entity without entities", async () => {
    const { response, ha } = await query();
    expect(ha.receivedHistoryParams[0]?.["entity_ids"]).toEqual([
      "device_tracker.phone",
      "light.porch",
      "sensor.outdoor",
      "switch.kettle",
      "switch.new",
    ]);
    const document = standard(response);
    expect(document.selectors).toBeUndefined();
    expect(Object.keys(document.entities)).toEqual([
      "device_tracker.phone",
      "light.porch",
      "sensor.outdoor",
      "switch.new",
    ]);
  });

  it("names an exact ID with no recorded history in a note, not an error", async () => {
    const { response } = await query({
      entities: ["light.porch", "sensor.missing"],
    });
    expect(Object.keys(standard(response).entities)).toEqual(["light.porch"]);
    expect(response.notes).toEqual([
      "Note: no recorded history for the ID sensor.missing.",
    ]);
  });

  it("reads nothing when no entity matches", async () => {
    const { response, ha } = await query({ entities: ["climate.*"] });
    expect(standard(response).entities).toEqual({});
    expect(response.notes).toEqual(["Note: no entity matched the query."]);
    expect(ha.received).not.toContain("history/history_during_period");
  });

  it("keeps only significant changes when asked", async () => {
    const { response, ha } = await query({
      entities: ["light.porch", "device_tracker.phone"],
      significant_only: true,
    });
    expect(ha.receivedHistoryParams[0]?.["significant_changes_only"]).toBe(
      true,
    );
    const document = standard(response);
    expect(document.significant_only).toBe(true);
    expect(document.entities["light.porch"]?.changes).toEqual({
      "2026-09-28": {
        "08:00": [
          ["10:00", "on", { brightness: 100 }],
          ["30:00", "off", { brightness: null }],
        ],
      },
    });
    expect(document.entities["device_tracker.phone"]?.start).toEqual([
      "home",
      { battery_level: 80, friendly_name: "Phone" },
    ]);
  });

  it("reads on one connection, with get_states only to expand, and every flag explicit (FR-015)", async () => {
    const exact = await query({ entities: ["light.porch"] });
    expect(exact.ha.connections).toBe(1);
    expect(exact.ha.received).toEqual([
      "auth/current_user",
      "get_config",
      "history/history_during_period",
    ]);
    expect(exact.ha.receivedHistoryParams).toEqual([
      {
        start_time: iso(W0),
        end_time: iso(W1),
        entity_ids: ["light.porch"],
        include_start_time_state: true,
        significant_changes_only: false,
        no_attributes: false,
      },
    ]);
    const pattern = await query({ entities: ["light.*"] });
    expect(pattern.ha.received).toEqual([
      "auth/current_user",
      "get_config",
      "get_states",
      "history/history_during_period",
    ]);
  });

  it("carries no context (FR-010)", async () => {
    const { response } = await query();
    expect(response.document).not.toContain("context");
  });

  it("gives byte-identical text for the same past window (SC-005)", async () => {
    const first = await query({
      entities: ["light.*", "device_tracker.phone"],
    });
    const second = await query({
      entities: ["light.*", "device_tracker.phone"],
    });
    expect(second.response.document).toBe(first.response.document);
  });
});

describe("ha_history: the window (FR-004)", () => {
  it("defaults to the 24 hours before now", async () => {
    const { ha } = await query({
      entities: ["light.porch"],
      start: undefined,
      end: undefined,
    });
    expect(ha.receivedHistoryParams[0]).toMatchObject({
      start_time: new Date(NOW_MS - 86_400_000).toISOString(),
      end_time: new Date(NOW_MS).toISOString(),
    });
  });

  it("reads an offset-less time in the instance's time zone and clamps a future end", async () => {
    const { ha } = await query({
      entities: ["light.porch"],
      start: "2026-09-28T08:00",
      end: "2026-12-01T00:00",
    });
    expect(ha.receivedHistoryParams[0]).toMatchObject({
      start_time: iso(W0),
      end_time: new Date(NOW_MS).toISOString(),
    });
  });

  it("refuses a start after the end", async () => {
    const { error, ha } = await failure({
      entities: ["light.porch"],
      start: "2026-09-28T10:00",
      end: "2026-09-28T08:00",
    });
    expect(error.kind).toBe("window_invalid");
    expect(ha.received).not.toContain("history/history_during_period");
  });
});

describe("ha_history: errors", () => {
  const kind = async (
    options: Omit<HistoryOptions, "now" | "timeouts">,
    setup: Setup,
  ): Promise<ErrorKind> => (await failure(options, setup)).error.kind;

  it("refuses a user who is not an administrator before reading history", async () => {
    const { error, ha } = await failure(
      { entities: ["light.porch"] },
      { fake: { isAdmin: false } },
    );
    expect(error.message).toBe(
      "The token belongs to a user without administrator privileges. Use a token of an administrator user. Every DomusOps tool requires one, so a result never depends on what a restricted user may read.",
    );
    expect(ha.received).not.toContain("history/history_during_period");
    expect(ha.received).not.toContain("get_states");
  });

  it("says when the history integration is not loaded (FR-014)", async () => {
    const without = historyFixture(SMALL_HISTORY);
    const fixture: Fixture = {
      ...without,
      records: {
        ...without.records,
        config: { ...without.records.config, components: ["recorder"] },
      },
    };
    const { error, ha } = await failure(
      { entities: ["light.porch"] },
      { fixture },
    );
    expect(error.kind).toBe("history_unavailable");
    expect(error.causeText).toBe(
      "The instance does not provide recorded state history",
    );
    expect(ha.received).not.toContain("history/history_during_period");
    expect(
      (
        await failure(
          { entities: ["light.porch"] },
          { fake: { history: false } },
        )
      ).error.causeText,
    ).toBe("The instance does not provide recorded state history");
  });

  it("validates the entities before connecting", async () => {
    const { error, ha } = await failure({ entities: ["Light.Porch"] });
    expect(error.kind).toBe("selector_invalid");
    expect(ha.connections).toBe(0);
  });

  it("gives the existing kinds for connection and protocol failures", async () => {
    expect(
      await kind(
        { entities: ["light.porch"] },
        { env: { DOMUSOPS_HA_URL: undefined } },
      ),
    ).toBe("config_missing");
    expect(
      await kind(
        { entities: ["light.porch"] },
        { env: { DOMUSOPS_HA_TOKEN: "wrong-token" } },
      ),
    ).toBe("auth_invalid");
    expect(
      await kind(
        { entities: ["light.porch"] },
        { fake: { historyDelayMs: 3000 } },
      ),
    ).toBe("timeout");
    expect(
      await kind(
        { entities: ["light.porch"] },
        { fake: { haVersion: "2024.1.0" } },
      ),
    ).toBe("version_unsupported");
    expect(
      await kind(
        { entities: ["light.porch"] },
        { fake: { malformed: "history/history_during_period" } },
      ),
    ).toBe("protocol_error");
  });
});

describe("ha_history: keeping a history within bounds (User Story 2)", () => {
  it("applies exclude after entities, to exact IDs too, and notes it first (FR-003)", async () => {
    const { response, ha } = await query({
      entities: ["switch.*", "light.porch", "sensor.missing"],
      exclude: ["switch.new", "sensor.missing"],
    });
    expect(ha.receivedHistoryParams[0]?.["entity_ids"]).toEqual([
      "light.porch",
      "switch.kettle",
    ]);
    expect(Object.keys(standard(response).entities)).toEqual(["light.porch"]);
    expect(response.notes).toEqual([
      "Note: excluded switch.new, sensor.missing. Counts, the size check and compression_ratio leave them out.",
    ]);
  });

  it("keeps only the named attributes and leaves out the changes they do not show (FR-006)", async () => {
    const { response } = await query({
      entities: ["light.porch", "device_tracker.phone"],
      attributes: [
        "friendly_name",
        "battery_level",
        "friendly_name",
        "nowhere",
      ],
    });
    const document = standard(response);
    expect(document.attributes).toEqual([
      "friendly_name",
      "battery_level",
      "nowhere",
    ]);
    expect(document.entities["light.porch"]).toEqual({
      start: ["off", { friendly_name: "Porch" }],
      changes: {
        "2026-09-28": {
          "08:00": [
            ["10:00", "on"],
            ["30:00", "off"],
          ],
        },
      },
      skipped: 1,
    });
    expect(document.entities["device_tracker.phone"]).toEqual({
      start: [
        "home",
        { battery_level: 80, friendly_name: "Phone" },
        "2026-09-28T06:00:00",
      ],
      changes: {
        "2026-09-28": {
          "08:00": [
            ["05:00", null, { battery_level: 79 }],
            ["20:00", "not_home"],
          ],
        },
      },
    });
  });

  it.each([
    ["an empty list", [], "attributes is empty"],
    [
      "101 entries",
      Array.from({ length: 101 }, (_, i) => `a${i}`),
      "attributes has 101 entries, and the limit is 100",
    ],
    ["an empty entry", [""], "attributes has an empty entry"],
    [
      "an entry of 129 characters",
      ["a".repeat(129)],
      "attributes has an entry of 129 characters, and the limit is 128",
    ],
  ])(
    "refuses attributes with %s before connecting",
    async (_, attributes, problem) => {
      const { error, ha } = await failure({
        entities: ["light.porch"],
        attributes,
      });
      expect(error.kind).toBe("input_invalid");
      expect(error.causeText).toBe(`The input is not valid: ${problem}`);
      expect(error.nextStep).toBe(
        "Give attributes as 1 to 100 entries of 1 to 128 characters, and only with detail=standard",
      );
      expect(ha.connections).toBe(0);
    },
  );

  it("refuses attributes with detail=summary", async () => {
    const { error, ha } = await failure({
      entities: ["light.porch"],
      attributes: ["brightness"],
      detail: "summary",
    });
    expect(error.kind).toBe("input_invalid");
    expect(ha.connections).toBe(0);
  });

  it("reads a window of exactly 10 days and refuses a longer one before reading history (FR-004)", async () => {
    const tenDays = 10 * 86_400_000;
    const read = await query({
      entities: ["light.porch"],
      start: new Date(NOW_MS - tenDays).toISOString(),
      end: new Date(NOW_MS).toISOString(),
    });
    expect(read.ha.received).toContain("history/history_during_period");
    const { error, ha } = await failure({
      entities: ["light.porch"],
      start: new Date(NOW_MS - tenDays - 1000).toISOString(),
      end: new Date(NOW_MS).toISOString(),
    });
    expect(error.message).toBe(
      "The time window is not valid: it is longer than 10 days. Use a window of at most 10 days; read a longer period in several calls.",
    );
    expect(ha.received).not.toContain("history/history_during_period");
  });

  it("refuses a standard result above the limit with the counts, never in part (FR-011, SC-003)", async () => {
    const { error } = await failure(
      { entities: ["light.porch", "device_tracker.phone"] },
      { env: { DOMUSOPS_HISTORY_MAX_BYTES: "200" } },
    );
    expect(error.kind).toBe("too_large");
    expect(error.causeText).toMatch(
      /^The result has 2 entities and 5 changes and would be \d+ bytes, above the limit of 200 bytes$/,
    );
    expect(error.message).not.toContain("light.porch");
    expect(error.nextStep).toContain("DOMUSOPS_HISTORY_MAX_BYTES");
  });
});

describe("ha_history: the summary (User Story 3, FR-013)", () => {
  const summary = (response: Response): HistorySummaryDocument => {
    const document = JSON.parse(response.document) as HistorySummaryDocument;
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    return document;
  };

  it("counts per entity and per domain what the standard result lists", async () => {
    const big = { env: { DOMUSOPS_HISTORY_MAX_BYTES: "100000000" } };
    const { start, end } = REFERENCE_HISTORY.window;
    const window = {
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
    };
    const counted = summary(
      (
        await query(
          { ...window, entities: ["*"], detail: "summary" },
          { ...big, fixture: REFERENCE_HISTORY },
        )
      ).response,
    );
    const listed = standard(
      (
        await query(
          { ...window, entities: ["*"] },
          { ...big, fixture: REFERENCE_HISTORY },
        )
      ).response,
    );
    const rows = Object.fromEntries(
      Object.entries(listed.entities)
        .filter(([, entry]) => entry.changes !== undefined)
        .map(([id, entry]) => {
          const all = Object.values(entry.changes ?? {}).flatMap((hours) =>
            Object.values(hours).flat(),
          );
          const states = all.filter(
            (row) => row[1] !== null && row[1] !== undefined,
          ).length;
          return [id, [all.length, states, all.length - states]];
        }),
    );
    expect(counted.by_entity).toEqual(rows);
    const totals = Object.values(rows).reduce(
      (sum, [changes, states, attributes]) => ({
        entities: sum.entities + 1,
        changes: sum.changes + (changes as number),
        state_changes: sum.state_changes + (states as number),
        attribute_only: sum.attribute_only + (attributes as number),
      }),
      { entities: 0, changes: 0, state_changes: 0, attribute_only: 0 },
    );
    expect(counted.counts).toEqual(totals);
    expect(Object.keys(counted.by_domain)).toEqual([
      "binary_sensor",
      "device_tracker",
      "light",
      "sensor",
      "switch",
    ]);
    for (const [
      domain,
      [entities, changes, states, attributes],
    ] of Object.entries(counted.by_domain)) {
      const mine = Object.entries(rows).filter(([id]) =>
        id.startsWith(`${domain}.`),
      );
      expect(entities).toBe(mine.length);
      expect(changes).toBe(states + attributes);
      expect(changes).toBe(
        mine.reduce((sum, [, row]) => sum + (row[0] as number), 0),
      );
    }
  });

  it("reads without attributes and counts a created entity's first change as a state change", async () => {
    const { response, ha } = await query({
      entities: ["light.porch", "switch.new", "switch.kettle"],
      detail: "summary",
    });
    expect(ha.receivedHistoryParams[0]?.["no_attributes"]).toBe(true);
    const document = summary(response);
    expect(document.by_entity).toEqual({
      "light.porch": [3, 2, 1],
      "switch.new": [2, 2, 0],
    });
    expect(document.by_domain).toEqual({
      light: [1, 3, 2, 1],
      switch: [1, 2, 2, 0],
    });
    expect(document.counts).toEqual({
      entities: 2,
      changes: 5,
      state_changes: 4,
      attribute_only: 1,
    });
  });

  it("gives no rows per entity without entities, stays under 4,000 bytes and is never refused", async () => {
    const many = historyFixture(
      Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `domain_number_${String(i).padStart(3, "0")}.thing`,
          timeline([
            [-60, "off", {}],
            [60, "on", {}],
          ]),
        ]),
      ),
    );
    const { response } = await query(
      { detail: "summary" },
      { fixture: many, env: { DOMUSOPS_HISTORY_MAX_BYTES: "1" } },
    );
    const document = summary(response);
    expect(document.by_entity).toBeUndefined();
    expect(Object.keys(document.by_domain)).toHaveLength(100);
    expect(byteLength(response.document)).toBeLessThan(4_000);
  });

  it("refuses rows per entity above the limit with the summary's remediation", async () => {
    const { error } = await failure(
      { entities: ["light.porch", "device_tracker.phone"], detail: "summary" },
      { env: { DOMUSOPS_HISTORY_MAX_BYTES: "100" } },
    );
    expect(error.kind).toBe("too_large");
    expect(error.nextStep).toBe(
      "Leave out entities to get the counts per domain, or narrow the query with fewer entities or exclude; to allow larger results, raise DOMUSOPS_HISTORY_MAX_BYTES",
    );
  });

  it("narrows with exclude and significant_only as standard does", async () => {
    const narrowed = summary(
      (
        await query({
          entities: ["light.*", "device_tracker.*"],
          exclude: ["device_tracker.*"],
          significant_only: true,
          detail: "summary",
        })
      ).response,
    );
    expect(narrowed.by_entity).toEqual({ "light.porch": [2, 2, 0] });
    expect(narrowed.significant_only).toBe(true);
  });

  it("gives zero counts and the note when nothing matches, and no decoder applies", async () => {
    const { response } = await query({
      entities: ["climate.*"],
      detail: "summary",
    });
    const document = summary(response);
    expect(document.counts).toEqual({
      entities: 0,
      changes: 0,
      state_changes: 0,
      attribute_only: 0,
    });
    expect(document.by_domain).toEqual({});
    expect(response.notes).toEqual(["Note: no entity matched the query."]);
    expect(() =>
      expandHistory(document as unknown as HistoryStandardDocument),
    ).toThrow(/detail=standard/);
  });
});

describe("ha_history: review fixes of PR #39", () => {
  /** A sensor with `force_update`: the same value again is a state change on the instance. */
  const FORCED = historyFixture({
    "sensor.forced": [
      { s: "21.5", a: { unit: "C" }, lu: W0 - 60, lc: W0 - 60 },
      { s: "21.5", a: { unit: "C" }, lu: W0 + 60.5, lc: W0 + 60.5 },
      { s: "21.5", a: { unit: "F" }, lu: W0 + 120.5, lc: W0 + 60.5 },
    ],
  });

  it("lists a forced update to the same state as a state change", async () => {
    const { response } = await query(
      { entities: ["sensor.forced"] },
      { fixture: FORCED },
    );
    const document = standard(response);
    expect(document.entities["sensor.forced"]?.changes).toEqual({
      "2026-09-28": {
        "08:00": [
          ["01:00", "21.5"],
          ["02:00", null, { unit: "F" }],
        ],
      },
    });
    const [, forced, after] = expandHistory(document)[0]?.entries ?? [];
    expect(forced?.last_changed).toBe("2026-09-28T08:01:00+02:00");
    expect(after?.last_changed).toBe("2026-09-28T08:01:00+02:00");
  });

  it("keeps a forced update with attributes and counts it as a state change in the summary", async () => {
    const filtered = await query(
      { entities: ["sensor.forced"], attributes: ["unit"] },
      { fixture: FORCED },
    );
    expect(standard(filtered.response).entities["sensor.forced"]).toMatchObject(
      {
        changes: {
          "2026-09-28": {
            "08:00": [
              ["01:00", "21.5"],
              ["02:00", null, { unit: "F" }],
            ],
          },
        },
      },
    );
    const counted = await query(
      { entities: ["sensor.forced"], detail: "summary" },
      { fixture: FORCED },
    );
    expect(
      (JSON.parse(counted.response.document) as HistorySummaryDocument)
        .by_entity,
    ).toEqual({ "sensor.forced": [2, 1, 1] });
  });

  it("never sends an ID the instance would refuse, and notes it instead", async () => {
    const invalid = ["light", "sensor.foo_", "sensor.a__b", "a.b.c"];
    const { response, ha } = await query({
      entities: ["light.porch", ...invalid],
    });
    expect(ha.receivedHistoryParams[0]?.["entity_ids"]).toEqual([
      "light.porch",
    ]);
    expect(Object.keys(standard(response).entities)).toEqual(["light.porch"]);
    expect(response.notes).toEqual([
      `Note: no recorded history for the ID ${invalid.join(", ")}.`,
    ]);
  });

  it("notes an invalid ID when it is the only one, without reading history", async () => {
    const { response, ha } = await query({ entities: ["light"] });
    expect(ha.received).not.toContain("history/history_during_period");
    expect(response.notes).toEqual([
      "Note: no recorded history for the ID light.",
      "Note: no entity matched the query.",
    ]);
  });

  it("gives an empty by_entity when entities match nothing in a summary", async () => {
    const { response } = await query({
      entities: ["climate.*"],
      detail: "summary",
    });
    expect(
      (JSON.parse(response.document) as HistorySummaryDocument).by_entity,
    ).toEqual({});
  });

  it("allows 10 local days across a daylight-saving change, and refuses one second more", async () => {
    // 2026-10-25: 03:00 CEST becomes 02:00 CET in Europe/Madrid, so these 10 local days last
    // 10 days and 1 hour.
    const ha = await startFakeHa({ fixture: SMALL_HOME });
    cleanups.push(() => ha.close());
    const env = { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN };
    const now = Date.UTC(2026, 10, 1);
    await queryHistory(env, {
      entities: ["light.porch"],
      start: "2026-10-20T00:00",
      end: "2026-10-30T00:00",
      now,
      timeouts: SHORT,
    });
    expect(ha.received).toContain("history/history_during_period");
    await expect(
      queryHistory(env, {
        entities: ["light.porch"],
        start: "2026-10-20T00:00",
        end: "2026-10-30T00:00:01",
        now,
        timeouts: SHORT,
      }),
    ).rejects.toMatchObject({ kind: "window_invalid" });
  });
});
