import { logbookJsonSchema } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { encodeStandard } from "../src/logbook/encode-standard.js";
import { encodeSummary } from "../src/logbook/encode-summary.js";
import { finalize, measureRowsBytes } from "../src/snapshot/ratio.js";
import {
  LOGBOOK_EMPTY,
  PERFORMANCE_LOGBOOK,
  REFERENCE_LOGBOOK_24H,
  type LogbookFixture,
} from "./fixtures/generate-logbook.js";
import { contextFor } from "./support/logbook.js";

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  logbookJsonSchema,
);

function documents(
  fixture: LogbookFixture,
): Record<string, Record<string, unknown>> {
  const context = contextFor(fixture);
  const raw = measureRowsBytes(fixture.logbook);
  const narrowed = {
    ...context,
    selectors: ["light.*", "sensor.none"],
    noEvents: ["sensor.none"],
  };
  return {
    standard: JSON.parse(
      finalize(encodeStandard(fixture.logbook, context), raw),
    ),
    summary: JSON.parse(finalize(encodeSummary(fixture.logbook, context), raw)),
    "standard with selectors": JSON.parse(
      finalize(encodeStandard(fixture.logbook, narrowed), raw),
    ),
    "summary with selectors": JSON.parse(
      finalize(encodeSummary(fixture.logbook, narrowed), raw),
    ),
  };
}

describe("logbookJsonSchema accepts what the tool emits", () => {
  for (const [name, fixture] of [
    ["reference", REFERENCE_LOGBOOK_24H],
    ["performance", PERFORMANCE_LOGBOOK],
    ["empty", LOGBOOK_EMPTY],
  ] as const) {
    for (const [kind, doc] of Object.entries(documents(fixture))) {
      it(`accepts the ${kind} document of the ${name} fixture`, () => {
        expect(
          validate(doc),
          JSON.stringify(validate.errors?.slice(0, 2)),
        ).toBe(true);
      });
    }
  }
});

describe("logbookJsonSchema rejects malformed documents", () => {
  const good = documents(REFERENCE_LOGBOOK_24H)["standard"] as Record<
    string,
    unknown
  > & {
    events: Record<string, Record<string, unknown[]>>;
  };
  const clone = (): typeof good =>
    JSON.parse(JSON.stringify(good)) as typeof good;

  it("rejects a wrong format identifier", () => {
    expect(validate({ ...clone(), format: "domusops.logbook/9.9" })).toBe(
      false,
    );
  });

  it("rejects a document without a time zone", () => {
    const doc = clone();
    delete doc["time_zone"];
    expect(validate(doc)).toBe(false);
  });

  it("rejects an event row that is not an array", () => {
    const doc = clone();
    const [date] = Object.keys(doc.events) as [string];
    const [hour] = Object.keys(doc.events[date] ?? {}) as [string];
    (doc.events[date] as Record<string, unknown[]>)[hour] = [{ time: "00:00" }];
    expect(validate(doc)).toBe(false);
  });

  it("rejects an hour key that is not HH:00", () => {
    const doc = clone();
    const [date] = Object.keys(doc.events) as [string];
    const day = doc.events[date] as Record<string, unknown[]>;
    day["3:15"] = [["00:01", 0]];
    expect(validate(doc)).toBe(false);
  });

  it("rejects an entity entry that is neither an ID nor a triple", () => {
    const doc = clone();
    (doc["entities"] as unknown[]).push(["light.a", {}]);
    expect(validate(doc)).toBe(false);
  });

  it("rejects an unknown top-level key and a summary that lists events", () => {
    expect(validate({ ...clone(), extra: 1 })).toBe(false);
    const summary = {
      ...documents(REFERENCE_LOGBOOK_24H)["summary"],
      events: {},
    };
    expect(validate(summary)).toBe(false);
  });
});
