import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { runLogbookQuery } from "../src/tools/ha-logbook-query.js";
import { runTrace } from "../src/tools/ha-trace.js";
import { REFERENCE_LOGBOOK_24H } from "./fixtures/generate-logbook.js";
import { REFERENCE_TRACES } from "./fixtures/generate-traces.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";

/**
 * Notes travel as text blocks after the unchanged document (specs/008-mcp-reliability FR-009,
 * FR-010, research R2, contracts/response-notes.md).
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

interface CallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

/** Starts a fake instance and an in-memory client, and returns a way to call tools on both. */
async function connect(fixture: object): Promise<{
  call: (name: string, args: Record<string, unknown>) => Promise<CallResult>;
  env: Record<string, string>;
}> {
  const ha: FakeHa = await startFakeHa({ fixture } as Parameters<
    typeof startFakeHa
  >[0]);
  const env = {
    DOMUSOPS_HA_URL: ha.url,
    DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
    DOMUSOPS_TRACE_MAX_BYTES: "10000000",
  };
  const server = createServer({ env });
  const client = new Client({ name: "response-notes-test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
    await ha.close();
  });
  return {
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallResult,
    env,
  };
}

// The server reads the clock; an explicit window keeps the logbook document the same on every call.
const LOGBOOK_WINDOW = {
  start: new Date(REFERENCE_LOGBOOK_24H.window.start * 1000).toISOString(),
  end: new Date(REFERENCE_LOGBOOK_24H.window.end * 1000).toISOString(),
};

describe("ha_logbook_query responses", () => {
  it("send the exclusion note after the unchanged document when exclude is given", async () => {
    const { call, env } = await connect(REFERENCE_LOGBOOK_24H);
    const args = { ...LOGBOOK_WINDOW, exclude: ["sensor.*", "button.*"] };
    const result = await call("ha_logbook_query", args);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.text).toBe(await runLogbookQuery(env, args));
    expect(result.content[1]).toEqual({
      type: "text",
      text: "Note: excluded sensor.*, button.*. Counts, the size check and compression_ratio leave them out.",
    });
  });

  it("send the note even when the exclusion matched nothing", async () => {
    const { call } = await connect(REFERENCE_LOGBOOK_24H);
    const result = await call("ha_logbook_query", {
      ...LOGBOOK_WINDOW,
      exclude: ["fan.*"],
    });
    expect(result.content.map((b) => b.text?.startsWith("Note:"))).toEqual([
      false,
      true,
    ]);
  });

  it("are one block, as before, without exclude", async () => {
    const { call } = await connect(REFERENCE_LOGBOOK_24H);
    const result = await call("ha_logbook_query", LOGBOOK_WINDOW);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
      format: "domusops.logbook/0.1",
    });
  });

  it("carry no note when the call fails", async () => {
    const { call } = await connect(REFERENCE_LOGBOOK_24H);
    const result = await call("ha_logbook_query", {
      ...LOGBOOK_WINDOW,
      exclude: ["Not Valid"],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toMatch(/selector_invalid/);
  });
});

describe("ha_trace responses", () => {
  it("send the exclusion note after the unchanged document when exclude is given", async () => {
    const { call, env } = await connect(REFERENCE_TRACES);
    const args = { entities: ["automation.*"], exclude: ["script.*"] };
    const result = await call("ha_trace", args);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.text).toBe(await runTrace(env, args));
    expect(result.content[1]?.text).toBe(
      "Note: excluded script.*. Counts, the size check and compression_ratio leave them out.",
    );
  });

  it("are one block, as before, without exclude", async () => {
    const { call } = await connect(REFERENCE_TRACES);
    const result = await call("ha_trace", { entities: ["automation.*"] });
    expect(result.content).toHaveLength(1);
  });

  it("carry no note when the call fails", async () => {
    const { call } = await connect(REFERENCE_TRACES);
    const result = await call("ha_trace", {
      run: "0123456789abcdef0123456789abcdef",
      exclude: ["script.*"],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toMatch(/selection_invalid/);
  });
});
