import {
  decodeValue,
  parseIsoMicros,
  type DecodeBases,
  type JsonObject,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import {
  buildTables,
  encodeValue,
  encodeVariables,
  type EncodeAnchor,
} from "../src/trace/values.js";

const START = parseIsoMicros("2026-03-14T10:00:03.500000+00:00") as number;
const anchor: EncodeAnchor = { startMicros: START };
const ULID = "01KMNPQRSTVWXYZ0123456789A";
const EMPTY = { strings: [], values: [] };

/** Through JSON, as the wire carries it. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const roundTrip = (
  value: unknown,
  a: EncodeAnchor | null = anchor,
  bases: DecodeBases = {},
): unknown => decodeValue(wire(encodeValue(value, a)), a, EMPTY, bases);

const state = (over: Record<string, unknown> = {}): JsonObject => ({
  entity_id: "light.hallway_lamp",
  state: "on",
  attributes: { brightness: 10, friendly_name: "Hallway lamp" },
  last_changed: "2026-03-14T10:00:00.123456+00:00",
  last_reported: "2026-03-14T10:00:00.123456+00:00",
  last_updated: "2026-03-14T10:00:00.123456+00:00",
  context: { id: ULID, parent_id: null, user_id: null },
  ...over,
});

describe("timestamps (data-model §3.2)", () => {
  it("encodes a canonical timestamp as milliseconds from the run's start", () => {
    expect(encodeValue("2026-03-14T10:00:03.500000+00:00", anchor)).toBe("@0");
    expect(encodeValue("2026-03-14T10:00:04+00:00", anchor)).toBe("@500");
    expect(encodeValue("2026-03-14T10:00:00.123456+00:00", anchor)).toBe(
      "@-3376.544",
    );
  });

  it.each([
    "2026-03-14T10:00:03.500000+00:00",
    "2026-03-14T10:00:04+00:00",
    "2026-03-14T10:00:00.123456+00:00",
    "2026-03-13T10:00:03.999999+00:00",
  ])("decodes %s back to exactly the same string", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it.each([
    "2026-03-14T10:00:03Z",
    "2026-03-14T10:00:03.1234567+00:00",
    "2026-03-14T10:00:03.500000+01:00",
    "2026-03-14",
    "2026-03-14T10:00:03.000000+00:00",
    "2026-02-31T10:00:03+00:00",
  ])("keeps %s as a literal", (text) => {
    expect(encodeValue(text, anchor)).toBe(text);
    expect(roundTrip(text)).toBe(text);
  });

  it("never encodes a timestamp in an unanchored position", () => {
    const config = { at: "2026-03-14T10:00:03.500000+00:00", id: ULID };
    expect(encodeValue(config, null)).toEqual(config);
    expect(roundTrip(config, null)).toEqual(config);
  });
});

describe("context IDs", () => {
  it("encodes a ULID in the compact form, anchored to the run's second", () => {
    const encoded = encodeValue(ULID, anchor) as string;
    expect(encoded).toMatch(/^-?\d+:[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(encoded.endsWith(ULID.slice(10))).toBe(true);
    expect(roundTrip(ULID)).toBe(ULID);
  });

  it("keeps an ID that is not a ULID verbatim", () => {
    expect(roundTrip("a-plain-context-id")).toBe("a-plain-context-id");
    expect(encodeValue("a-plain-context-id", anchor)).toBe(
      "a-plain-context-id",
    );
  });
});

describe("escapes", () => {
  it.each([
    "#3",
    "@5",
    "12:0123456789ABCDEF",
    { $: 1 },
    { S: 1 },
    { D: [] },
    { C: [1] },
    { v: 1 },
  ])("decodes %j to itself", (literal) => {
    expect(roundTrip(literal)).toEqual(literal);
    expect(roundTrip({ inner: literal })).toEqual({ inner: literal });
    expect(roundTrip([literal])).toEqual([literal]);
  });

  it("escapes a variables object whose only key is reserved", () => {
    const variables = { v: 5 };
    const encoded = wire(encodeVariables(variables, anchor, null));
    expect(decodeValue(encoded, anchor, EMPTY)).toEqual(variables);
  });
});

describe("state and context objects", () => {
  it("encodes a state as an S form with 0 for equal timestamps", () => {
    const encoded = encodeValue(state(), anchor) as { S: unknown[] };
    expect(Object.keys(encoded)).toEqual(["S"]);
    expect(encoded.S).toHaveLength(7);
    expect(encoded.S[4]).toBe(0);
    expect(encoded.S[5]).toBe(0);
    expect(roundTrip(state())).toEqual(state());
  });

  it("keeps distinct last_updated and last_reported", () => {
    const changed = state({
      last_updated: "2026-03-14T10:00:00.223456+00:00",
      last_reported: "2026-03-14T10:00:00.923456+00:00",
    });
    expect(roundTrip(changed)).toEqual(changed);
  });

  it.each([
    ["an extra key", state({ extra: 1 })],
    ["a numeric state", state({ state: 3 })],
    [
      "a missing context",
      Object.fromEntries(
        Object.entries(state()).filter(([key]) => key !== "context"),
      ),
    ],
  ])("leaves a state object with %s a plain object", (_name, value) => {
    const encoded = encodeValue(value, anchor) as JsonObject;
    expect(Object.keys(encoded)).not.toContain("S");
    expect(roundTrip(value)).toEqual(value);
  });

  it("encodes a context object as a C form", () => {
    const context = { id: ULID, parent_id: ULID, user_id: "abc123" };
    const encoded = encodeValue(context, anchor) as { C: unknown[] };
    expect(Object.keys(encoded)).toEqual(["C"]);
    expect(roundTrip(context)).toEqual(context);
  });
});

describe("state deltas", () => {
  it("expresses `this` against the item's template", () => {
    const template = {
      entity_id: "automation.night",
      attributes: { mode: "single", friendly_name: "Night" },
    };
    const value = state({
      entity_id: "automation.night",
      attributes: { mode: "single", friendly_name: "Night", current: 0 },
    });
    const encoded = wire(
      encodeVariables({ this: value }, anchor, template),
    ) as { this: { D: unknown[] } };
    expect(encoded.this.D[0]).toBe("this");
    expect(encoded.this.D[2]).toEqual({ current: 0 });
    expect(encoded.this.D[3]).toEqual([]);
    const decoded = decodeValue(encoded, anchor, EMPTY, {
      this: { entity_id: template.entity_id, attributes: template.attributes },
    });
    expect(decoded).toEqual({ this: value });
  });

  it("uses the plain form when the entity differs from the template's", () => {
    const template = { entity_id: "automation.night", attributes: {} };
    const encoded = wire(encodeVariables({ this: state() }, anchor, template));
    expect(Object.keys((encoded as { this: object }).this)).toEqual(["S"]);
  });

  it("expresses a trigger's to_state against its from_state, with removals", () => {
    const from = state({ attributes: { brightness: 10, effect: "none" } });
    const to = state({
      state: "off",
      attributes: { brightness: 0 },
      last_changed: "2026-03-14T10:00:03.400000+00:00",
      last_updated: "2026-03-14T10:00:03.400000+00:00",
      last_reported: "2026-03-14T10:00:03.400000+00:00",
    });
    const trigger = { platform: "state", from_state: from, to_state: to };
    const encoded = wire(encodeVariables({ trigger }, anchor, null)) as {
      trigger: { to_state: { D: unknown[] } };
    };
    expect(encoded.trigger.to_state.D[0]).toBe("from");
    expect(encoded.trigger.to_state.D[2]).toEqual({ brightness: 0 });
    expect(encoded.trigger.to_state.D[3]).toEqual(["effect"]);
    expect(decodeValue(encoded, anchor, EMPTY)).toEqual({ trigger });
  });

  it("uses the plain form when the two states are of different entities", () => {
    const trigger = {
      from_state: state(),
      to_state: state({ entity_id: "light.other" }),
    };
    const encoded = wire(encodeVariables({ trigger }, anchor, null)) as {
      trigger: { to_state: object };
    };
    expect(Object.keys(encoded.trigger.to_state)).toEqual(["S"]);
  });
});

describe("tables (data-model §3.2)", () => {
  const root = (value: unknown, replaceTop = false) => ({ value, replaceTop });
  const tablesOf = (values: unknown[]) => {
    const t = buildTables(values.map((v) => root(v)));
    return {
      ...t,
      decode: (i: number) => decodeValue(wire(t.roots[i]), null, t),
    };
  };

  it("puts a string of at least 6 characters that occurs twice in `strings`", () => {
    const t = tablesOf([
      { a: "binary_sensor.hall", b: "binary_sensor.hall", c: "short" },
    ]);
    expect(t.strings).toEqual(["binary_sensor.hall"]);
    expect(t.roots[0]).toEqual({ a: "#0", b: "#0", c: "short" });
  });

  it("leaves a string that occurs once, and one shorter than 6 characters", () => {
    const t = tablesOf([{ a: "only once here", b: "abc", c: "abc" }]);
    expect(t.strings).toEqual([]);
  });

  it("sorts strings by descending count, then code point", () => {
    const t = tablesOf([
      [
        "bbbbbbb",
        "aaaaaaa",
        "aaaaaaa",
        "ccccccc",
        "ccccccc",
        "bbbbbbb",
        "ccccccc",
      ],
    ]);
    expect(t.strings).toEqual(["ccccccc", "aaaaaaa", "bbbbbbb"]);
  });

  it("puts a repeated subtree of at least 16 bytes in `values`", () => {
    const shared = { service: "turn_on", data: { brightness: 40 } };
    const t = tablesOf([{ one: shared }, { two: shared }]);
    expect(t.values).toHaveLength(1);
    expect(t.roots[0]).toEqual({ one: { $: 0 } });
    expect(t.decode(1)).toEqual({ two: shared });
  });

  it("does not table a small subtree", () => {
    const t = tablesOf([{ a: { x: 1 } }, { b: { x: 1 } }]);
    expect(t.values).toEqual([]);
  });

  it("orders entries children before parents and never references forward", () => {
    const inner = { name: "the inner subtree", n: [1, 2, 3, 4] };
    const outer = { inner, other: "something different" };
    const t = tablesOf([{ a: outer, b: outer, c: inner }]);
    t.values.forEach((entry, at) => {
      const refs = [...JSON.stringify(entry).matchAll(/"\$":(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      for (const ref of refs) expect(ref).toBeLessThan(at);
    });
    expect(t.decode(0)).toEqual({ a: outer, b: outer, c: inner });
  });

  it("counts a subtree inside a repeated subtree once", () => {
    const inner = { name: "the inner subtree", n: [1, 2, 3, 4] };
    const outer = { inner, other: "something different" };
    const t = tablesOf([[outer, outer]]);
    // Only the outer subtree is repeated in the output; the inner one lives inside its entry.
    expect(t.values).toHaveLength(1);
  });

  it("does not replace the top of a root unless it may be", () => {
    const shared = { service: "turn_on", data: { brightness: 40 } };
    const kept = buildTables([root(shared, false), root(shared, false)]);
    expect(kept.values).toEqual([]);
    expect(Object.keys(kept.roots[0] as object)).toEqual(["service", "data"]);
    const replaced = buildTables([root(shared, true), root(shared, true)]);
    expect(replaced.roots).toEqual([{ $: 0 }, { $: 0 }]);
  });

  it("never replaces the array of a form or a `v` literal", () => {
    const form = {
      S: [
        "light.hallway_lamp",
        "on",
        { a: "repeated string value" },
        0,
        0,
        0,
        null,
      ],
    };
    const t = buildTables([
      root([form, form, { v: "@repeated string value" }]),
    ]);
    for (const entry of [...t.values, ...t.roots]) {
      const text = JSON.stringify(entry);
      expect(text).not.toMatch(/"S":\{"\$"/);
    }
    expect(decodeValue(wire(t.roots[0]), null, t)).toEqual(
      decodeValue([form, form, { v: "@repeated string value" }], null, EMPTY),
    );
  });

  it("does not put a compact ID, an escape, or a timestamp form in `strings`", () => {
    const value = [
      "@-3376.544",
      "@-3376.544",
      "-3570:PDZXR3NWJNS83TS2",
      "-3570:PDZXR3NWJNS83TS2",
    ];
    expect(buildTables([root(value)]).strings).toEqual([]);
  });

  it("round-trips a realistic value through both stages", () => {
    const value = {
      trigger: { from_state: state(), to_state: state({ state: "off" }) },
      text: "the same message over and over",
      again: "the same message over and over",
      list: [
        { service: "light.turn_on", data: { brightness_pct: 30 } },
        { service: "light.turn_on", data: { brightness_pct: 30 } },
      ],
    };
    const encoded = encodeValue(value, anchor);
    const t = buildTables([root(encoded)]);
    expect(decodeValue(wire(t.roots[0]), anchor, t)).toEqual(value);
  });
});
