import { afterEach, describe, expect, it } from "vitest";
import type { HistoryStandardDocument } from "@domusops/schema";
import { queryHistory } from "../src/tools/ha-history.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";
import { historyFixture, NOW_MS, timeline, WINDOW } from "./support/history.js";

/**
 * Every redaction rule seeded into attributes across many changes is applied in every change, and
 * names stay (specs/011-ha-history FR-009, SC-004, research R8). Every value is synthetic; the
 * instance's own coordinates are those of the reference history's config.
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const SECRETS = {
  credentialKey: "zq8Xk2Lm9Pq4Rt7Vw1Yb3Nc5",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlLXN5bnRoZXRpYw",
  bearer: "synthBearerValue12345",
  urlPassword: "camPassw0rdSynth",
  queryToken: "qryTokSynth9876",
  email: "resident.synthetic@example.invalid",
  ownLatitude: "41.385064",
  ownLongitude: "2.173404",
  otherLatitude: "48.858370",
  otherLongitude: "-74.044502",
};

/** A step every ten minutes; `n` makes every change differ. */
const steps = <T>(build: (n: number) => T): [number, number, T][] =>
  Array.from({ length: 8 }, (_, n) => [n * 600 - 300, n, build(n)]);

const SEEDED = historyFixture({
  "camera.porch": timeline(
    steps((n) => ({
      access_token: `${SECRETS.credentialKey}${n}`,
      entity_picture: `/api/camera_proxy/camera.porch?token=${SECRETS.queryToken}${n}`,
      stream_source: `rtsp://viewer:${SECRETS.urlPassword}@cam.example.invalid/stream`,
      friendly_name: "Porch camera",
      frames: n,
    })).map(([at, , attributes]) => [at, "idle", attributes]),
  ),
  "sensor.last_message": timeline(
    steps((n) => ({
      detail: `Authorization: Bearer ${SECRETS.bearer}`,
      nested: {
        deeper: { raw: SECRETS.jwt, note: `configured with ${FAKE_TOKEN}` },
      },
      count: n,
    })).map(([at, n, attributes]) => [
      at,
      n % 2 === 0 ? SECRETS.email : "none",
      attributes,
    ]),
  ),
  "device_tracker.phone": timeline(
    steps((n) => ({
      latitude: Number(SECRETS.otherLatitude) + n / 1000,
      longitude: Number(SECRETS.otherLongitude) - n / 1000,
      gps: [Number(SECRETS.ownLatitude), Number(SECRETS.ownLongitude)],
      last_seen_at: `pinned at ${SECRETS.otherLatitude}, ${SECRETS.otherLongitude}`,
      home_text: `home is ${SECRETS.ownLatitude} north`,
      battery_level: 90 - n,
      friendly_name: "Synthetic Resident phone",
    })).map(([at, , attributes]) => [at, "home", attributes]),
  ),
  "person.resident": timeline([
    [-600, "home", { friendly_name: "Synthetic Resident" }],
    [600, "not_home", { friendly_name: "Synthetic Resident" }],
  ]),
});

async function document(): Promise<string> {
  const ha = await startFakeHa({ fixture: SEEDED });
  cleanups.push(() => ha.close());
  return (
    await queryHistory(
      { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
      { ...WINDOW, now: NOW_MS },
    )
  ).document;
}

describe("ha_history redaction", () => {
  it("leaves no seeded secret, e-mail address or coordinate in any change (SC-004)", async () => {
    const text = await document();
    for (const [rule, secret] of Object.entries(SECRETS)) {
      expect(text, rule).not.toContain(secret);
    }
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).toContain("[redacted]");
  });

  it("does not repeat a moving tracker's redacted coordinates", async () => {
    const parsed = JSON.parse(await document()) as HistoryStandardDocument;
    const rows = Object.values(
      parsed.entities["device_tracker.phone"]?.changes ?? {},
    ).flatMap((hours) => Object.values(hours).flat());
    expect(rows.length).toBe(7);
    for (const row of rows) {
      expect(row[2]).toEqual({ battery_level: expect.any(Number) as number });
    }
  });

  it("keeps names and entity IDs", async () => {
    const text = await document();
    expect(text).toContain("Synthetic Resident");
    expect(text).toContain("Porch camera");
    expect(text).toContain("device_tracker.phone");
  });
});
