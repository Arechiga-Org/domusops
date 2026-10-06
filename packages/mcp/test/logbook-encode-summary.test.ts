import type {
  LogbookRow,
  LogbookStandardDocument,
  LogbookSummaryDocument,
} from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeStandard } from "../src/logbook/encode-standard.js";
import { encodeSummary } from "../src/logbook/encode-summary.js";
import { finalize, measureRowsBytes } from "../src/snapshot/ratio.js";
import {
  LOGBOOK_EMPTY,
  REFERENCE_LOGBOOK_24H,
  type LogbookFixture,
} from "./fixtures/generate-logbook.js";
import { contextFor } from "./support/logbook.js";

function summarize(fixture: LogbookFixture): {
  text: string;
  doc: LogbookSummaryDocument;
} {
  const doc = encodeSummary(fixture.logbook, contextFor(fixture));
  const text = finalize(doc, measureRowsBytes(fixture.logbook));
  return { text, doc: JSON.parse(text) as LogbookSummaryDocument };
}

const rows = REFERENCE_LOGBOOK_24H.logbook;
const withEntity = rows.filter((r) => r.entity_id !== undefined);

describe("counts", () => {
  const { doc } = summarize(REFERENCE_LOGBOOK_24H);

  it("counts events, entities, causes, and events without an entity", () => {
    expect(doc.counts.events).toBe(rows.length);
    expect(doc.counts.no_entity_events).toBe(rows.length - withEntity.length);
    expect(doc.counts.entities).toBe(
      new Set(withEntity.map((r) => r.entity_id)).size,
    );
    const standard = encodeStandard(rows, contextFor(REFERENCE_LOGBOOK_24H));
    expect(doc.counts.causes).toBe(standard.causes?.length ?? 0);
  });

  it("sums by_domain to the events that belong to an entity", () => {
    const total = Object.values(doc.by_domain).reduce((a, b) => a + b, 0);
    expect(total).toBe(withEntity.length);
    const light = withEntity.filter((r) =>
      r.entity_id?.startsWith("light."),
    ).length;
    expect(doc.by_domain["light"]).toBe(light);
  });

  it("orders by_domain by descending count, then by name", () => {
    const entries = Object.entries(doc.by_domain);
    for (let i = 1; i < entries.length; i++) {
      const [prevName, prev] = entries[i - 1] as [string, number];
      const [name, count] = entries[i] as [string, number];
      expect(prev > count || (prev === count && prevName < name)).toBe(true);
    }
  });
});

describe("by_entity", () => {
  const { doc } = summarize(REFERENCE_LOGBOOK_24H);

  it("gives every entity its count and its first and last local time", () => {
    expect(Object.keys(doc.by_entity)).toHaveLength(doc.counts.entities);
    const id = withEntity[0]?.entity_id as string;
    const own = withEntity.filter((r) => r.entity_id === id);
    const [count, first, last] = doc.by_entity[id] as [number, string, string];
    expect(count).toBe(own.length);
    expect(first <= last).toBe(true);
    expect(first).toMatch(/^2026-03-1[34]T\d\d:\d\d:\d\d$/);
  });

  it("orders by descending count, then by ID", () => {
    const entries = Object.entries(doc.by_entity);
    for (let i = 1; i < entries.length; i++) {
      const [prevId, [prev]] = entries[i - 1] as [
        string,
        [number, string, string],
      ];
      const [id, [count]] = entries[i] as [string, [number, string, string]];
      expect(prev > count || (prev === count && prevId < id)).toBe(true);
    }
  });
});

describe("by_cause", () => {
  const { doc } = summarize(REFERENCE_LOGBOOK_24H);

  it("matches the cause table of the standard encoding, with the raw values", () => {
    const standard = encodeStandard(rows, contextFor(REFERENCE_LOGBOOK_24H));
    expect(doc.by_cause).toHaveLength(standard.causes?.length ?? 0);
    const total = doc.by_cause.reduce((sum, [, n]) => sum + n, 0);
    const withCause = rows.filter((r) =>
      Object.keys(r).some(
        (k) => k.startsWith("context_") && k !== "context_id",
      ),
    ).length;
    expect(total).toBe(withCause);
    for (const [cause] of doc.by_cause) {
      for (const value of Object.values(cause))
        expect(typeof value).toBe("string");
    }
  });

  it("orders by descending count", () => {
    for (let i = 1; i < doc.by_cause.length; i++) {
      expect(
        (doc.by_cause[i - 1] as [unknown, number])[1],
      ).toBeGreaterThanOrEqual((doc.by_cause[i] as [unknown, number])[1]);
    }
  });
});

describe("shape", () => {
  it("lists no individual event", () => {
    const { doc } = summarize(REFERENCE_LOGBOOK_24H);
    expect(doc.detail).toBe("summary");
    expect(doc).not.toHaveProperty("events");
    expect(doc).not.toHaveProperty("entities");
    expect(doc).not.toHaveProperty("strings");
  });

  it("carries the envelope of the standard document", () => {
    const { doc } = summarize(REFERENCE_LOGBOOK_24H);
    const standard = encodeStandard(
      rows,
      contextFor(REFERENCE_LOGBOOK_24H),
    ) as LogbookStandardDocument;
    for (const key of [
      "format",
      "ha_version",
      "time_zone",
      "utc_offset",
      "window",
      "first",
      "last",
    ] as const) {
      expect(doc[key]).toEqual(standard[key]);
    }
  });

  it("is byte-identical for identical input", () => {
    expect(summarize(REFERENCE_LOGBOOK_24H).text).toBe(
      summarize(REFERENCE_LOGBOOK_24H).text,
    );
  });

  it("is far smaller than the standard document of a busy window", () => {
    const standard = finalize(
      encodeStandard(rows, contextFor(REFERENCE_LOGBOOK_24H)),
      measureRowsBytes(rows),
    );
    expect(summarize(REFERENCE_LOGBOOK_24H).text.length).toBeLessThan(
      standard.length / 3,
    );
  });

  it("is valid, with zero counts and empty objects, for an empty window", () => {
    const { doc } = summarize(LOGBOOK_EMPTY);
    expect(doc.counts).toEqual({
      events: 0,
      entities: 0,
      causes: 0,
      no_entity_events: 0,
    });
    expect(doc.by_domain).toEqual({});
    expect(doc.by_entity).toEqual({});
    expect(doc.by_cause).toEqual([]);
    expect(doc.first).toBeNull();
  });

  it("puts events without an entity in their own count only", () => {
    const only: LogbookRow[] = [
      {
        when: REFERENCE_LOGBOOK_24H.window.start + 10,
        name: "Home Assistant",
        message: "started",
        domain: "homeassistant",
      },
    ];
    const doc = encodeSummary(
      only,
      contextFor(REFERENCE_LOGBOOK_24H),
    ) as LogbookSummaryDocument;
    expect(doc.counts).toMatchObject({
      events: 1,
      entities: 0,
      no_entity_events: 1,
    });
    expect(doc.by_domain).toEqual({});
  });
});
