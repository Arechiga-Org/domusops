import { expandTrace, type TraceStandardDocument } from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { runTrace } from "../src/tools/ha-trace.js";
import type { Fixture } from "./fixtures/generate.js";
import redactionFixture from "./fixtures/trace-redaction.json" with { type: "json" };
import { startFakeHa, type FakeHa } from "./support/fake-ha.js";

const fixture = redactionFixture as unknown as Fixture & {
  token: string;
  windowEnd: number;
  traces: unknown[];
  expected_absent: string[];
  expected_present: string[];
};

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function query(
  options: Parameters<typeof runTrace>[1] = {},
): Promise<string> {
  const ha = await startFakeHa({ fixture, token: fixture.token });
  running.push(ha);
  return runTrace(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: fixture.token },
    { now: fixture.windowEnd * 1000, ...options },
  );
}

/** True when any run of `length` characters of `secret` occurs in `text`. */
function leaksFragment(
  text: string,
  secret: string,
  length = 6,
): string | null {
  for (let i = 0; i + length <= secret.length; i++) {
    const fragment = secret.slice(i, i + length);
    if (text.includes(fragment)) return fragment;
  }
  return null;
}

describe("the oracle is not vacuous", () => {
  it("finds every planted value in the raw records the instance serves", () => {
    const raw = JSON.stringify(fixture.traces);
    for (const secret of fixture.expected_absent) {
      expect(raw, `${secret.slice(0, 12)}… is not planted`).toContain(secret);
    }
  });
});

describe("redaction oracle: no fragment of six or more characters of a planted value", () => {
  it("holds at detail=standard", async () => {
    const text = await query();
    for (const secret of fixture.expected_absent) {
      expect(
        leaksFragment(text, secret),
        `a fragment of ${secret.slice(0, 12)}… leaked`,
      ).toBeNull();
    }
  });

  it("holds for a single run, and for a context lookup", async () => {
    for (const options of [
      { run: "a1b2c3d4e5f60718293a4b5c6d7e8f90" },
      { entities: ["automation.*"] },
      { entities: ["script.*"] },
    ]) {
      const text = await query(options);
      for (const secret of fixture.expected_absent) {
        expect(leaksFragment(text, secret)).toBeNull();
      }
    }
  });

  it("keeps identifiers, including secret-shaped ones, and marks redacted values", async () => {
    const text = await query();
    for (const id of fixture.expected_present) expect(text).toContain(id);
    expect(text).toContain("[redacted]");
  });

  it("keeps the redacted fields present, so the agent knows a value existed (User Story 2, scenario 4)", async () => {
    const doc = JSON.parse(await query()) as TraceStandardDocument;
    const [run] = expandTrace(doc).filter((r) => r.domain === "automation");
    const config = run?.config as {
      actions: { data: Record<string, unknown> }[];
    };
    expect(config.actions[1]?.data["api_key"]).toBe("[redacted]");
    expect(run?.blueprint_inputs).toMatchObject({ password: "[redacted]" });
    const vars = run?.trace["trigger/0"]?.[0]?.changed_variables as {
      trigger: { to_state: { attributes: Record<string, unknown> } };
      this: { attributes: Record<string, unknown> };
    };
    expect(vars.trigger.to_state.attributes["latitude"]).toBe("[redacted]");
    expect(vars.this.attributes["webhook_secret"]).toBe("[redacted]");
  });

  it("redacts inside larger values, keeping the text around them", async () => {
    const doc = JSON.parse(await query()) as TraceStandardDocument;
    const [run] = expandTrace(doc).filter((r) => r.domain === "automation");
    const step = run?.trace["action/0"]?.[0];
    const message = (
      step?.result as { params: { service_data: { message: string } } }
    ).params.service_data.message;
    expect(message).toContain("?token=[redacted]");
    expect(message).toContain(
      "See http://192.168.1.20:8123/api/camera_proxy_stream/camera.porch",
    );
    expect(step?.template_errors?.[0]).toContain("?api_key=[redacted]");
    expect(run?.error).toBe("Could not notify [redacted] about the door");
  });

  it("keeps the compression tables free of planted values", async () => {
    const doc = JSON.parse(await query()) as TraceStandardDocument;
    const tables = JSON.stringify([
      doc.strings,
      doc.values,
      doc.configs,
      doc.ids,
    ]);
    for (const secret of fixture.expected_absent) {
      expect(leaksFragment(tables, secret)).toBeNull();
    }
  });

  it("does not mistake the fixture's secrets for identifiers: they are absent, not exempt", () => {
    for (const secret of fixture.expected_absent) {
      for (const id of fixture.expected_present) {
        expect(leaksFragment(id, secret)).toBeNull();
      }
    }
  });
});
