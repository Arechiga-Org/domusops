import { afterEach, describe, expect, it } from "vitest";
import { runSnapshot } from "../src/tools/ha-snapshot.js";
import type { Fixture } from "./fixtures/generate.js";
import redactionFixture from "./fixtures/redaction.json" with { type: "json" };
import { startFakeHa, type FakeHa } from "./support/fake-ha.js";

const fixture = redactionFixture as unknown as Fixture & {
  token: string;
  expected_absent: string[];
  expected_present: string[];
};

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

async function snapshot(
  detail?: "summary" | "standard" | "full",
): Promise<string> {
  const ha = await startFakeHa({ fixture, token: fixture.token });
  running.push(ha);
  return runSnapshot(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: fixture.token },
    detail === undefined ? {} : { detail },
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

describe("redaction oracle: no fragment of six or more characters of a planted secret", () => {
  it.each(["summary", "standard", "full"] as const)(
    "holds at detail=%s",
    async (detail) => {
      const text = await snapshot(detail);
      for (const secret of fixture.expected_absent) {
        expect(
          leaksFragment(text, secret),
          `a fragment of ${secret.slice(0, 12)}… leaked`,
        ).toBeNull();
      }
    },
  );

  it("keeps identifiers, including secret-shaped ones, and marks redacted values", async () => {
    const text = await snapshot();
    for (const id of fixture.expected_present) expect(text).toContain(id);
    expect(text).toContain("[redacted]");
  });
});
