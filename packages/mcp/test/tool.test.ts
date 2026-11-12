import { FORMAT, type StandardDocument } from "@domusops/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Timeouts } from "../src/ha/client.js";
import { REQUIREMENTS } from "../src/ping/requirements.js";
import { createServer } from "../src/server.js";
import {
  EMPTY,
  PERF_1000,
  REFERENCE_500,
  type Fixture,
} from "./fixtures/generate.js";
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
  structuredContent?: unknown;
}

/** Starts a fake instance, connects an in-memory MCP client to the server, and calls the tool. */
async function callTool(
  fixture: Fixture,
  args: Record<string, unknown> = {},
  fake: Partial<FakeHaOptions> = {},
  env: Record<string, string | undefined> = {},
  timeouts: Partial<Timeouts> = {
    connectMs: 2000,
    commandMs: 2000,
    totalMs: 5000,
  },
): Promise<{ result: CallResult; ha: FakeHa; ms: number }> {
  const ha = await startFakeHa({ fixture, ...fake });
  cleanups.push(() => ha.close());
  const server = createServer({
    env: { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...env },
    timeouts,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tool-test", version: "0.0.0" });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  const started = Date.now();
  const result = (await client.callTool({
    name: "ha_snapshot",
    arguments: args,
  })) as CallResult;
  return { result, ha, ms: Date.now() - started };
}

function parse(result: CallResult): StandardDocument {
  expect(result.content).toHaveLength(1);
  const block = result.content[0];
  expect(block?.type).toBe("text");
  return JSON.parse(block?.text ?? "") as StandardDocument;
}

describe("ha_snapshot: happy path", () => {
  it("returns one text block, no structuredContent, in the standard format", async () => {
    const { result } = await callTool(REFERENCE_500);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    const doc = parse(result);
    expect(doc.format).toBe(FORMAT);
    expect(doc.detail).toBe("standard");
    expect(doc.ha_version).toBe(REFERENCE_500.haVersion);
  });

  it("meets the compression floor on the shipped pipeline (FR-023)", async () => {
    const { result } = await callTool(REFERENCE_500);
    const doc = parse(result);
    expect(doc.compression_ratio).toBeGreaterThanOrEqual(5);
  });

  it("completes a 1,000-entity snapshot in under five seconds (SC-004)", async () => {
    const { result, ms } = await callTool(PERF_1000);
    expect(result.isError).toBeFalsy();
    expect(ms).toBeLessThan(5000);
  });

  it("returns a valid snapshot with zero entities and a finite ratio for an empty instance", async () => {
    const { result } = await callTool(EMPTY);
    expect(result.isError).toBeFalsy();
    const doc = parse(result);
    expect(doc.integrations).toEqual({});
    expect(Number.isFinite(doc.compression_ratio)).toBe(true);
    expect(doc.compression_ratio).toBeGreaterThan(0);
  });
});

const FAILURE_TEXT = /^ha_snapshot failed \[(\w+)\]: .+\.$/;
const SHORT = { connectMs: 250, commandMs: 250, totalMs: 2000 };

function expectFailure(result: CallResult, kind: string): string {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  const text = result.content[0]?.text ?? "";
  expect(text).toMatch(FAILURE_TEXT);
  expect(text.match(FAILURE_TEXT)?.[1]).toBe(kind);
  // A failure carries neither the token nor any snapshot data (FR-002, FR-020).
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain("light.");
  expect(text).not.toContain("sensor.");
  expect(text).not.toContain('"format"');
  return text;
}

describe("ha_snapshot: failures", () => {
  it("config_missing names the variable", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      {},
      { DOMUSOPS_HA_TOKEN: undefined },
      SHORT,
    );
    expect(expectFailure(result, "config_missing")).toContain(
      "DOMUSOPS_HA_TOKEN",
    );
  });

  it("auth_invalid does not echo the token", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      { token: "some-other-token-value" },
      {},
      SHORT,
    );
    expectFailure(result, "auth_invalid");
  });

  it("unreachable names the address", async () => {
    const { result, ha } = await callTool(
      REFERENCE_500,
      {},
      {},
      { DOMUSOPS_HA_URL: "http://127.0.0.1:1" },
      SHORT,
    );
    expect(ha.received).toEqual([]);
    expect(expectFailure(result, "unreachable")).toContain("127.0.0.1:1");
  });

  it("version_unsupported states both versions", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      { haVersion: "2024.12.4" },
      {},
      SHORT,
    );
    const text = expectFailure(result, "version_unsupported");
    expect(text).toContain("2024.12.4");
    expect(text).toContain("2025.1.0");
  });

  it("not_admin explains why", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      { isAdmin: false },
      {},
      SHORT,
    );
    expect(expectFailure(result, "not_admin")).toContain("administrator");
  });

  it("timeout names the phase", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      { stall: "get_states" },
      {},
      SHORT,
    );
    expect(expectFailure(result, "timeout")).toContain("get_states");
  });

  it("protocol_error for an unexpected response", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      { malformed: "get_config" },
      {},
      SHORT,
    );
    expectFailure(result, "protocol_error");
  });

  it("returns no partial snapshot when the last retrieval fails", async () => {
    const { result, ha } = await callTool(
      REFERENCE_500,
      {},
      { failCommand: { type: "config_entries/get" } },
      {},
      SHORT,
    );
    expect(ha.received).toContain("get_states");
    expect(expectFailure(result, "retrieval_failed")).toContain(
      "config_entries/get",
    );
  });

  it("retrieval_failed when the connection drops after some retrievals", async () => {
    const { result } = await callTool(
      REFERENCE_500,
      {},
      { dropAfter: "config_entries/get" },
      {},
      SHORT,
    );
    expectFailure(result, "retrieval_failed");
  });
});

const ALLOWED = new Set([
  "auth/current_user",
  "get_config",
  "get_states",
  "config/entity_registry/list",
  "config/device_registry/list",
  "config/area_registry/list",
  "config_entries/get",
]);

describe("ha_snapshot: detail levels", () => {
  it("defaults to standard when detail is omitted", async () => {
    const { result } = await callTool(REFERENCE_500);
    expect(parse(result).detail).toBe("standard");
  });

  it.each(["summary", "standard", "full"] as const)(
    "returns the %s shape with a compression_ratio, using only allowlisted reads",
    async (detail) => {
      const { result, ha } = await callTool(REFERENCE_500, { detail });
      expect(result.isError).toBeFalsy();
      const doc = JSON.parse(result.content[0]?.text ?? "") as Record<
        string,
        unknown
      >;
      expect(doc["detail"]).toBe(detail);
      expect(typeof doc["compression_ratio"]).toBe("number");
      expect(doc["compression_ratio"] as number).toBeGreaterThan(1);
      if (detail === "summary") expect(doc).toHaveProperty("counts");
      else expect(doc).toHaveProperty("integrations");
      for (const command of ha.received)
        expect(ALLOWED.has(command)).toBe(true);
    },
  );

  it("summary is far smaller than standard, and full is larger", async () => {
    const sizes: Record<string, number> = {};
    for (const detail of ["summary", "standard", "full"] as const) {
      const { result } = await callTool(REFERENCE_500, { detail });
      sizes[detail] = (result.content[0]?.text ?? "").length;
    }
    expect(sizes["summary"]).toBeLessThan((sizes["standard"] as number) / 10);
    expect(sizes["full"]).toBeGreaterThan(sizes["standard"] as number);
  });

  it("rejects an unrecognised detail value, listing the accepted ones, with no snapshot", async () => {
    const outcome = await callTool(REFERENCE_500, { detail: "verbose" }).then(
      ({ result }) => ({
        text: result.content[0]?.text ?? "",
        isError: result.isError === true,
      }),
      (error: unknown) => ({ text: String(error), isError: true }),
    );
    expect(outcome.isError).toBe(true);
    for (const level of ["summary", "standard", "full"])
      expect(outcome.text).toContain(level);
    expect(outcome.text).not.toContain('"format"');
  });

  it("ignores an unknown extra property", async () => {
    const outcome = await callTool(REFERENCE_500, {
      detail: "summary",
      surprise: true,
    }).then(
      ({ result }) => ({
        ok: !result.isError,
        detail: result.isError ? "" : parse(result).detail,
      }),
      () => ({ ok: false, detail: "" }),
    );
    // The SDK's schema strips unknown keys, so the call succeeds (pinned by this test).
    expect(outcome).toEqual({ ok: true, detail: "summary" });
  });
});

describe("ha_ping: the tool", () => {
  const contract = JSON.parse(
    readFileSync(
      new URL(
        "../../../specs/009-ha-ping/contracts/ha_ping.tool.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: object;
  };

  async function connected(): Promise<Client> {
    const ha = await startFakeHa({ fixture: REFERENCE_500 });
    cleanups.push(() => ha.close());
    const server = createServer({
      env: { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "tool-test", version: "0.0.0" });
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  it("is advertised as the contract says", async () => {
    const { tools } = await (await connected()).listTools();
    const tool = tools.find((candidate) => candidate.name === "ha_ping");
    expect(tool?.title).toBe(contract.title);
    expect(tool?.description).toBe(contract.description);
    expect(tool?.inputSchema).toMatchObject(contract.inputSchema);
    expect(tool?.annotations).toMatchObject(contract.annotations);
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("returns one text block", async () => {
    const result = (await (
      await connected()
    ).callTool({ name: "ha_ping", arguments: {} })) as CallResult;
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
      format: "domusops.ping/0.1",
    });
  });

  it("has a requirements entry for every registered tool but itself, in registration order (research R4)", async () => {
    const { tools } = await (await connected()).listTools();
    expect(Object.keys(REQUIREMENTS)).toEqual(
      tools.map((tool) => tool.name).filter((name) => name !== "ha_ping"),
    );
  });
});

describe("ha_state: the tool", () => {
  const contract = JSON.parse(
    readFileSync(
      new URL(
        "../../../specs/010-ha-state/contracts/ha_state.tool.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    title: string;
    description: string;
    inputSchema: object;
    annotations: object;
  };

  async function connected(): Promise<Client> {
    const ha = await startFakeHa({ fixture: REFERENCE_500 });
    cleanups.push(() => ha.close());
    const server = createServer({
      env: { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "tool-test", version: "0.0.0" });
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  it("is advertised as the contract says, between ha_trace and ha_ping", async () => {
    const { tools } = await (await connected()).listTools();
    const names = tools.map((tool) => tool.name);
    expect(names.indexOf("ha_state")).toBe(names.indexOf("ha_trace") + 1);
    expect(names.indexOf("ha_ping")).toBe(names.indexOf("ha_state") + 1);
    const tool = tools.find((candidate) => candidate.name === "ha_state");
    expect(tool?.title).toBe(contract.title);
    expect(tool?.description).toBe(contract.description);
    expect(tool?.inputSchema).toMatchObject(contract.inputSchema);
    expect(tool?.annotations).toMatchObject(contract.annotations);
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("returns the document, then the notes, as text blocks", async () => {
    const result = (await (
      await connected()
    ).callTool({
      name: "ha_state",
      arguments: {
        entities: ["light.*", "light.not_here"],
        exclude: ["*_firmware"],
      },
    })) as CallResult;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
      format: "domusops.state/0.1",
      detail: "standard",
    });
    expect(result.content.slice(1).map((block) => block.text)).toEqual([
      "Note: excluded *_firmware. Counts, the size check and compression_ratio leave them out.",
      "Note: no entity has the ID light.not_here.",
    ]);
  });

  it("counts a state's length in characters, not UTF-16 units", async () => {
    const client = await connected();
    const call = async (state: string): Promise<CallResult> =>
      (await client.callTool({
        name: "ha_state",
        arguments: { state: [state], detail: "summary" },
      })) as CallResult;
    // 255 emoji are 510 UTF-16 units, a valid state on the instance.
    expect((await call("\u{1F600}".repeat(255))).isError).toBeFalsy();
    expect((await call("\u{1F600}".repeat(256))).isError).toBe(true);
  });
});
