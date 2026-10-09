import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxHandle } from "../src/instance/handle.js";
import type { Runtime } from "../src/runtime/docker.js";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function handleOver(
  existing: Record<string, unknown> | null,
): Promise<{ handle: SandboxHandle; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      seen.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: text === "" ? null : JSON.parse(text),
      });
      if (request.method === "GET" && existing === null) {
        response.writeHead(404).end("not found");
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          request.method === "GET" ? { state: "1", attributes: existing } : {},
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const handle = new SandboxHandle({
    id: "sb-test",
    containerId: "c",
    release: { release: "2026.9.3" } as never,
    mode: "tied",
    deadline: "2031-01-01T00:00:00Z",
    port: (server?.address() as AddressInfo).port,
    token: "t",
    config: null,
    runtime: {} as Runtime,
  });
  return { handle, seen };
}

describe("setState", () => {
  it("keeps the current attributes when none are given", async () => {
    const { handle, seen } = await handleOver({ unit_of_measurement: "C" });
    await handle.setState("sensor.temp", "22");
    expect(seen.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/states/sensor.temp",
      body: { state: "22", attributes: { unit_of_measurement: "C" } },
    });
  });

  it("replaces the attributes when they are given, without reading first", async () => {
    const { handle, seen } = await handleOver({ unit_of_measurement: "C" });
    await handle.setState("sensor.temp", "22", { unit_of_measurement: "F" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "POST",
      body: { state: "22", attributes: { unit_of_measurement: "F" } },
    });
  });

  it("starts an unknown entity with no attributes", async () => {
    const { handle, seen } = await handleOver(null);
    await handle.setState("sensor.new", "1");
    expect(seen.at(-1)).toMatchObject({
      method: "POST",
      body: { state: "1", attributes: {} },
    });
  });
});
