import {
  expandSystemLog,
  REDACTION_MARKER,
  type SystemLogStandardDocument,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { redactText } from "../src/snapshot/redact.js";
import { querySystemLog } from "../src/tools/ha-system-log.js";
import { systemLogFixture } from "./fixtures/generate-system-log.js";
import type { Fixture } from "./fixtures/generate.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";
import { entry, NOW_MS } from "./support/system-log.js";

/**
 * Redaction of log messages and tracebacks (specs/012-ha-system-log FR-009, research R8): the
 * string rules of the other tools, replacing only the matching text.
 */

const M = REDACTION_MARKER;
const TOKEN = "seeded-token-0123456789abcdef";
const redact = redactText({
  token: TOKEN,
  coordinates: { latitude: 40.4168, longitude: -3.7038 },
});

describe("redactText", () => {
  it.each([
    [
      "the configured token",
      `Auth failed with ${TOKEN} on retry`,
      `Auth failed with ${M} on retry`,
    ],
    [
      "URL user info",
      "Cannot reach http://admin:hunter2@192.0.2.5:8080/api",
      `Cannot reach http://admin:${M}@192.0.2.5:8080/api`,
    ],
    [
      "a credential query parameter",
      "GET https://api.example.net/v1/state?api_key=s3cr3tvalue&unit=c failed",
      `GET https://api.example.net/v1/state?api_key=${M}&unit=c failed`,
    ],
    [
      "a JWT",
      "Refused eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl",
      `Refused ${M}`,
    ],
    [
      "a bearer token",
      "Header Authorization: Bearer abcDEF123456789",
      `Header Authorization: Bearer ${M}`,
    ],
    [
      "an e-mail address",
      "Login failed for someone@example.com",
      `Login failed for ${M}`,
    ],
    [
      "a coordinate pair",
      "Position 41.38879, 2.15899 is outside the zone",
      `Position ${M} is outside the zone`,
    ],
    [
      "the instance's own coordinates",
      "Home is at 40.4168 and -3.7038",
      `Home is at ${M} and ${M}`,
    ],
    [
      "a credential in a Python dictionary",
      "Failed to set up: {'host': '192.0.2.5', 'username': 'admin', 'password': 'hunter2'}",
      `Failed to set up: {'host': '192.0.2.5', 'username': 'admin', 'password': '${M}'}`,
    ],
    [
      "a credential keyword argument",
      "connect(host=192.0.2.5, password=hunter2)",
      `connect(host=192.0.2.5, password=${M})`,
    ],
    [
      "a credential in JSON",
      '{"api_key": "abc123", "unit": "c"}',
      `{"api_key": "${M}", "unit": "c"}`,
    ],
    [
      "a credential after a colon",
      "Rejected client_secret: s3cr3t by the server",
      `Rejected client_secret: ${M} by the server`,
    ],
  ])("replaces %s inside a message", (_, text, expected) => {
    expect(redact(text)).toBe(expected);
  });

  it("leaves a value another rule already replaced as one marker", () => {
    expect(redact("GET /x?token=abc and Authorization: Bearer abc123")).toBe(
      `GET /x?token=${M} and Authorization: Bearer ${M}`,
    );
  });

  it("replaces a seeded value inside a traceback line and keeps the frame", () => {
    const text = [
      '  File "{config}/custom_components/acme_cloud/api.py", line 41, in login',
      `    raise AuthError("bad credentials for someone@example.com")`,
      `acme.AuthError: token ${TOKEN} refused`,
    ].join("\n");
    expect(redact(text)).toBe(
      [
        '  File "{config}/custom_components/acme_cloud/api.py", line 41, in login',
        `    raise AuthError("bad credentials for ${M}")`,
        `acme.AuthError: token ${M} refused`,
      ].join("\n"),
    );
  });

  it.each([
    [
      "a file path and line number",
      '  File "{ha}/core.py", line 1012, in _run_safely',
    ],
    ["an IP address", "Connect call failed ('192.0.2.5', 80)"],
    ["a dotted version", "Requires aiohttp 3.10.11 or later"],
    ["a logger name", "homeassistant.components.mqtt.client"],
  ])("leaves %s as it is", (_, text) => {
    expect(redact(text)).toBe(text);
  });
});

describe("ha_system_log on a seeded log (SC-004)", () => {
  const HOME = "/home/hostuser";
  const CONFIG = `${HOME}/.homeassistant`;
  const VENV = `${HOME}/venv/lib/python3.13`;
  const SEEDS = {
    token: FAKE_TOKEN,
    urlPassword: "hunter2pass",
    query: "s3cr3tquery",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWVkIn0.c2VlZHNpZ25hdHVyZQ",
    bearer: "seededBearer0123456789",
    email: "owner@example.org",
    pair: "41.38879, 2.15899",
    own: "40.4168",
  };
  const frames = [
    [
      `${VENV}/site-packages/homeassistant/helpers/update_coordinator.py`,
      380,
      "update_coordinator.py",
    ],
    [`${CONFIG}/custom_components/acme_cloud/api.py`, 41, "api.py"],
    [`${VENV}/site-packages/aiohttp/client.py`, 703, "client.py"],
    [`${VENV}/asyncio/tasks.py`, 507, "tasks.py"],
  ] as const;
  const traceback = [
    "Traceback (most recent call last):",
    ...frames.map(
      ([path, line]) =>
        `  File "${path}", line ${line}, in run\n    await go("${SEEDS.email}")`,
    ),
    `acme.AuthError: http://admin:${SEEDS.urlPassword}@192.0.2.5/x?token=${SEEDS.query} Bearer ${SEEDS.bearer} ${SEEDS.jwt}`,
  ].join("\n");
  const messages = [
    `Login with ${SEEDS.token} failed for ${SEEDS.email}`,
    `Position ${SEEDS.pair} is outside home at ${SEEDS.own}, -3.7038`,
    `Config ${CONFIG}/packages/heating.yaml could not be read`,
  ];
  const log = Array.from({ length: 6 }, (_, i) =>
    entry({
      name: i % 2 === 0 ? "custom_components.acme_cloud" : "pyacme.client",
      source: ["custom_components/acme_cloud/api.py", 41 + i],
      last: `2026-11-13T09:0${i}:00`,
      message: [messages[i % 3] as string],
      exception: traceback,
    }),
  );
  const fixture = (): Fixture => {
    const base = systemLogFixture(log);
    return {
      ...base,
      records: {
        ...base.records,
        config: { ...base.records.config, config_dir: CONFIG },
      },
    };
  };

  it("leaves no seeded value or root, and keeps every file name and line", async () => {
    const ha = await startFakeHa({ fixture: fixture() });
    try {
      const { document } = await querySystemLog(
        { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
        { now: NOW_MS },
      );
      for (const seed of Object.values(SEEDS)) {
        expect(document).not.toContain(seed);
      }
      for (const root of [
        HOME,
        "hostuser",
        "/lib/python3.13/",
        "/site-packages/homeassistant/",
      ]) {
        expect(document).not.toContain(root);
      }
      for (const [, line, name] of frames) {
        expect(document).toContain(name);
        expect(document).toContain(`${line},`);
      }
      const records = expandSystemLog(
        JSON.parse(document) as SystemLogStandardDocument,
      );
      expect(records).toHaveLength(6);
      expect(records[0]?.traceback).toContain(
        '  File "{ha}/helpers/update_coordinator.py", line 380, in run',
      );
      expect(records[0]?.traceback).toContain(
        '  File "{config}/custom_components/acme_cloud/api.py", line 41, in run',
      );
      expect(records[0]?.traceback).toContain(
        '  File "{python}/site-packages/aiohttp/client.py", line 703, in run',
      );
      expect(records[2]?.messages).toEqual([
        "Config {config}/packages/heating.yaml could not be read",
      ]);
      expect(records.map((r) => r.integration)).toEqual(
        Array(6).fill("acme_cloud"),
      );
      expect(records.map((r) => r.logger)).toEqual([
        "custom_components.acme_cloud",
        "pyacme.client",
        "custom_components.acme_cloud",
        "pyacme.client",
        "custom_components.acme_cloud",
        "pyacme.client",
      ]);
    } finally {
      await ha.close();
    }
  });
});
