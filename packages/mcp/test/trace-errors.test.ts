import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorKind } from "../src/errors.js";
import type { Timeouts } from "../src/ha/client.js";
import { createServer } from "../src/server.js";
import {
  REFERENCE_TRACES,
  type TraceFixture,
} from "./fixtures/generate-traces.js";
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

const first = REFERENCE_TRACES.traces[0]!;

/** Connects an in-memory MCP client to a server backed by a fake instance and calls a tool. */
async function call(
  tool: "ha_trace" | "ha_snapshot",
  args: Record<string, unknown> = {},
  options: {
    fixture?: TraceFixture;
    fake?: Partial<FakeHaOptions>;
    env?: Record<string, string | undefined>;
    timeouts?: Partial<Timeouts>;
  } = {},
): Promise<{ result: CallResult; ha: FakeHa; text: string; client: Client }> {
  const ha = await startFakeHa({
    fixture: options.fixture ?? REFERENCE_TRACES,
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

/** Asserts a failed result of the given kind that carries no run data and no token (SC-005). */
function expectFailure(
  outcome: { result: CallResult; text: string },
  kind: ErrorKind,
): string {
  expect(outcome.result.isError).toBe(true);
  expect(outcome.text.startsWith(`ha_trace failed [${kind}]: `)).toBe(true);
  expect(outcome.text).not.toContain(FAKE_TOKEN);
  for (const trace of REFERENCE_TRACES.traces) {
    expect(outcome.text).not.toContain(trace.run_id);
  }
  expect(outcome.text).not.toContain("domusops.trace/0.1");
  // A cause and a next step: at least two sentences.
  expect(outcome.text.split(". ").length).toBeGreaterThanOrEqual(2);
  return outcome.text;
}

const afterKind = (text: string): string => text.slice(text.indexOf("]: ") + 3);

const withoutTraceComponent: TraceFixture = {
  ...REFERENCE_TRACES,
  records: {
    ...REFERENCE_TRACES.records,
    config: {
      ...REFERENCE_TRACES.records.config,
      components: ["automation", "script", "logbook"],
    },
  },
};

describe("failures shared with the other tools (spec FR-016)", () => {
  it("config_missing for each variable, with the text of ha_snapshot", async () => {
    for (const variable of ["DOMUSOPS_HA_URL", "DOMUSOPS_HA_TOKEN"]) {
      const env = { [variable]: undefined };
      const trace = await call("ha_trace", {}, { env });
      const snapshot = await call("ha_snapshot", {}, { env });
      const text = expectFailure(trace, "config_missing");
      expect(afterKind(text)).toBe(afterKind(snapshot.text));
      expect(text).toContain(variable);
      expect(trace.ha.received).toEqual([]);
    }
  });

  it("config_invalid for an address that is not one", async () => {
    expectFailure(
      await call("ha_trace", {}, { env: { DOMUSOPS_HA_URL: "not a url" } }),
      "config_invalid",
    );
  });

  it("unreachable for a host that does not answer", async () => {
    expectFailure(
      await call(
        "ha_trace",
        {},
        { env: { DOMUSOPS_HA_URL: "http://127.0.0.1:1" } },
      ),
      "unreachable",
    );
  });

  it("timeout at connect", async () => {
    expectFailure(
      await call("ha_trace", {}, { fake: { stall: "connect" } }),
      "timeout",
    );
  });

  it("version_unsupported for an old instance", async () => {
    expectFailure(
      await call("ha_trace", {}, { fake: { haVersion: "2024.12.0" } }),
      "version_unsupported",
    );
  });

  it("auth_invalid for a rejected token", async () => {
    const trace = await call(
      "ha_trace",
      {},
      { env: { DOMUSOPS_HA_TOKEN: "wrong-token" } },
    );
    const snapshot = await call(
      "ha_snapshot",
      {},
      { env: { DOMUSOPS_HA_TOKEN: "wrong-token" } },
    );
    expect(afterKind(expectFailure(trace, "auth_invalid"))).toBe(
      afterKind(snapshot.text),
    );
  });

  it("not_admin for a user without administrator privileges, before any trace command", async () => {
    const outcome = await call("ha_trace", {}, { fake: { isAdmin: false } });
    const text = expectFailure(outcome, "not_admin");
    expect(outcome.ha.received.some((c) => c.startsWith("trace/"))).toBe(false);
    expect(text).not.toContain("snapshot");
    expect(text).not.toContain("entity states");
  });

  it("not_admin when the instance itself refuses a trace command", async () => {
    expectFailure(
      await call("ha_trace", {}, { fake: { traceNotAdmin: true } }),
      "not_admin",
    );
  });

  it("retrieval_failed when a trace command fails", async () => {
    for (const type of [
      "trace/list",
      "trace/contexts",
      "config/entity_registry/list",
    ]) {
      const context =
        type === "trace/contexts" ? { context: first.context.id } : {};
      expectFailure(
        await call("ha_trace", context, { fake: { failCommand: { type } } }),
        "retrieval_failed",
      );
    }
    expectFailure(
      await call(
        "ha_trace",
        { run: first.run_id },
        { fake: { failCommand: { type: "trace/get" } } },
      ),
      "retrieval_failed",
    );
  });

  it("retrieval_failed, with no runs, when a run is replaced while it is read", async () => {
    const text = expectFailure(
      await call("ha_trace", {}, { fake: { evictOnGet: first.run_id } }),
      "retrieval_failed",
    );
    expect(text).toContain("replaced while it was being read");
  });

  it("retrieval_failed when the connection drops after the list", async () => {
    expectFailure(
      await call("ha_trace", {}, { fake: { dropAfter: "trace/get" } }),
      "retrieval_failed",
    );
  });

  it("protocol_error for a malformed reply", async () => {
    for (const type of ["trace/list", "trace/get", "get_states"]) {
      expectFailure(
        await call("ha_trace", {}, { fake: { malformed: type } }),
        "protocol_error",
      );
    }
  });
});

describe("failures of this tool (spec FR-016)", () => {
  it("window_invalid without opening a socket, and with the accepted form", async () => {
    for (const args of [{ start: "2026-13-01" }, { end: "not a time" }]) {
      const outcome = await call("ha_trace", args);
      expect(expectFailure(outcome, "window_invalid")).toContain("ISO 8601");
      expect(outcome.ha.authReceived).toBe(false);
    }
  });

  it("window_invalid for an order the instance's clock decides, before any trace command", async () => {
    for (const args of [
      { start: "2026-03-14T09:00", end: "2026-03-14T08:00" },
      { start: "2999-01-01T00:00" },
    ]) {
      const outcome = await call("ha_trace", args);
      expectFailure(outcome, "window_invalid");
      expect(outcome.ha.received.some((c) => c.startsWith("trace/"))).toBe(
        false,
      );
    }
  });

  it("selector_invalid without opening a socket", async () => {
    for (const entities of [["Automation.X"], ["a b"], ["auto?"]]) {
      const outcome = await call("ha_trace", { entities });
      expectFailure(outcome, "selector_invalid");
      expect(outcome.ha.authReceived).toBe(false);
    }
  });

  it("selection_invalid for each combination and each malformed ID, without opening a socket", async () => {
    const run = first.run_id;
    for (const args of [
      { run, context: "abc" },
      { run, entities: ["automation.*"] },
      { run, start: "2026-03-14T00:00" },
      { context: "abc", end: "2026-03-14T00:00" },
      { context: "abc", entities: ["script.*"] },
      { run: "NOT-A-RUN" },
      { context: "x".repeat(65) },
    ]) {
      const outcome = await call("ha_trace", args);
      expectFailure(outcome, "selection_invalid");
      expect(outcome.ha.authReceived).toBe(false);
    }
  });

  it("run_not_found for an unknown run, saying how few runs the instance keeps", async () => {
    const text = expectFailure(
      await call("ha_trace", { run: "0".repeat(32) }),
      "run_not_found",
    );
    expect(text).toContain("stored_traces");
    expect(text).toContain("detail=summary");
  });

  it("run_not_found for a context no stored run ran in, saying the cause may not be one", async () => {
    const text = expectFailure(
      await call("ha_trace", { context: "no-such-context" }),
      "run_not_found",
    );
    expect(text).toContain("may not be an automation or script");
  });

  it("traces_unavailable when the trace integration is not loaded", async () => {
    const outcome = await call(
      "ha_trace",
      {},
      { fixture: withoutTraceComponent },
    );
    expectFailure(outcome, "traces_unavailable");
    expect(outcome.ha.received.some((c) => c.startsWith("trace/"))).toBe(false);
  });

  it("traces_unavailable when a trace command does not exist", async () => {
    expectFailure(
      await call("ha_trace", {}, { fake: { traces: false } }),
      "traces_unavailable",
    );
  });
});

describe("too_large (spec FR-020)", () => {
  it("refuses a standard result above the default limit, with counts and ways to narrow", async () => {
    const text = expectFailure(
      await call(
        "ha_trace",
        {},
        { timeouts: { ...SHORT, totalMs: 5000, commandMs: 2000 } },
      ),
      "too_large",
    );
    expect(text).toContain(`${REFERENCE_TRACES.traces.length} runs`);
    expect(text).toMatch(/would be \d+ bytes/);
    expect(text).toContain("limit of 100000 bytes");
    expect(text).toContain("detail=summary");
    expect(text).toContain("DOMUSOPS_TRACE_MAX_BYTES");
  });

  it("applies the limit the user set, and reports it", async () => {
    const text = expectFailure(
      await call(
        "ha_trace",
        { run: first.run_id },
        { env: { DOMUSOPS_TRACE_MAX_BYTES: "1000" } },
      ),
      "too_large",
    );
    expect(text).toContain("limit of 1000 bytes");
    expect(text).toContain("1 runs");
  });

  it("is not moved by the logbook limit", async () => {
    expectFailure(
      await call(
        "ha_trace",
        { run: first.run_id },
        {
          env: {
            DOMUSOPS_TRACE_MAX_BYTES: "1000",
            DOMUSOPS_LOGBOOK_MAX_BYTES: "10000000",
          },
        },
      ),
      "too_large",
    );
    const fits = await call(
      "ha_trace",
      { run: first.run_id },
      { env: { DOMUSOPS_LOGBOOK_MAX_BYTES: "1" } },
    );
    expect(fits.result.isError).toBeUndefined();
  });

  it.each(["zero", "-5", "1.5", "0"])(
    "config_invalid naming the variable for a limit of %s, before connecting",
    async (value) => {
      const outcome = await call(
        "ha_trace",
        {},
        { env: { DOMUSOPS_TRACE_MAX_BYTES: value } },
      );
      const text = expectFailure(outcome, "config_invalid");
      expect(text).toContain("DOMUSOPS_TRACE_MAX_BYTES");
      expect(outcome.ha.authReceived).toBe(false);
    },
  );

  it("cannot be raised by the agent: the input schema has no such property", async () => {
    const { client } = await call("ha_snapshot");
    const listing = await client.listTools();
    const tool = listing.tools.find((t) => t.name === "ha_trace");
    const properties = Object.keys(tool?.inputSchema.properties ?? {}).sort();
    expect(properties).toEqual([
      "context",
      "detail",
      "end",
      "entities",
      "run",
      "start",
    ]);
  });
});
