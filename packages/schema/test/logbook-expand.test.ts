import { describe, expect, it } from "vitest";
import {
  decodeContextId,
  encodeContextId,
  expandLogbook,
  projectLogbook,
  type LogbookStandardDocument,
} from "../src/index.js";

const base = {
  format: "domusops.logbook/0.1",
  detail: "standard",
  ha_version: "2026.9.3",
  compression_ratio: 1,
  time_zone: "America/Mexico_City",
  utc_offset: "-06:00",
  window: { start: "2026-09-26T00:00:00-06:00", end: "2026-09-26T06:00:00-06:00" },
  first: "2026-09-26T03:12:44",
  last: "2026-09-26T04:20:10",
} as const;

// Hand-written, so this test does not depend on the encoder.
const document: LogbookStandardDocument = {
  ...base,
  strings: ["Hallway night light", "automation"],
  entities: [
    ["automation.hallway_night", { name: 0, domain: 1 }, ["context_id"]],
    "light.hallway",
    [null, { name: "Home Assistant", domain: "homeassistant" }, []],
  ],
  causes: [{ event_type: "automation_triggered", domain: 1, name: 0 }],
  events: {
    "2026-09-26": {
      "03:00": [
        ["12:44", 0, null, null, "-3:ZK4M9Q2W7XR5T8BN"],
        ["12:44", 1, "on", 0],
        ["58:02", 1, "off"],
      ],
      "04:00": [["20:10", 2, null, null]],
    },
  },
};

describe("expandLogbook", () => {
  const rows = expandLogbook(document);

  it("restores times from the date, the hour key, and the offset of the document", () => {
    // 03:12:44 at -06:00 is 09:12:44Z.
    expect(rows[0]?.when).toBe(Date.UTC(2026, 8, 26, 9, 12, 44) / 1000);
    expect(rows[2]?.when).toBe(Date.UTC(2026, 8, 26, 9, 58, 2) / 1000);
  });

  it("restores constants, cause fields with their prefix, and string references", () => {
    expect(rows[0]).toMatchObject({
      entity_id: "automation.hallway_night",
      name: "Hallway night light",
      domain: "automation",
    });
    expect(rows[1]).toMatchObject({
      entity_id: "light.hallway",
      state: "on",
      context_event_type: "automation_triggered",
      context_domain: "automation",
      context_name: "Hallway night light",
    });
    expect(rows[2]).toEqual({
      when: Date.UTC(2026, 8, 26, 9, 58, 2) / 1000,
      entity_id: "light.hallway",
      state: "off",
    });
  });

  it("restores a context ID from its offset and tail", () => {
    const id = rows[0]?.["context_id"] as string;
    expect(id).toHaveLength(26);
    expect(id.slice(10)).toBe("ZK4M9Q2W7XR5T8BN");
    const secondMs = Date.UTC(2026, 8, 26, 9, 12, 44);
    expect(encodeContextId(id, secondMs)).toBe("-3:ZK4M9Q2W7XR5T8BN");
    expect(decodeContextId("-3:ZK4M9Q2W7XR5T8BN", secondMs)).toBe(id);
  });

  it("restores an event without an entity", () => {
    expect(rows[3]).toEqual({
      when: Date.UTC(2026, 8, 26, 10, 20, 10) / 1000,
      name: "Home Assistant",
      domain: "homeassistant",
    });
  });

  it("uses the offset of an hour key that carries one", () => {
    const shifted: LogbookStandardDocument = {
      ...base,
      utc_offset: "+02:00",
      entities: ["light.a"],
      events: { "2026-10-25": { "02:00+01:00": [["30:00", 0, "off"]] } },
    };
    expect(expandLogbook(shifted)[0]?.when).toBe(Date.UTC(2026, 9, 25, 1, 30) / 1000);
  });

  it("reads a literal number and an escaped object", () => {
    const literal: LogbookStandardDocument = {
      ...base,
      entities: [["sensor.a", { extra: { v: { v: 7 } } }, ["count"]]],
      events: { "2026-09-26": { "03:00": [["00:01", 0, null, null, { v: 5 }]] } },
    };
    expect(expandLogbook(literal)[0]).toMatchObject({ count: 5, extra: { v: 7 } });
  });
});

describe("projectLogbook", () => {
  it("truncates when to the second and removes null-valued top-level keys", () => {
    expect(
      projectLogbook([
        { when: 10.9, entity_id: "a.b", icon: null, attributes: { keep: null } },
      ]),
    ).toEqual([{ when: 10, entity_id: "a.b", attributes: { keep: null } }]);
  });
});

describe("context IDs", () => {
  it("returns anything that is not a ULID verbatim, wrapping only an encoded-looking string", () => {
    expect(encodeContextId("abc-123", 0)).toBe("abc-123");
    expect(encodeContextId("12:ABCDEFGHJKMNPQRS", 0)).toEqual({ v: "12:ABCDEFGHJKMNPQRS" });
    expect(decodeContextId("abc-123", 0)).toBe("abc-123");
  });
});
