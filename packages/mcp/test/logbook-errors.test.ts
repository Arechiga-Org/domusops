import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorKind } from "../src/errors.js";
import type { Timeouts } from "../src/ha/client.js";
import { createServer } from "../src/server.js";
import {
  PERFORMANCE_LOGBOOK,
  REFERENCE_LOGBOOK_24H,
  type LogbookFixture,
} from "./fixtures/generate-logbook.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

interface CallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

const SHORT: Partial<Timeouts> = {
  connectMs: 300,
  commandMs: 300,
  totalMs: 1500,
};
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
const WINDOW = {
  start: iso(REFERENCE_LOGBOOK_24H.window.start),
  end: iso(REFERENCE_LOGBOOK_24H.window.end),
};

/** Connects an in-memory MCP client to a server backed by a fake instance and calls a tool. */
async function call(
  tool: "ha_logbook_query" | "ha_snapshot",
  args: Record<string, unknown> = {},
  options: {
    fixture?: LogbookFixture;
    fake?: Partial<FakeHaOptions>;
    env?: Record<string, string | undefined>;
    timeouts?: Partial<Timeouts>;
  } = {},
): Promise<{ result: CallResult; ha: FakeHa; text: string; client: Client }> {
  const ha = await startFakeHa({
    fixture: options.fixture ?? REFERENCE_LOGBOOK_24H,
    ...options.fake,
  });
  cleanups.push(() => ha.close());
  const server = createServer({
    env: {
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
      ...options.env,
    },
    timeouts: options.timeouts ?? SHORT,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "errors-test", version: "0.0.0" });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  const result = (await client.callTool({
    name: tool,
    arguments: args,
  })) as CallResult;
  return { result, ha, text: result.content[0]?.text ?? "", client };
}

const logbook = (
  args: Record<string, unknown> = {},
  options: Parameters<typeof call>[2] = {},
): ReturnType<typeof call> => call("ha_logbook_query", args, options);

/** Every failure: an error result, the tool and kind in the text, no token, and no events. */
function expectFailure(
  { result, text }: { result: CallResult; text: string },
  kind: ErrorKind,
): void {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  expect(text.startsWith(`ha_logbook_query failed [${kind}]: `)).toBe(true);
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain('"events"');
  expect(text).not.toContain("entity_id");
}

describe("failures shared with ha_snapshot (FR-014)", () => {
  it.each([
    ["DOMUSOPS_HA_URL", { DOMUSOPS_HA_URL: undefined }],
    ["DOMUSOPS_HA_TOKEN", { DOMUSOPS_HA_TOKEN: undefined }],
  ])("config_missing names %s", async (variable, env) => {
    const run = await logbook(WINDOW, { env });
    expectFailure(run, "config_missing");
    expect(run.text).toContain(variable);
  });

  it("config_invalid for an address that is not http(s)://host[:port]", async () => {
    expectFailure(
      await logbook({}, { env: { DOMUSOPS_HA_URL: "ftp://nope" } }),
      "config_invalid",
    );
  });

  it("unreachable names the address", async () => {
    const run = await logbook(
      {},
      { env: { DOMUSOPS_HA_URL: "http://127.0.0.1:1" } },
    );
    expectFailure(run, "unreachable");
    expect(run.text).toContain("127.0.0.1:1");
  });

  it("timeout at connect names the phase", async () => {
    expectFailure(await logbook({}, { fake: { stall: "connect" } }), "timeout");
  });

  it("timeout during the logbook retrieval suggests a shorter window", async () => {
    const run = await logbook(WINDOW, {
      fake: { logbookDelayMs: 1500 },
      timeouts: { connectMs: 300, commandMs: 300, totalMs: 600 },
    });
    expectFailure(run, "timeout");
    expect(run.text).toContain("shorter window");
  });

  it("version_unsupported states both versions", async () => {
    const run = await logbook({}, { fake: { haVersion: "2024.12.0" } });
    expectFailure(run, "version_unsupported");
    expect(run.text).toContain("2024.12.0");
    expect(run.text).toContain("2025.1.0");
  });

  it("auth_invalid does not echo the token", async () => {
    const run = await logbook(
      {},
      { env: { DOMUSOPS_HA_TOKEN: "some-other-token-0000" } },
    );
    expectFailure(run, "auth_invalid");
    expect(run.text).not.toContain("some-other-token-0000");
  });

  it("not_admin explains why", async () => {
    const run = await logbook(WINDOW, { fake: { isAdmin: false } });
    expectFailure(run, "not_admin");
    expect(run.ha.received).not.toContain("logbook/get_events");
  });

  it("retrieval_failed when the logbook retrieval fails, with no events", async () => {
    const run = await logbook(WINDOW, {
      fake: {
        failCommand: {
          type: "logbook/get_events",
          code: "boom",
          message: "db locked",
        },
      },
    });
    expectFailure(run, "retrieval_failed");
    expect(run.text).toContain("logbook/get_events");
  });

  it("retrieval_failed when the connection drops during the retrieval", async () => {
    expectFailure(
      await logbook(WINDOW, { fake: { dropAfter: "logbook/get_events" } }),
      "retrieval_failed",
    );
  });

  it("protocol_error for a reply of the wrong shape", async () => {
    expectFailure(
      await logbook(WINDOW, { fake: { malformed: "logbook/get_events" } }),
      "protocol_error",
    );
  });

  it("uses the same cause and next step as ha_snapshot", async () => {
    const same = async (options: Parameters<typeof call>[2]): Promise<void> => {
      const a = await logbook({}, options);
      const b = await call("ha_snapshot", {}, options);
      expect(
        a.text.replace("ha_logbook_query failed", "ha_snapshot failed"),
      ).toBe(b.text);
    };
    await same({ fake: { isAdmin: false } });
    await same({ fake: { haVersion: "2024.12.0" } });
    await same({ env: { DOMUSOPS_HA_TOKEN: undefined } });
    await same({ env: { DOMUSOPS_HA_TOKEN: "wrong-token-1234567890" } });
    await same({ env: { DOMUSOPS_HA_URL: "ftp://nope" } });
  });
});

describe("window_invalid", () => {
  it("rejects an unparseable timestamp without opening a socket", async () => {
    const run = await logbook({ start: "yesterday" });
    expectFailure(run, "window_invalid");
    expect(run.ha.authReceived).toBe(false);
    expect(run.ha.received).toEqual([]);
  });

  it("rejects an end before the start without asking the instance for events", async () => {
    const run = await logbook({
      start: "2000-01-02T00:00:00Z",
      end: "2000-01-01T00:00:00Z",
    });
    expectFailure(run, "window_invalid");
    expect(run.ha.received).not.toContain("logbook/get_events");
  });

  it("rejects a start in the future without asking the instance for events", async () => {
    const run = await logbook({ start: "2099-01-01T00:00:00Z" });
    expectFailure(run, "window_invalid");
    expect(run.text).toContain("future");
    expect(run.ha.received).not.toContain("logbook/get_events");
  });
});

describe("selector_invalid", () => {
  it("rejects a selector with an uppercase letter, naming it, without opening a socket", async () => {
    const run = await logbook({ entities: ["light.ok", "Light.Hallway"] });
    expectFailure(run, "selector_invalid");
    expect(run.text).toContain("Light.Hallway");
    expect(run.ha.authReceived).toBe(false);
  });
});

describe("history_unavailable", () => {
  it("when the core config has no logbook component", async () => {
    const fixture: LogbookFixture = {
      ...REFERENCE_LOGBOOK_24H,
      records: {
        ...REFERENCE_LOGBOOK_24H.records,
        config: {
          ...REFERENCE_LOGBOOK_24H.records.config,
          components: ["light"],
        },
      },
    };
    const run = await logbook(WINDOW, { fixture });
    expectFailure(run, "history_unavailable");
    expect(run.text).toContain("logbook");
    expect(run.text).toContain("recorder");
  });

  it("when the instance does not know logbook/get_events", async () => {
    expectFailure(
      await logbook(WINDOW, { fake: { logbook: false } }),
      "history_unavailable",
    );
  });
});

describe("too_large (FR-019)", () => {
  const big = {
    start: iso(PERFORMANCE_LOGBOOK.window.start),
    end: iso(PERFORMANCE_LOGBOOK.window.end),
  };

  it("refuses a result above the default limit, stating the count, the size, and the limit", async () => {
    const run = await logbook(big, { fixture: PERFORMANCE_LOGBOOK });
    expectFailure(run, "too_large");
    expect(run.text).toContain(`${PERFORMANCE_LOGBOOK.logbook.length} events`);
    expect(run.text).toContain("100000 bytes");
    expect(run.text).toMatch(/would be \d+ bytes/);
    expect(run.text).toContain("detail=summary");
    expect(run.text).toContain("DOMUSOPS_LOGBOOK_MAX_BYTES");
  });

  it("reports the limit the user set in the configuration", async () => {
    const run = await logbook(WINDOW, {
      env: { DOMUSOPS_LOGBOOK_MAX_BYTES: "1000" },
    });
    expectFailure(run, "too_large");
    expect(run.text).toContain("limit of 1000 bytes");
  });

  it("returns the same result when the limit is raised to fit it", async () => {
    const run = await logbook(big, {
      fixture: PERFORMANCE_LOGBOOK,
      env: { DOMUSOPS_LOGBOOK_MAX_BYTES: "10000000" },
      timeouts: { connectMs: 2000, commandMs: 2000, totalMs: 10_000 },
    });
    expect(run.result.isError).not.toBe(true);
  });

  it("does not offer the limit as a tool argument", async () => {
    const { client } = await logbook(WINDOW);
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "ha_logbook_query");
    const properties = Object.keys(tool?.inputSchema.properties ?? {});
    expect(properties.some((p) => /limit|max|bytes|size/i.test(p))).toBe(false);
  });
});

describe("DOMUSOPS_LOGBOOK_MAX_BYTES must be a positive whole number", () => {
  it.each(["zero", "-5", "1.5", "0", "1e3", "12 34"])(
    "config_invalid for %j, before connecting",
    async (value) => {
      const run = await logbook(WINDOW, {
        env: { DOMUSOPS_LOGBOOK_MAX_BYTES: value },
      });
      expectFailure(run, "config_invalid");
      expect(run.text).toContain("DOMUSOPS_LOGBOOK_MAX_BYTES");
      expect(run.ha.authReceived).toBe(false);
    },
  );
});

describe("detail (spec User Story 4)", () => {
  it("rejects an unrecognised value, listing the accepted ones, with no events", async () => {
    let text = "";
    let isError: boolean | undefined;
    try {
      const run = await logbook({ ...WINDOW, detail: "full" });
      text = run.text;
      isError = run.result.isError;
    } catch (error) {
      // The SDK may report a schema violation as a protocol error instead of a tool result.
      text = String(error instanceof Error ? error.message : error);
      isError = true;
    }
    expect(isError).toBe(true);
    expect(text).toContain("summary");
    expect(text).toContain("standard");
    expect(text).not.toContain('"events"');
  });

  it("accepts summary and standard", async () => {
    for (const detail of ["summary", "standard"]) {
      const run = await logbook({ ...WINDOW, detail });
      expect(run.result.isError).not.toBe(true);
      expect(JSON.parse(run.text).detail).toBe(detail);
    }
  });
});
