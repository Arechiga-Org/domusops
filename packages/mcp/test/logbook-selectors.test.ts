import type { LogbookRow } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/errors.js";
import {
  MAX_SELECTOR_LENGTH,
  MAX_SELECTORS,
  matches,
  noEvents,
  parseSelectors,
  selectRows,
  strategy,
} from "../src/logbook/selectors.js";

function invalid(list: string[]): void {
  try {
    parseSelectors(list);
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).kind).toBe("selector_invalid");
    return;
  }
  throw new Error(`expected ${JSON.stringify(list)} to be rejected`);
}

describe("matches", () => {
  it.each([
    ["light.hallway", "light.hallway", true],
    ["light.hallway", "light.hallway_2", false],
    ["light.*", "light.hallway", true],
    ["light.*", "switch.light", false],
    ["*_motion", "binary_sensor.hallway_motion", true],
    ["*_motion", "binary_sensor.hallway_motion_2", false],
    ["*", "anything.at_all", true],
    ["sensor.*_temp*", "sensor.kitchen_temperature", true],
    ["sensor.*_temp*", "sensor.kitchen_humidity", false],
    // The dot is a literal dot, not "any character".
    ["light.hallway", "lightXhallway", false],
  ])("%s against %s is %s", (selector, id, expected) => {
    expect(matches(selector, id)).toBe(expected);
  });
});

describe("matches never backtracks", () => {
  it("answers a pathological pattern in well under a second (CWE-1333)", () => {
    const id = `sensor.${"a".repeat(60)}`;
    const started = performance.now();
    expect(matches(`${"*a".repeat(60)}*b`, id)).toBe(false);
    expect(matches(`${"*a".repeat(60)}*`, id)).toBe(true);
    expect(matches("*".repeat(100), id)).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it.each([
    ["a*b*c", "abc", true],
    ["a*b*c", "axbxc", true],
    ["a*b*c", "acb", false],
    ["*a*a*", "a", false],
    ["*a*a*", "aa", true],
    ["a**b", "ab", true],
    ["*abc", "xxabc", true],
    ["*abc", "abcx", false],
    ["abc*", "abcx", true],
    ["abc*", "xabc", false],
    ["", "", true],
    ["*", "", true],
  ])("%s against %s is %s", (selector, id, expected) => {
    expect(matches(selector, id)).toBe(expected);
  });
});

describe("parseSelectors", () => {
  it("returns undefined when no selectors were given", () => {
    expect(parseSelectors(undefined)).toBeUndefined();
  });

  it("removes duplicates and keeps the request order", () => {
    expect(
      parseSelectors(["light.b", "light.*", "light.b", "light.a"]),
    ).toEqual(["light.b", "light.*", "light.a"]);
  });

  it.each([
    [[""]],
    [["Light.Hallway"]],
    [["light hallway"]],
    [["light.?"]],
    [["light.[a]"]],
    [["light-hallway"]],
  ])("rejects %j", (list) => invalid(list));

  it("rejects a selector longer than the limit, and accepts one of exactly the limit", () => {
    invalid([`light.${"a".repeat(MAX_SELECTOR_LENGTH)}`]);
    expect(parseSelectors(["a".repeat(MAX_SELECTOR_LENGTH)])).toHaveLength(1);
  });

  it("shares its count limit with the advertised input schema", () => {
    expect(MAX_SELECTORS).toBe(100);
  });

  it("rejects an empty list and more than 100 selectors", () => {
    invalid([]);
    invalid(Array.from({ length: 101 }, (_, i) => `light.n${i}`));
  });

  it("accepts exactly 100 selectors", () => {
    expect(
      parseSelectors(Array.from({ length: 100 }, (_, i) => `light.n${i}`)),
    ).toHaveLength(100);
  });
});

describe("strategy", () => {
  it("is all without selectors, exact for IDs only, filtered with any pattern", () => {
    expect(strategy(undefined)).toBe("all");
    expect(strategy(["light.a", "switch.b"])).toBe("exact");
    expect(strategy(["light.a", "switch.*"])).toBe("filtered");
  });
});

const rows: LogbookRow[] = [
  { when: 1, entity_id: "light.a", state: "on" },
  { when: 2, entity_id: "light.b", state: "on" },
  { when: 3, entity_id: "switch.a", state: "on" },
  {
    when: 4,
    name: "Home Assistant",
    message: "started",
    domain: "homeassistant",
  },
];

describe("selectRows and noEvents", () => {
  it("keeps every row, including those without an entity, when there are no selectors", () => {
    expect(selectRows(rows, undefined)).toHaveLength(4);
  });

  it("selects each row once, however many selectors match it, and drops rows without an entity", () => {
    const selected = selectRows(rows, ["light.*", "light.a"]);
    expect(selected.map((r) => r.when)).toEqual([1, 2]);
  });

  it("lists the selectors that matched no row, in request order", () => {
    const selectors = ["sensor.*", "light.a", "light.zzz", "switch.*"];
    expect(noEvents(selectors, selectRows(rows, selectors))).toEqual([
      "sensor.*",
      "light.zzz",
    ]);
  });
});
