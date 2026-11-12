import {
  expandState,
  stateJsonSchema,
  type StateStandardDocument,
  type StateSummaryDocument,
} from "@domusops/schema";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError, type ErrorKind } from "../src/errors.js";
import type { Timeouts } from "../src/ha/client.js";
import { queryState, type StateOptions } from "../src/tools/ha-state.js";
import type { Response } from "../src/notes.js";
import type { Fixture } from "./fixtures/generate.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";
import { BASE_MS, fixtureOf, SMALL_HOME, stateOf } from "./support/states.js";

/** The `ha_state` tool on a simulated instance (specs/010-ha-state, quickstart §2). */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  stateJsonSchema,
);

const SHORT: Partial<Timeouts> = {
  connectMs: 300,
  commandMs: 300,
  totalMs: 1500,
};

const HOME = fixtureOf(SMALL_HOME);

async function query(
  options: Omit<StateOptions, "now" | "timeouts"> = {},
  setup: {
    fixture?: Fixture;
    fake?: Partial<FakeHaOptions>;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<{ response: Response; ha: FakeHa }> {
  const ha = await startFakeHa({
    fixture: setup.fixture ?? HOME,
    ...setup.fake,
  });
  cleanups.push(() => ha.close());
  const response = await queryState(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...setup.env },
    { ...options, now: BASE_MS, timeouts: SHORT },
  );
  return { response, ha };
}

async function failure(
  options: Omit<StateOptions, "now" | "timeouts"> = {},
  setup: Parameters<typeof query>[1] = {},
): Promise<{ error: ToolError; ha: FakeHa | null }> {
  const ha = await startFakeHa({
    fixture: setup.fixture ?? HOME,
    ...setup.fake,
  });
  cleanups.push(() => ha.close());
  try {
    await queryState(
      { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...setup.env },
      { ...options, now: BASE_MS, timeouts: SHORT },
    );
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return { error: error as ToolError, ha };
  }
  throw new Error("the call succeeded");
}

const standard = (response: Response): StateStandardDocument => {
  const document = JSON.parse(response.document) as StateStandardDocument;
  expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  return document;
};

const idsOf = (response: Response): string[] =>
  expandState(standard(response)).map((record) => record.entity_id);

describe("ha_state: reading chosen entities (User Story 1)", () => {
  it("returns every light with its state, attributes, times and context, in entity-ID order", async () => {
    const { response } = await query({ entities: ["light.*"] });
    const records = expandState(standard(response));
    expect(records.map((r) => r.entity_id)).toEqual([
      "light.desk",
      "light.hallway",
      "light.kitchen",
      "light.porch",
    ]);
    const source = SMALL_HOME.find((s) => s.entity_id === "light.kitchen")!;
    const kitchen = records.find((r) => r.entity_id === "light.kitchen")!;
    expect(kitchen).toEqual({
      entity_id: "light.kitchen",
      state: "on",
      attributes: { brightness: 255, friendly_name: "Kitchen" },
      last_changed: "2026-09-28T21:00:00+02:00",
      last_updated: "2026-09-28T21:00:00+02:00",
      last_reported: "2026-09-28T21:00:00+02:00",
      context: source.context,
    });
    expect(response.notes).toEqual([]);
  });

  it("combines exact IDs and patterns", async () => {
    const { response } = await query({
      entities: ["light.kitchen", "switch.*"],
    });
    expect(idsOf(response)).toEqual([
      "light.kitchen",
      "switch.fan",
      "switch.kettle",
    ]);
  });

  it("selects every entity without entities", async () => {
    const { response } = await query();
    expect(idsOf(response)).toHaveLength(SMALL_HOME.length);
  });

  it("applies exclude after entities and notes it first", async () => {
    const { response } = await query({
      entities: ["light.*", "light.missing"],
      exclude: ["light.desk", "light.hallway"],
    });
    expect(idsOf(response)).toEqual(["light.kitchen", "light.porch"]);
    expect(response.notes).toEqual([
      "Note: excluded light.desk, light.hallway. Counts, the size check and compression_ratio leave them out.",
      "Note: no entity has the ID light.missing.",
    ]);
  });

  it("does not report an exact ID that is itself excluded", async () => {
    const { response } = await query({
      entities: ["light.missing", "light.kitchen"],
      exclude: ["light.missing"],
    });
    expect(response.notes).toHaveLength(1);
    expect(response.notes[0]).toMatch(/^Note: excluded/);
  });

  it("gives a valid empty document and the notes when nothing is selected", async () => {
    const { response } = await query({
      entities: ["light.missing", "climate.*"],
    });
    const document = standard(response);
    expect(document.entities).toEqual({});
    expect(document.templates).toEqual({});
    expect(document.anchor).toBe("2026-09-28T21:00:00+02:00");
    expect(response.notes).toEqual([
      "Note: no entity has the ID light.missing.",
      "Note: no entity matched the query.",
    ]);
  });

  it("reads the user, the config and the states on one connection, and nothing else (FR-016)", async () => {
    const { ha } = await query({ entities: ["light.*"] });
    expect(ha.connections).toBe(1);
    expect(ha.received).toEqual([
      "auth/current_user",
      "get_config",
      "get_states",
    ]);
  });

  it("gives byte-identical text on two calls (SC-006)", async () => {
    const first = await query({ entities: ["sensor.*", "light.*"] });
    const second = await query({ entities: ["sensor.*", "light.*"] });
    expect(second.response.document).toBe(first.response.document);
  });

  it("echoes the selectors as parsed", async () => {
    const { response } = await query({
      entities: ["light.*", "light.*", "switch.fan"],
    });
    expect(standard(response).selectors).toEqual(["light.*", "switch.fan"]);
  });
});

describe("ha_state: errors", () => {
  const expectKind = (error: ToolError, kind: ErrorKind): void => {
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain(FAKE_TOKEN);
  };

  it("refuses a user who is not an administrator before reading states (R1)", async () => {
    const { error, ha } = await failure({}, { fake: { isAdmin: false } });
    expectKind(error, "not_admin");
    expect(error.nextStep).toContain("silently incomplete");
    expect(ha?.received).toEqual(["auth/current_user"]);
  });

  it.each([
    [{ entities: [] }],
    [{ entities: ["Light.Kitchen"] }],
    [{ exclude: ["light kitchen"] }],
  ])("refuses invalid selectors %j without connecting", async (options) => {
    const { error, ha } = await failure(options);
    expectKind(error, "selector_invalid");
    expect(ha?.connections).toBe(0);
  });

  it("reports a missing address without connecting", async () => {
    const { error, ha } = await failure(
      {},
      { env: { DOMUSOPS_HA_URL: undefined } },
    );
    expectKind(error, "config_missing");
    expect(ha?.connections).toBe(0);
  });

  it("reports a refused token", async () => {
    const { error } = await failure(
      {},
      { env: { DOMUSOPS_HA_TOKEN: "wrong" } },
    );
    expectKind(error, "auth_invalid");
  });

  it("reports an unreachable instance", async () => {
    const { error } = await failure(
      {},
      { env: { DOMUSOPS_HA_URL: "http://127.0.0.1:9" } },
    );
    expectKind(error, "unreachable");
  });

  it("reports an instance that never answers get_states", async () => {
    const { error } = await failure({}, { fake: { stall: "get_states" } });
    expectKind(error, "timeout");
  });

  it("refuses an instance below the minimum version, before reading states", async () => {
    const { error, ha } = await failure(
      {},
      { fake: { haVersion: "2024.12.4" } },
    );
    expectKind(error, "version_unsupported");
    expect(ha?.received).not.toContain("get_states");
  });

  it.each([
    ["a state that is not a string", { ...stateOf("light.a", "on"), state: 5 }],
    [
      "a state without last_reported",
      Object.fromEntries(
        Object.entries(stateOf("light.a", "on")).filter(
          ([key]) => key !== "last_reported",
        ),
      ),
    ],
    [
      "a state without a context",
      { ...stateOf("light.a", "on"), context: null },
    ],
  ])("reports %s as a protocol error and gives no document", async (_, bad) => {
    const { error } = await failure(
      {},
      { fixture: fixtureOf([...SMALL_HOME, bad]) },
    );
    expectKind(error, "protocol_error");
  });
});

describe("ha_state: narrowing (User Story 2)", () => {
  it("keeps only the domains given", async () => {
    const { response } = await query({ domain: ["switch", "update"] });
    expect(idsOf(response)).toEqual([
      "switch.fan",
      "switch.kettle",
      "update.hub_firmware",
    ]);
  });

  it("keeps only the states given, compared exactly", async () => {
    const { response } = await query({ state: ["unavailable", "unknown"] });
    expect(idsOf(response)).toEqual([
      "light.hallway",
      "sensor.indoor_temperature",
    ]);
    const exact = await query({ state: ["Unavailable"] });
    expect(idsOf(exact.response)).toEqual([]);
  });

  it("combines entities, domain, state and exclude in that order (R2)", async () => {
    const { response } = await query({
      entities: ["*_temperature", "light.*", "switch.kettle"],
      domain: ["light", "sensor"],
      state: ["on", "14.2", "unknown"],
      exclude: ["light.porch"],
    });
    expect(idsOf(response)).toEqual([
      "light.kitchen",
      "sensor.indoor_temperature",
      "sensor.outdoor_temperature",
    ]);
  });

  it("gives an empty document, not an error, for a domain and a pattern that cannot meet", async () => {
    const { response } = await query({
      domain: ["light"],
      entities: ["switch.*"],
    });
    expect(standard(response).entities).toEqual({});
    expect(response.notes).toEqual(["Note: no entity matched the query."]);
  });

  it("trims attributes without changing the selection (FR-006)", async () => {
    const { response } = await query({
      entities: ["light.*"],
      attributes: ["brightness", "no_such_attribute"],
    });
    const records = expandState(standard(response));
    expect(records.map((r) => r.entity_id)).toEqual([
      "light.desk",
      "light.hallway",
      "light.kitchen",
      "light.porch",
    ]);
    expect(records.map((r) => r.attributes)).toEqual([
      { brightness: null },
      {},
      { brightness: 255 },
      { brightness: 90 },
    ]);
  });

  it("echoes domain, state and attributes as parsed, without duplicates", async () => {
    const { response } = await query({
      domain: ["light", "light"],
      state: ["on", "off", "on"],
      attributes: ["friendly_name", "friendly_name"],
    });
    expect(standard(response)).toMatchObject({
      domains: ["light"],
      states: ["on", "off"],
      attributes: ["friendly_name"],
    });
  });

  const long = (n: number): string => "a".repeat(n);
  const many = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `v${i}`);

  it.each([
    ["an empty domain list", { domain: [] }],
    ["over 100 domains", { domain: many(101) }],
    ["a domain over 64 characters", { domain: [long(65)] }],
    ["a domain with a capital", { domain: ["Light"] }],
    ["a domain with a dot", { domain: ["light.kitchen"] }],
    ["an empty state list", { state: [] }],
    ["over 100 states", { state: many(101) }],
    ["an empty state", { state: [""] }],
    ["a state over 255 characters", { state: [long(256)] }],
    ["an empty attributes list", { attributes: [] }],
    ["over 100 attributes", { attributes: many(101) }],
    ["an empty attribute name", { attributes: [""] }],
    ["an attribute over 128 characters", { attributes: [long(129)] }],
    [
      "attributes with summary",
      { attributes: ["brightness"], detail: "summary" as const },
    ],
  ])("refuses %s without connecting", async (_, options) => {
    const { error, ha } = await failure(options);
    expect(error.kind).toBe("input_invalid");
    expect(ha?.connections).toBe(0);
  });

  it("accepts the longest valid entries", async () => {
    const { response } = await query({
      domain: [long(64)],
      state: [long(255)],
      attributes: [long(128)],
    });
    expect(standard(response).entities).toEqual({});
  });

  it("refuses a standard result above the limit with the entity count and no entity (SC-004)", async () => {
    const { error } = await failure(
      { entities: ["light.*"] },
      { env: { DOMUSOPS_STATE_MAX_BYTES: "300" } },
    );
    expect(error.kind).toBe("too_large");
    expect(error.causeText).toMatch(
      /^The result has 4 entities and would be \d+ bytes, above the limit of 300 bytes$/,
    );
    expect(error.nextStep).toContain("detail=summary");
    expect(error.nextStep).toContain("DOMUSOPS_STATE_MAX_BYTES");
    expect(error.message).not.toContain("light.");
  });

  it("never refuses a summary for its size (FR-012)", async () => {
    const { response } = await query(
      { entities: ["light.*"], detail: "summary" },
      { env: { DOMUSOPS_STATE_MAX_BYTES: "1" } },
    );
    expect(JSON.parse(response.document)).toMatchObject({ detail: "summary" });
  });
});

describe("ha_state: the summary (User Story 3)", () => {
  const summary = (response: Response): StateSummaryDocument => {
    const document = JSON.parse(response.document) as StateSummaryDocument;
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    return document;
  };

  it("counts entities, unavailable and unknown per domain", async () => {
    const { response } = await query({ detail: "summary" });
    const document = summary(response);
    expect(document.counts).toEqual({ entities: 9, domains: 4 });
    expect(document.by_domain).toEqual({
      light: [4, 1, 0],
      sensor: [2, 0, 1],
      switch: [2, 0, 0],
      update: [1, 0, 0],
    });
    expect(Object.keys(document.by_domain)).toEqual([
      "light",
      "sensor",
      "switch",
      "update",
    ]);
  });

  it("counts only the entities the filters select (FR-015)", async () => {
    const { response } = await query({
      detail: "summary",
      entities: ["light.*", "sensor.*"],
      state: ["on", "unknown"],
      exclude: ["light.porch"],
    });
    expect(summary(response).by_domain).toEqual({
      light: [1, 0, 0],
      sensor: [1, 0, 1],
    });
  });

  it("gives zero counts and the note when nothing is selected", async () => {
    const { response } = await query({
      detail: "summary",
      domain: ["climate"],
    });
    const document = summary(response);
    expect(document.counts).toEqual({ entities: 0, domains: 0 });
    expect(document.by_domain).toEqual({});
    expect(response.notes).toEqual(["Note: no entity matched the query."]);
  });
});
