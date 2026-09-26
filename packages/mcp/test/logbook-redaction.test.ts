import { afterEach, describe, expect, it } from "vitest";
import { runLogbookQuery } from "../src/tools/ha-logbook-query.js";
import { LOGBOOK_EXEMPT_KEYS, redactRows } from "../src/snapshot/redact.js";
import type { Fixture } from "./fixtures/generate.js";
import redactionFixture from "./fixtures/logbook-redaction.json" with { type: "json" };
import { startFakeHa, type FakeHa } from "./support/fake-ha.js";

const fixture = redactionFixture as unknown as Fixture & {
  token: string;
  window: { start: number; end: number };
  expected_absent: string[];
  expected_present: string[];
};

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function query(
  options: Parameters<typeof runLogbookQuery>[1] = {},
): Promise<string> {
  const ha = await startFakeHa({ fixture, token: fixture.token });
  running.push(ha);
  return runLogbookQuery(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: fixture.token },
    { now: fixture.window.end * 1000, ...options },
  );
}

/** True when any run of `length` characters of `secret` occurs in `text`. */
function leaksFragment(text: string, secret: string, length = 6): string | null {
  for (let i = 0; i + length <= secret.length; i++) {
    const fragment = secret.slice(i, i + length);
    if (text.includes(fragment)) return fragment;
  }
  return null;
}

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

  it("keeps identifiers, including secret-shaped ones, and marks redacted values", async () => {
    const text = await query();
    for (const id of fixture.expected_present) expect(text).toContain(id);
    expect(text).toContain("[redacted]");
  });

  it("keeps the redacted fields present, so the agent knows a value existed (FR-012)", async () => {
    const text = await query();
    const marker = "[redacted]";
    // The credential-named field and the coordinate fields survive as columns holding the marker.
    expect(text).toContain("access_token");
    expect(text).toContain("latitude");
    expect(text.split(marker).length - 1).toBeGreaterThanOrEqual(8);
  });

  it("redacts the same way for a narrowed query", async () => {
    const text = await query({ entities: ["automation.*"] });
    for (const secret of fixture.expected_absent) {
      expect(leaksFragment(text, secret)).toBeNull();
    }
  });
});

describe("redactRows with the logbook exempt keys", () => {
  const redact = (row: Record<string, unknown>) =>
    redactRows([{ when: 1, ...row }], {
      token: "",
      exemptKeys: LOGBOOK_EXEMPT_KEYS,
    })[0] as Record<string, unknown>;

  it("never touches an identifier, even one that looks like a secret", () => {
    const row = redact({
      entity_id: "sensor.token_a1b2c3d4e5f6",
      context_entity_id: "automation.password_x9y8z7w6",
      context_user_id: "0123456789abcdef0123456789abcdef",
      context_id: "01KKMXPYK4QW7ER9TY2MN4BV8C",
    });
    expect(row["entity_id"]).toBe("sensor.token_a1b2c3d4e5f6");
    expect(row["context_entity_id"]).toBe("automation.password_x9y8z7w6");
    expect(row["context_user_id"]).toBe("0123456789abcdef0123456789abcdef");
    expect(row["context_id"]).toBe("01KKMXPYK4QW7ER9TY2MN4BV8C");
  });

  it("redacts credential-named keys, keeping the field", () => {
    expect(redact({ access_token: "x".repeat(30) })["access_token"]).toBe("[redacted]");
  });
});
