import { afterEach, describe, expect, it } from "vitest";
import { errors, ToolError } from "../src/errors.js";
import { HaClient } from "../src/ha/client.js";
import {
  getTraces,
  listTraces,
  MAX_IN_FLIGHT,
  type TraceRef,
} from "../src/ha/trace.js";
import { REFERENCE_TRACES } from "./fixtures/generate-traces.js";
import { FAKE_TOKEN, startFakeHa, type FakeHa } from "./support/fake-ha.js";

const refOf = (record: {
  domain: string;
  item_id: string;
  run_id: string;
}): TraceRef => ({
  domain: record.domain as TraceRef["domain"],
  item_id: record.item_id,
  run_id: record.run_id,
});

const running: FakeHa[] = [];
const clients: HaClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  while (running.length > 0) await running.pop()?.close();
});

describe("getTraces after a failed read (spec FR-001, SC-001)", () => {
  it("starts no further read once one trace/get has failed", async () => {
    const refs = REFERENCE_TRACES.traces.slice(0, 10).map(refOf);
    const failing = refs[2];
    if (failing === undefined) throw new Error("unreachable");
    const ha = await startFakeHa({
      fixture: REFERENCE_TRACES,
      failTraceGet: failing.run_id,
      // The failure is answered at once; every other read is still in flight when it arrives.
      delayMs: 150,
    });
    running.push(ha);
    const client = await HaClient.connect({
      wsUrl: `ws://127.0.0.1:${ha.port}/api/websocket`,
      token: FAKE_TOKEN,
    });
    clients.push(client);

    let error: unknown;
    try {
      await getTraces(client, refs);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).kind).toBe("retrieval_failed");

    // Let the reads that were in flight finish, and any read a worker would still start.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const received = ha.received.filter((type) => type === "trace/get");
    expect(received).toHaveLength(MAX_IN_FLIGHT);
    expect(ha.traceGetsAt).toHaveLength(MAX_IN_FLIGHT);
  });

  it("still reads every trace, in order, when none fails", async () => {
    const refs = REFERENCE_TRACES.traces.slice(0, 10).map(refOf);
    const ha = await startFakeHa({ fixture: REFERENCE_TRACES });
    running.push(ha);
    const client = await HaClient.connect({
      wsUrl: `ws://127.0.0.1:${ha.port}/api/websocket`,
      token: FAKE_TOKEN,
    });
    clients.push(client);
    const records = await getTraces(client, refs);
    expect(records.map((record) => record.run_id)).toEqual(
      refs.map((ref) => ref.run_id),
    );
  });
});

describe("listTraces when several domains fail", () => {
  it("reports the first domain's error, whichever failed first", async () => {
    const stub = {
      haVersion: "2026.10.1",
      command: (type: string, params?: { domain?: string }) =>
        params?.domain === "automation"
          ? // Fails later, with "the trace integration is missing".
            new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(errors.retrievalFailed(type, "unknown_command: nope")),
                60,
              ),
            )
          : // Fails at once, as a user who is not an administrator would.
            Promise.reject(errors.retrievalFailed(type, "unauthorized: no")),
    } as unknown as HaClient;
    let error: unknown;
    try {
      await listTraces(stub, ["automation", "script"]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ kind: "traces_unavailable" });
  });
});
