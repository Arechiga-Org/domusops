import {
  expandSystemLog,
  REDACTION_MARKER,
  systemLogJsonSchema,
  type SystemLogStandardDocument,
  type SystemLogSummaryDocument,
} from "@domusops/schema";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError, type ErrorKind } from "../src/errors.js";
import type { Timeouts } from "../src/ha/client.js";
import type { Response } from "../src/notes.js";
import { queryState } from "../src/tools/ha-state.js";
import {
  querySystemLog,
  type SystemLogOptions,
} from "../src/tools/ha-system-log.js";
import {
  LOG_NOW_MS,
  REFERENCE_SYSTEM_LOG,
  systemLogFixture,
} from "./fixtures/generate-system-log.js";
import type { Fixture } from "./fixtures/generate.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";
import {
  ACME_TRACEBACK,
  entry,
  MQTT_TRACEBACK,
  NOW_MS,
  SMALL_HOME,
  SMALL_LOG,
} from "./support/system-log.js";

/** The `ha_system_log` tool on a simulated instance (specs/012-ha-system-log, quickstart §2). */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  systemLogJsonSchema,
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
  now?: number;
};

const envOf = (ha: FakeHa, setup: Setup) => ({
  DOMUSOPS_HA_URL: ha.url,
  DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
  ...setup.env,
});

async function fake(setup: Setup): Promise<FakeHa> {
  const ha = await startFakeHa({
    fixture: setup.fixture ?? SMALL_HOME,
    ...setup.fake,
  });
  cleanups.push(() => ha.close());
  return ha;
}

async function query(
  options: Omit<SystemLogOptions, "now" | "timeouts"> = {},
  setup: Setup = {},
): Promise<{ response: Response; ha: FakeHa }> {
  const ha = await fake(setup);
  const response = await querySystemLog(envOf(ha, setup), {
    ...options,
    now: setup.now ?? NOW_MS,
    timeouts: SHORT,
  });
  return { response, ha };
}

async function failure(
  options: Omit<SystemLogOptions, "now" | "timeouts"> = {},
  setup: Setup = {},
): Promise<{ error: ToolError; ha: FakeHa }> {
  const ha = await fake(setup);
  try {
    await querySystemLog(envOf(ha, setup), {
      ...options,
      now: setup.now ?? NOW_MS,
      timeouts: SHORT,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return { error: error as ToolError, ha };
  }
  throw new Error("the call succeeded");
}

const kind = async (
  options: Omit<SystemLogOptions, "now" | "timeouts">,
  setup: Setup = {},
): Promise<ErrorKind> => (await failure(options, setup)).error.kind;

const standard = (response: Response): SystemLogStandardDocument => {
  const document = JSON.parse(response.document) as SystemLogStandardDocument;
  expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  expect(document.detail).toBe("standard");
  return document;
};

const summary = (response: Response): SystemLogSummaryDocument => {
  const document = JSON.parse(response.document) as SystemLogSummaryDocument;
  expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  expect(document.detail).toBe("summary");
  return document;
};

const loggers = (document: SystemLogStandardDocument): string[] =>
  expandSystemLog(document).map((record) => record.logger);

const withComponents = (components: string[]): Fixture => ({
  ...SMALL_HOME,
  records: {
    ...SMALL_HOME.records,
    config: { ...SMALL_HOME.records.config, components },
  },
});

describe("ha_system_log: reading the errors of an integration (User Story 1)", () => {
  it("lists every entry, oldest last occurrence first, ties by logger then source (FR-007)", async () => {
    const { response } = await query();
    const document = standard(response);
    expect(Object.keys(document.entries)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(
      expandSystemLog(document).map((r) => `${r.logger} ${r.source.file}`),
    ).toEqual([
      "homeassistant.components.sun components/sun/entity.py",
      "homeassistant.components.recorder.core components/recorder/core.py",
      "py.warnings components/hue/light.py",
      "homeassistant.core core.py",
      "pyhueplus.api custom_components/hue_plus/sensor.py",
      "homeassistant.components.cast components/cast/media_player.py",
      "homeassistant.components.zha components/zha/__init__.py",
      "homeassistant.components.zha components/zha/core.py",
      "homeassistant.components.mqtt.client components/mqtt/client.py",
      "custom_components.acme_cloud custom_components/acme_cloud/api.py",
      "pyacme.client custom_components/acme_cloud/__init__.py",
      "homeassistant.helpers.event helpers/template/__init__.py",
    ]);
    expect(response.notes).toEqual([]);
  });

  it("gives each entry every field the instance records, grouped once with its count (FR-002, SC-001)", async () => {
    const { response } = await query({ integrations: ["mqtt"] });
    const document = standard(response);
    expect(document.integrations).toEqual(["mqtt"]);
    expect(expandSystemLog(document)).toEqual([
      {
        level: "error",
        logger: "homeassistant.components.mqtt.client",
        integration: "mqtt",
        integration_from: "logger",
        custom: false,
        source: { file: "components/mqtt/client.py", line: 612 },
        count: 3,
        first_occurred: "2026-11-13T08:02:11+01:00",
        last_occurred: "2026-11-13T09:15:40+01:00",
        messages: [
          "Failed to connect to MQTT server due to exception: [Errno 111] Connection refused",
        ],
        traceback: MQTT_TRACEBACK.replace(
          "/usr/src/homeassistant/homeassistant/",
          "{ha}/",
        ).replace("/usr/local/lib/python3.14/", "{python}/"),
      },
    ]);
    expect(document.entries).toEqual({
      "2026-11-13": [
        [
          "09:15:40",
          "error",
          "homeassistant.components.mqtt.client",
          "mqtt",
          [0, 612],
          3,
          [
            "Failed to connect to MQTT server due to exception: [Errno 111] Connection refused",
          ],
          "08:02:11",
          // The header is used once in this document, so it stays inline; frames are parts.
          [
            "Traceback (most recent call last):",
            0,
            1,
            "ConnectionRefusedError: [Errno 111] Connection refused",
          ],
        ],
      ],
    });
  });

  it("names the integration from the logger, or from the source path for a library, and marks custom ones (FR-003)", async () => {
    const { response } = await query();
    const document = standard(response);
    expect(document.custom).toEqual(["acme_cloud", "hue_plus"]);
    expect(
      expandSystemLog(document).map((r) => [
        r.logger,
        r.integration,
        r.integration_from,
        r.custom,
      ]),
    ).toEqual([
      ["homeassistant.components.sun", "sun", "logger", false],
      ["homeassistant.components.recorder.core", "recorder", "logger", false],
      ["py.warnings", "hue", "source", false],
      ["homeassistant.core", null, null, false],
      // The source begins with custom_components/hue_plus/: never the built-in hue.
      ["pyhueplus.api", "hue_plus", "source", true],
      ["homeassistant.components.cast", "cast", "logger", false],
      ["homeassistant.components.zha", "zha", "logger", false],
      ["homeassistant.components.zha", "zha", "logger", false],
      ["homeassistant.components.mqtt.client", "mqtt", "logger", false],
      ["custom_components.acme_cloud", "acme_cloud", "logger", true],
      ["pyacme.client", "acme_cloud", "source", true],
      ["homeassistant.helpers.event", null, null, false],
    ]);
  });

  it.each([
    [["mqtt"], ["homeassistant.components.mqtt.client"]],
    [["acme*"], ["custom_components.acme_cloud", "pyacme.client"]],
    [["hue*"], ["py.warnings", "pyhueplus.api"]],
    [["hue_plus"], ["pyhueplus.api"]],
    [
      ["*_cloud", "cast"],
      [
        "homeassistant.components.cast",
        "custom_components.acme_cloud",
        "pyacme.client",
      ],
    ],
  ])(
    "keeps the entries of %j, and none without an integration (FR-004)",
    async (integrations, expected) => {
      const { response } = await query({ integrations });
      expect(loggers(standard(response))).toEqual(expected);
    },
  );

  it("redacts messages and tracebacks and re-roots their paths (FR-009)", async () => {
    const { response } = await query({ integrations: ["acme_cloud", "hue"] });
    const records = expandSystemLog(standard(response));
    expect(records[0]?.messages).toEqual([
      "{ha}/components/hue/light.py:77: DeprecationWarning: the brightness attribute is deprecated",
    ]);
    const acme = records.find(
      (r) => r.logger === "custom_components.acme_cloud",
    );
    expect(acme?.messages).toEqual([
      `Update failed for user ${REDACTION_MARKER}`,
    ]);
    expect(acme?.traceback).toBe(
      ACME_TRACEBACK.replaceAll("/config/", "{config}/"),
    );
    expect(response.document).not.toContain("someone@example.com");
    expect(response.document).not.toContain("/usr/src/");
  });

  it("gives every time in the instance's time zone (US1 scenario 5, FR-008)", async () => {
    const { response } = await query({ integrations: ["recorder", "sun"] });
    const document = standard(response);
    expect(document.time_zone).toBe("Europe/Madrid");
    expect(document.utc_offset).toBe("+01:00");
    expect(document.entries["2026-11-12"]?.[0]?.[0]).toBe("22:00:00");
    expect(document.entries).toMatchObject({
      "2026-11-13": [
        [
          "06:50:00",
          "critical",
          "homeassistant.components.recorder.core",
          "recorder",
          [1, 917],
          2,
          ["The recorder could not start, check the database connection"],
          "2026-11-12T23:50:00",
        ],
      ],
    });
  });

  it("gives a time with its own offset across a daylight-saving change", async () => {
    const summer = entry({
      name: "homeassistant.components.met",
      source: ["components/met/weather.py", 10],
      last: "2026-10-24T22:00:00",
    });
    const { response } = await query(
      {},
      { fixture: systemLogFixture([summer]) },
    );
    // 2026-10-24T22:00:00+01:00 is 23:00 summer time, +02:00.
    const document = standard(response);
    expect(document.entries["2026-10-24"]?.[0]?.[0]).toBe("23:00:00+02:00");
    expect(expandSystemLog(document)[0]?.last_occurred).toBe(
      "2026-10-24T23:00:00+02:00",
    );
  });

  it("returns a message of several kilobytes whole (Edge Cases)", async () => {
    const long = `Unexpected reply: ${"0123456789abcdef".repeat(400)}`;
    const { response } = await query(
      {},
      {
        fixture: systemLogFixture([
          entry({
            name: "custom_components.acme_cloud",
            source: ["custom_components/acme_cloud/api.py", 9],
            last: "2026-11-13T09:00:00",
            message: [long],
          }),
        ]),
      },
    );
    expect(expandSystemLog(standard(response))[0]?.messages).toEqual([long]);
  });

  it("gives an empty document and a note for an empty log, and another when nothing matched (FR-011)", async () => {
    const empty = await query({}, { fixture: systemLogFixture([]) });
    expect(standard(empty.response)).toMatchObject({
      files: [],
      parts: [],
      entries: {},
    });
    expect(empty.response.notes).toEqual(["Note: the system log is empty."]);
    const none = await query({ integrations: ["zwave_js"] });
    expect(standard(none.response).entries).toEqual({});
    expect(none.response.notes).toEqual([
      "Note: no log entry matched the query.",
    ]);
  });

  it("reads only the user, the core config and the system log, on one connection (FR-014)", async () => {
    const { ha } = await query({ integrations: ["mqtt"] });
    expect(ha.connections).toBe(1);
    expect(ha.received).toEqual([
      "auth/current_user",
      "get_config",
      "system_log/list",
    ]);
  });

  it("gives byte-identical text on two calls with nothing recorded in between (SC-005)", async () => {
    const first = await query();
    const second = await query();
    expect(second.response.document).toBe(first.response.document);
  });

  it("refuses a user who is not an administrator before reading the log", async () => {
    const { error, ha } = await failure({}, { fake: { isAdmin: false } });
    expect(error.kind).toBe("not_admin");
    expect(error.message).toContain("Every DomusOps tool requires one");
    expect(ha.received).not.toContain("system_log/list");
  });

  it("says when the system log integration is not loaded or the command is unknown (FR-013)", async () => {
    const missing = await failure(
      {},
      { fixture: withComponents(["logger", "http"]) },
    );
    expect(missing.error.kind).toBe("system_log_unavailable");
    expect(missing.ha.received).not.toContain("system_log/list");
    expect(await kind({}, { fake: { systemLog: false } })).toBe(
      "system_log_unavailable",
    );
  });

  it("refuses a core config without a configuration directory, while ha_state still answers (research R2)", async () => {
    const config = Object.fromEntries(
      Object.entries(SMALL_HOME.records.config).filter(
        ([key]) => key !== "config_dir",
      ),
    ) as Fixture["records"]["config"];
    const fixture: Fixture = {
      ...SMALL_HOME,
      records: { ...SMALL_HOME.records, config },
    };
    const { error, ha } = await failure({}, { fixture });
    expect(error.kind).toBe("protocol_error");
    expect(ha.received).not.toContain("system_log/list");
    const state = await queryState(envOf(ha, {}), { timeouts: SHORT });
    expect(JSON.parse(state.document)).toMatchObject({
      format: "domusops.state/0.1",
    });
  });

  it("validates the integrations before connecting", async () => {
    const { error, ha } = await failure({ integrations: ["mqtt.client"] });
    expect(error.kind).toBe("selector_invalid");
    expect(error.message).toContain(
      'The integration selector "mqtt.client" is not valid. Use an integration domain',
    );
    expect(ha.connections).toBe(0);
  });

  it("gives the existing kinds for connection and protocol failures", async () => {
    expect(await kind({}, { env: { DOMUSOPS_HA_URL: undefined } })).toBe(
      "config_missing",
    );
    expect(await kind({}, { env: { DOMUSOPS_HA_TOKEN: "wrong-token" } })).toBe(
      "auth_invalid",
    );
    expect(
      await kind({}, { env: { DOMUSOPS_HA_URL: "http://127.0.0.1:1" } }),
    ).toBe("unreachable");
    expect(await kind({}, { fake: { stall: "system_log/list" } })).toBe(
      "timeout",
    );
    expect(await kind({}, { fake: { haVersion: "2024.1.0" } })).toBe(
      "version_unsupported",
    );
    expect(await kind({}, { fake: { malformed: "system_log/list" } })).toBe(
      "protocol_error",
    );
  });

  it.each([
    ["a message that is not a list", { message: "boom" }],
    ["an empty message list", { message: [] }],
    ["an unknown level", { level: "INFO" }],
    ["a source without a line", { source: ["core.py"] }],
    ["a count of zero", { count: 0 }],
    ["an exception that is not a string", { exception: null }],
  ])("refuses an answer with %s and returns no document", async (_, change) => {
    const [first, ...rest] = SMALL_LOG;
    const broken = { ...first, ...change } as unknown as typeof first;
    expect(
      await kind({}, { fixture: systemLogFixture([broken!, ...rest]) }),
    ).toBe("protocol_error");
  });
});

describe("ha_system_log: keeping a noisy log within bounds (User Story 2)", () => {
  it("applies exclude after integrations, never to entries without an integration, and notes it first", async () => {
    const { response } = await query({ exclude: ["acme*", "zha", "sun"] });
    expect(loggers(standard(response))).toEqual([
      "homeassistant.components.recorder.core",
      "py.warnings",
      "homeassistant.core",
      "pyhueplus.api",
      "homeassistant.components.cast",
      "homeassistant.components.mqtt.client",
      "homeassistant.helpers.event",
    ]);
    expect(response.notes).toEqual([
      "Note: excluded acme*, zha, sun. Counts, the size check and compression_ratio leave them out.",
    ]);
    const both = await query({ integrations: ["acme*"], exclude: ["*"] });
    expect(standard(both.response).entries).toEqual({});
    expect(both.response.notes).toEqual([
      "Note: excluded *. Counts, the size check and compression_ratio leave them out.",
      "Note: no log entry matched the query.",
    ]);
  });

  it.each([
    ["warning", 12],
    ["error", 4],
    ["critical", 1],
  ])(
    "keeps the entries at level %s or above (FR-005)",
    async (level, count) => {
      const { response } = await query({ level });
      const document = standard(response);
      expect(document.level).toBe(level);
      expect(expandSystemLog(document)).toHaveLength(count);
    },
  );

  it("keeps the entries whose last occurrence is at or after start, read in the instance's time zone (FR-006)", async () => {
    const { response } = await query({
      start: "2026-11-13T09:20:05",
      integrations: ["acme*", "mqtt"],
      level: "warning",
    });
    const document = standard(response);
    expect(document.start).toBe("2026-11-13T09:20:05+01:00");
    expect(document.integrations).toEqual(["acme*", "mqtt"]);
    expect(document.level).toBe("warning");
    // The library entry began at 08:00:30 and recurred after start: it is listed.
    expect(loggers(document)).toEqual([
      "custom_components.acme_cloud",
      "pyacme.client",
    ]);
    const utc = await query({ start: "2026-11-13T08:20:06Z" });
    expect(loggers(standard(utc.response))).toEqual([
      "pyacme.client",
      "homeassistant.helpers.event",
    ]);
  });

  it.each([
    [
      { level: "info" },
      "input_invalid",
      "Give level as warning, error, or critical",
    ],
    [
      { level: "debug" },
      "input_invalid",
      "Give level as warning, error, or critical",
    ],
    [{ exclude: ["Hue"] }, "selector_invalid", "Use an integration domain"],
    [{ start: "yesterday" }, "window_invalid", "Use ISO 8601 timestamps"],
    [{ start: "1969-12-31T23:00" }, "window_invalid", "is before 1970"],
  ])("validates %j before connecting", async (options, expected, text) => {
    const { error, ha } = await failure(options);
    expect(error.kind).toBe(expected);
    expect(error.message).toContain(text);
    expect(ha.connections).toBe(0);
  });

  it("refuses a start in the future without reading the log", async () => {
    const { error, ha } = await failure({ start: "2026-11-13T12:00:01" });
    expect(error.kind).toBe("window_invalid");
    expect(error.message).toContain("the start is in the future");
    expect(ha.received).not.toContain("system_log/list");
  });

  it("refuses a standard result above the limit with the entry count, and no entry (SC-003)", async () => {
    const env = { DOMUSOPS_SYSTEM_LOG_MAX_BYTES: "1500" };
    const { error } = await failure({}, { env });
    expect(error.kind).toBe("too_large");
    expect(error.message).toMatch(
      /^The result has 12 entries and would be \d+ bytes, above the limit of 1500 bytes\. Use detail=summary/,
    );
    expect(error.message).not.toContain("homeassistant.components");
    expect(error.message).not.toContain("Connection refused");
    const { response } = await query({ detail: "summary" }, { env });
    expect(summary(response).counts.entries).toBe(12);
  });
});

describe("ha_system_log: which integrations are failing (User Story 3)", () => {
  it("counts entries and occurrences per integration and level, with a row for the rest (FR-012)", async () => {
    const { response } = await query({ detail: "summary" });
    const document = summary(response);
    expect(document.custom).toEqual(["acme_cloud", "hue_plus"]);
    expect(document.counts).toEqual({ entries: 12, occurrences: 21 });
    expect(document.by_integration).toEqual({
      acme_cloud: { warning: [1, 7], error: [1, 1] },
      cast: { warning: [1, 1] },
      hue: { warning: [1, 1] },
      hue_plus: { warning: [1, 1] },
      mqtt: { error: [1, 3] },
      recorder: { critical: [1, 2] },
      sun: { warning: [1, 1] },
      zha: { warning: [2, 2] },
    });
    expect(document.without_integration).toEqual({
      warning: [1, 1],
      error: [1, 1],
    });
    expect(Object.keys(document.by_integration)).toEqual(
      [...Object.keys(document.by_integration)].sort(),
    );
    for (const text of ["components/", "Connection refused", "Traceback"]) {
      expect(response.document).not.toContain(text);
    }
    expect(() =>
      expandSystemLog(document as unknown as SystemLogStandardDocument),
    ).toThrow(/detail=standard/);
  });

  it("narrows the counts with the filters, and leaves out the row without integration when it is empty", async () => {
    const { response } = await query({
      detail: "summary",
      integrations: ["acme*", "mqtt"],
      level: "error",
    });
    const document = summary(response);
    expect(document.counts).toEqual({ entries: 2, occurrences: 4 });
    expect(document.by_integration).toEqual({
      acme_cloud: { error: [1, 1] },
      mqtt: { error: [1, 3] },
    });
    expect(document.without_integration).toBeUndefined();
  });

  it("counts what the standard result of the reference log lists (US3 scenario 1)", async () => {
    const setup = { fixture: REFERENCE_SYSTEM_LOG, now: LOG_NOW_MS };
    const records = expandSystemLog(
      standard((await query({}, setup)).response),
    );
    const document = summary(
      (await query({ detail: "summary" }, setup)).response,
    );
    expect(document.counts).toEqual({
      entries: records.length,
      occurrences: records.reduce((sum, r) => sum + r.count, 0),
    });
    const expected: Record<string, Record<string, [number, number]>> = {};
    for (const r of records) {
      const key = r.integration ?? "(none)";
      const levels = (expected[key] ??= {});
      const pair = (levels[r.level] ??= [0, 0]);
      pair[0]++;
      pair[1] += r.count;
    }
    const { "(none)": without, ...byIntegration } = expected;
    expect(document.by_integration).toEqual(byIntegration);
    expect(document.without_integration).toEqual(without);
  });

  it("gives zero counts and the note on an empty log", async () => {
    const { response } = await query(
      { detail: "summary" },
      { fixture: systemLogFixture([]) },
    );
    expect(summary(response)).toMatchObject({
      counts: { entries: 0, occurrences: 0 },
      by_integration: {},
    });
    expect(response.notes).toEqual(["Note: the system log is empty."]);
  });

  it("refuses a summary above the limit with its own remediation", async () => {
    const { error } = await failure(
      { detail: "summary" },
      { env: { DOMUSOPS_SYSTEM_LOG_MAX_BYTES: "100" } },
    );
    expect(error.kind).toBe("too_large");
    expect(error.message).toContain(". Narrow the query with integrations");
    expect(error.message).not.toContain("detail=summary");
  });
});
