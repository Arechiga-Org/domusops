import type { LogbookRow } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { extractCause } from "../src/logbook/cause.js";

describe("extractCause", () => {
  it("returns the cause fields without their prefix, in the fixed field order", () => {
    const row: LogbookRow = {
      when: 1,
      entity_id: "light.a",
      context_service: "turn_on",
      context_domain: "light",
      context_id: "not-a-cause-field",
    };
    const cause = extractCause(row);
    expect(cause).toEqual({ domain: "light", service: "turn_on" });
    expect(Object.keys(cause ?? {})).toEqual(["domain", "service"]);
  });

  it("returns null for a row with no cause field", () => {
    expect(
      extractCause({ when: 1, entity_id: "light.a", state: "on" }),
    ).toBeNull();
  });
});
