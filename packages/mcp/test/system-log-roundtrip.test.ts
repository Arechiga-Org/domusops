import {
  expandSystemLog,
  type SystemLogRecord,
  type SystemLogStandardDocument,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import type { RawLogEntry } from "../src/ha/system-log.js";
import { formatLocalIso } from "../src/logbook/local-time.js";
import { redactText } from "../src/snapshot/redact.js";
import { encodeStandardSystemLog } from "../src/system-log/encode-standard.js";
import {
  classify,
  customIntegrations,
  prepareEntry,
  selectEntries,
} from "../src/system-log/entries.js";
import { systemLogFrame } from "../src/system-log/envelope.js";
import { rootPaths } from "../src/system-log/paths.js";
import {
  CONFIG_DIR,
  LOG_NOW_MS,
  REFERENCE_SYSTEM_LOG,
} from "./fixtures/generate-system-log.js";
import { FAKE_TOKEN } from "./support/fake-ha.js";

/**
 * Encode, then decode with `expandSystemLog`: every entry comes back with its fields and its
 * traceback text, re-rooted and redacted, times to the second (specs/012-ha-system-log FR-016,
 * SC-002).
 */

const TIME_ZONE = "Europe/Madrid";
const roots = rootPaths(CONFIG_DIR);
const redact = redactText({
  token: FAKE_TOKEN,
  coordinates: { latitude: 40.4168, longitude: -3.7038 },
});

function roundTrip(log: RawLogEntry[], integrations?: string[]) {
  const selected = selectEntries(log.map(classify), {
    ...(integrations === undefined ? {} : { integrations }),
  });
  const frame = systemLogFrame({
    detail: "standard",
    haVersion: "2026.10.0",
    timeZone: TIME_ZONE,
    nowMs: LOG_NOW_MS,
    custom: customIntegrations(selected),
  });
  const document = JSON.parse(
    JSON.stringify(
      encodeStandardSystemLog(
        frame,
        selected.map((e) => prepareEntry(e, roots, redact)),
      ),
    ),
  ) as SystemLogStandardDocument;
  const local = (seconds: number): string =>
    formatLocalIso(Math.floor(seconds) * 1000, TIME_ZONE, null);
  const expected: SystemLogRecord[] = selected.map((e) => {
    const { raw } = e;
    return {
      level: e.level,
      logger: raw.name,
      integration: e.integration?.domain ?? null,
      integration_from:
        e.integration === null
          ? null
          : e.integration.bySource
            ? "source"
            : "logger",
      custom: e.integration?.custom === true,
      source: {
        file: raw.source[0].startsWith("/")
          ? roots(raw.source[0])
          : raw.source[0],
        line: raw.source[1],
      },
      count: raw.count,
      first_occurred: local(raw.first_occurred),
      last_occurred: local(raw.timestamp),
      messages: raw.message.map((m) => redact(roots(m))),
      traceback: raw.exception === "" ? null : redact(roots(raw.exception)),
    };
  });
  return { decoded: expandSystemLog(document), expected };
}

const log = REFERENCE_SYSTEM_LOG.systemLog;

describe("the system log round trip", () => {
  it.each([
    ["the reference log", undefined],
    ["one built-in integration", ["mqtt"]],
    ["one custom integration", ["acme_cloud"]],
    ["a pattern over several integrations", ["*_hub", "gizmo", "hue*"]],
  ])("restores %s exactly", (_, integrations) => {
    const { decoded, expected } = roundTrip(log, integrations);
    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded).toEqual(expected);
  });

  it("restores the entries with no integration", () => {
    const none = log.filter((e) => classify(e).integration === null);
    expect(none.length).toBeGreaterThan(1);
    const { decoded, expected } = roundTrip(none);
    expect(decoded).toEqual(expected);
  });

  it("restores a chained traceback, a template frame and five messages", () => {
    const special = log.filter(
      (e) =>
        e.exception.includes("direct cause") ||
        e.exception.includes("<template>") ||
        e.message.length === 5,
    );
    expect(special.length).toBeGreaterThanOrEqual(3);
    const { decoded, expected } = roundTrip(special);
    expect(decoded).toEqual(expected);
    expect(decoded.some((r) => r.traceback?.includes("<template>"))).toBe(true);
    expect(decoded.some((r) => r.messages.length === 5)).toBe(true);
  });

  it("never restores a host path of the three roots", () => {
    const { decoded } = roundTrip(log);
    const text = JSON.stringify(decoded);
    for (const root of [
      "/config/",
      "/usr/src/homeassistant/",
      "/usr/local/lib/python",
    ]) {
      expect(text).not.toContain(root);
    }
  });
});
