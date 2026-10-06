import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: Record<string, unknown>;
}

const contract = JSON.parse(
  readFileSync(
    new URL(
      "../../../specs/002-ha-logbook-query/contracts/ha_logbook_query.tool.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ToolDefinition;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function advertised(name: string): Promise<ToolDefinition> {
  const server = createServer({ env: {} });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "contract-test", version: "0.0.0" });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`${name} is not advertised`);
  return tool as unknown as ToolDefinition;
}

describe("the advertised ha_logbook_query matches contracts/ha_logbook_query.tool.json", () => {
  it("has the same name, title, description, and annotations", async () => {
    const tool = await advertised("ha_logbook_query");
    expect(tool.name).toBe(contract.name);
    expect(tool.title).toBe(contract.title);
    expect(tool.description).toBe(contract.description);
    expect(tool.annotations).toMatchObject(contract.annotations ?? {});
  });

  it("has the same input properties, with the same types, bounds, defaults, and descriptions", async () => {
    const tool = await advertised("ha_logbook_query");
    const wanted = contract.inputSchema.properties ?? {};
    const actual = tool.inputSchema.properties ?? {};
    expect(Object.keys(actual).sort()).toEqual(Object.keys(wanted).sort());
    for (const [name, schema] of Object.entries(wanted)) {
      for (const key of [
        "type",
        "enum",
        "default",
        "minItems",
        "maxItems",
        "items",
        "description",
      ]) {
        if (key in schema)
          expect(actual[name]?.[key], `${name}.${key}`).toEqual(schema[key]);
      }
    }
    expect(tool.inputSchema.required ?? []).toEqual([]);
    // `additionalProperties: false` in the contract is not asserted: the SDK ignores unknown
    // properties instead of rejecting them, as for ha_snapshot (feature 001, T043).
  });

  it("still advertises ha_snapshot unchanged (FR-001)", async () => {
    const tool = await advertised("ha_snapshot");
    expect(tool.name).toBe("ha_snapshot");
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["detail"]);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
  });
});
