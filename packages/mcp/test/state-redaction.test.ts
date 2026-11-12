import { afterEach, describe, expect, it } from "vitest";
import { queryState } from "../src/tools/ha-state.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";
import { BASE_MS, fixtureOf, stateOf } from "./support/states.js";

/**
 * Every redaction rule seeded into entity attributes and states is applied, and names stay
 * (specs/010-ha-state FR-010, FR-011, SC-005, research R7). Every value is synthetic; the
 * instance's own coordinates are those of the reference fixture's config.
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
  ownLatitude: "52.3731",
  ownLongitude: "4.8922",
  otherLatitude: "48.858370",
  otherLongitude: "-74.044502",
};

const USER_ID = "b2c3d4e5f60718293a4b5c6d7e8f9012";

const SEEDED = fixtureOf([
  stateOf("camera.porch", "idle", {
    access_token: SECRETS.credentialKey,
    entity_picture: `/api/camera_proxy/camera.porch?token=${SECRETS.queryToken}`,
    stream_source: `rtsp://viewer:${SECRETS.urlPassword}@cam.example.invalid/stream`,
    friendly_name: "Porch camera",
  }),
  stateOf("sensor.last_message", SECRETS.email, {
    detail: `Authorization: Bearer ${SECRETS.bearer}`,
    raw: SECRETS.jwt,
    note: `configured with ${FAKE_TOKEN}`,
  }),
  stateOf("device_tracker.phone", "home", {
    latitude: Number(SECRETS.ownLatitude),
    longitude: Number(SECRETS.ownLongitude),
    gps: [Number(SECRETS.otherLatitude), 2.294481],
    last_seen_at: `pinned at ${SECRETS.otherLatitude}, ${SECRETS.otherLongitude}`,
    home_text: `home is ${SECRETS.ownLatitude} north`,
  }),
  stateOf(
    "person.resident",
    "home",
    {
      friendly_name: "Synthetic Resident",
      user_id: USER_ID,
      device_trackers: ["device_tracker.phone"],
    },
    { user: USER_ID },
  ),
]);

async function text(detail: "standard" | "summary"): Promise<string> {
  const ha = await startFakeHa({ fixture: SEEDED });
  cleanups.push(() => ha.close());
  const { document } = await queryState(
    { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
    { detail, now: BASE_MS },
  );
  return document;
}

describe("ha_state redaction", () => {
  it.each(["standard", "summary"] as const)(
    "leaves no seeded secret, e-mail address or coordinate at %s (SC-005)",
    async (detail) => {
      const document = await text(detail);
      for (const [rule, secret] of Object.entries(SECRETS)) {
        expect(document, rule).not.toContain(secret);
      }
      expect(document).not.toContain(FAKE_TOKEN);
    },
  );

  it("keeps the redacted fields, so the agent sees that a value existed (FR-010)", async () => {
    const document = await text("standard");
    for (const key of ["access_token", "latitude", "longitude", "gps"]) {
      expect(document).toContain(`"${key}"`);
    }
    expect(document).toContain("[redacted]");
  });

  it("keeps names, user IDs and entity IDs (FR-011)", async () => {
    const document = await text("standard");
    expect(document).toContain("Synthetic Resident");
    expect(document).toContain("Porch camera");
    expect(document).toContain(USER_ID);
    expect(document).toContain("device_tracker.phone");
  });
});
