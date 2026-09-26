import {
  encodeContextId,
  expandLogbook,
  projectLogbook,
  type LogbookRow,
  type LogbookStandardDocument,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeStandard } from "../src/logbook/encode-standard.js";
import { contextFor } from "./support/logbook.js";
import {
  LOGBOOK_EMPTY,
  PERFORMANCE_LOGBOOK,
  REFERENCE_LOGBOOK_24H,
} from "./fixtures/generate-logbook.js";

const T = Date.UTC(2026, 2, 14, 9, 0, 0) / 1000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(ms: number, tail = "ABCDEFGH12345678"): string {
  let stamp = "";
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    stamp = CROCKFORD.charAt(rest % 32) + stamp;
    rest = Math.floor(rest / 32);
  }
  return stamp + tail;
}

/** Rows that exercise every case of data-model §3, in chronological order. */
const HAND: LogbookRow[] = [
  {
    when: T + 0.25,
    entity_id: "light.a",
    state: "on",
    icon: "mdi:lightbulb",
    context_entity_id: "automation.night",
    context_state: "on",
  },
  // Same second as the previous row: their order must survive.
  { when: T + 0.75, entity_id: "light.a", state: "off", icon: "mdi:lightbulb" },
  {
    when: T + 5.5,
    entity_id: "automation.night",
    name: "Night light",
    message: "triggered by state of hallway motion",
    source: "state of hallway motion",
    domain: "automation",
    context_id: ulid(Math.round((T + 5.5) * 1000) - 3),
  },
  {
    when: T + 9,
    entity_id: "automation.night",
    name: "Night light",
    message: "triggered by time",
    source: "time",
    domain: "automation",
    // 27 s before the event, as measured live.
    context_id: ulid(Math.round((T + 9) * 1000) - 27_000, "ZZZZZZZZZZZZZZZZ"),
  },
  // An entity with one row (no constants), literal number, boolean, object, escaped object.
  {
    when: T + 12,
    entity_id: "sensor.lonely",
    state: "unavailable",
    count: 5,
    available: false,
    attributes: { event_type: "pressed", nested: { deep: [1, 2, 3] } },
    extra: { v: 7 },
    weird: [1, "two", null],
  },
  // A key present in some rows of an entity and absent in others.
  {
    when: T + 14,
    entity_id: "sensor.mixed",
    state: "unavailable",
    icon: "mdi:eye",
  },
  { when: T + 15, entity_id: "sensor.mixed", state: "idle" },
  // A context ID that is not a ULID, one shaped like an encoded one, and a number.
  {
    when: T + 20,
    entity_id: "script.x",
    name: "X",
    domain: "script",
    context_id: "abc-123",
  },
  {
    when: T + 21,
    entity_id: "script.x",
    name: "X",
    domain: "script",
    context_id: "12:ABCDEFGHJKMNPQRS",
  },
  {
    when: T + 22,
    entity_id: "script.x",
    name: "X",
    domain: "script",
    context_id: 5,
  },
  // The same context ID twice for one entity: it is never a constant.
  {
    when: T + 30,
    entity_id: "script.y",
    name: "Y",
    domain: "script",
    context_id: ulid(Math.round((T + 30) * 1000)),
  },
  {
    when: T + 30.5,
    entity_id: "script.y",
    name: "Y",
    domain: "script",
    context_id: ulid(Math.round((T + 30) * 1000)),
  },
  // Events that belong to no entity, sharing constants.
  {
    when: T + 40,
    name: "Home Assistant",
    message: "stopped",
    domain: "homeassistant",
  },
  {
    when: T + 41,
    name: "Home Assistant",
    message: "started",
    domain: "homeassistant",
  },
  // A null-valued key is removed by the projection; a cause with a user and a service.
  {
    when: T + 50,
    entity_id: "light.a",
    state: "on",
    icon: null,
    context_user_id: "0123456789abcdef0123456789abcdef",
    context_domain: "light",
    context_service: "turn_on",
    context_event_type: "call_service",
  },
];

function roundTrip(rows: LogbookRow[]): {
  expanded: LogbookRow[];
  doc: LogbookStandardDocument;
} {
  const window = { start: T - 3600, end: T + 3600 };
  const doc = JSON.parse(
    JSON.stringify(
      encodeStandard(rows, contextFor({ haVersion: "x", window })),
    ),
  ) as LogbookStandardDocument;
  return { expanded: expandLogbook(doc), doc };
}

describe("expandLogbook(standard) equals projectLogbook(rows)", () => {
  it("holds for hand-built rows covering every encoding case", () => {
    const { expanded } = roundTrip(HAND);
    expect(expanded).toEqual(projectLogbook(HAND));
  });

  it.each([
    ["reference", REFERENCE_LOGBOOK_24H],
    ["performance", PERFORMANCE_LOGBOOK],
    ["empty", LOGBOOK_EMPTY],
  ] as const)(
    "holds for the %s fixture, element by element and in order",
    (_name, fixture) => {
      const doc = JSON.parse(
        JSON.stringify(encodeStandard(fixture.logbook, contextFor(fixture))),
      ) as LogbookStandardDocument;
      const expanded = expandLogbook(doc);
      const expected = projectLogbook(fixture.logbook);
      expect(expanded).toHaveLength(expected.length);
      expanded.forEach((row, i) => expect(row).toEqual(expected[i]));
    },
  );

  it("keeps the order of two events in the same second", () => {
    const { expanded } = roundTrip(HAND);
    expect(expanded[0]?.state).toBe("on");
    expect(expanded[1]?.state).toBe("off");
  });

  it("encodes a context ID as an offset and a tail, and never stores one as a constant", () => {
    const { doc } = roundTrip(HAND);
    const y = doc.entities.find((e) => Array.isArray(e) && e[0] === "script.y");
    expect(y).toBeDefined();
    const [, constants, columns] = y as [
      string,
      Record<string, unknown>,
      string[],
    ];
    expect(constants).not.toHaveProperty("context_id");
    expect(columns).toContain("context_id");
    const encoded = encodeContextId(ulid(1_000_000), 999_000);
    expect(encoded).toBe("1000:ABCDEFGH12345678");
  });

  it("wraps a literal number and an object whose only key is v", () => {
    const { doc } = roundTrip(HAND);
    const text = JSON.stringify(doc);
    expect(text).toContain('{"v":5}');
    expect(text).toContain('{"v":{"v":7}}');
  });
});
