import type { LogbookRow, LogbookStandardDocument } from "@domusops/schema";
import { describe, expect, it } from "vitest";
import { encodeStandard } from "../src/logbook/encode-standard.js";
import { finalize, measureRowsBytes } from "../src/snapshot/ratio.js";
import { contextFor } from "./support/logbook.js";
import {
  LOGBOOK_EMPTY,
  PERFORMANCE_LOGBOOK,
  REFERENCE_LOGBOOK_24H,
  type LogbookFixture,
} from "./fixtures/generate-logbook.js";

function encoded(fixture: LogbookFixture): { text: string; doc: LogbookStandardDocument } {
  const doc = encodeStandard(fixture.logbook, contextFor(fixture));
  const text = finalize(doc, measureRowsBytes(fixture.logbook));
  return { text, doc: JSON.parse(text) as LogbookStandardDocument };
}

describe("compression", () => {
  it("meets the floor of 5 on the 24-hour reference fixture (FR-018, SC-001)", () => {
    const { doc } = encoded(REFERENCE_LOGBOOK_24H);
    expect(doc.compression_ratio).toBeGreaterThanOrEqual(5);
  });

  it("stays calibrated to the live measurement (research R7: 5.37x live)", () => {
    const { doc } = encoded(REFERENCE_LOGBOOK_24H);
    expect(doc.compression_ratio).toBeGreaterThanOrEqual(5.2);
    expect(doc.compression_ratio).toBeLessThanOrEqual(5.6);
  });

  it("is about 200 raw bytes per event, as measured live", () => {
    const perEvent =
      measureRowsBytes(REFERENCE_LOGBOOK_24H.logbook) / REFERENCE_LOGBOOK_24H.logbook.length;
    expect(perEvent).toBeGreaterThan(170);
    expect(perEvent).toBeLessThan(230);
  });
});

describe("determinism", () => {
  it("encodes the same rows to the same bytes", () => {
    expect(encoded(REFERENCE_LOGBOOK_24H).text).toBe(encoded(REFERENCE_LOGBOOK_24H).text);
  });
});

describe("structure", () => {
  const { doc } = encoded(REFERENCE_LOGBOOK_24H);
  const strings = doc.strings ?? [];
  const causes = doc.causes ?? [];

  it("resolves every index of every row", () => {
    const isRef = (v: unknown): boolean =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v < strings.length;
    for (const hours of Object.values(doc.events)) {
      for (const rows of Object.values(hours)) {
        for (const row of rows) {
          expect(row[0]).toMatch(/^\d\d:\d\d$/);
          expect(row[1]).toBeGreaterThanOrEqual(0);
          expect(row[1] as number).toBeLessThan(doc.entities.length);
          if (row[2] !== null && row[2] !== undefined && typeof row[2] === "number") {
            expect(isRef(row[2])).toBe(true);
          }
          if (row[3] !== null && row[3] !== undefined) {
            expect(row[3] as number).toBeGreaterThanOrEqual(0);
            expect(row[3] as number).toBeLessThan(causes.length);
          }
        }
      }
    }
    for (const cause of causes) {
      for (const value of Object.values(cause)) {
        if (typeof value === "number") expect(isRef(value)).toBe(true);
      }
    }
  });

  it("orders dates and hours ascending, with keys of the form HH:00", () => {
    const dates = Object.keys(doc.events);
    expect(dates).toEqual([...dates].sort());
    for (const hours of Object.values(doc.events)) {
      const keys = Object.keys(hours);
      for (const key of keys) expect(key).toMatch(/^\d\d:00([+-]\d\d:\d\d)?$/);
      expect(keys).toEqual([...keys].sort());
    }
  });

  it("has no integer-like object key anywhere an engine would reorder it", () => {
    const check = (o: object): void => {
      for (const key of Object.keys(o)) expect(key).not.toMatch(/^\d+$/);
    };
    check(doc);
    check(doc.events);
    for (const hours of Object.values(doc.events)) check(hours);
    for (const cause of causes) check(cause);
  });

  it("has at most one entity entry without an ID, and identifies every entity once", () => {
    const ids = doc.entities.map((e) => (typeof e === "string" ? e : e[0]));
    expect(ids.filter((id) => id === null).length).toBeLessThanOrEqual(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never puts a context ID in the string table", () => {
    for (const s of strings) expect(s).not.toMatch(/^-?\d+:[0-9A-Z]{16}$/);
    const ulidLike = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
    for (const s of strings) expect(s).not.toMatch(ulidLike);
  });

  it("orders the string table by descending use, then code point", () => {
    const uses = new Map<string, number>();
    const walk = (v: unknown): void => {
      if (typeof v === "number" && Number.isInteger(v) && strings[v] !== undefined) {
        uses.set(strings[v] as string, (uses.get(strings[v] as string) ?? 0) + 1);
      }
    };
    for (const hours of Object.values(doc.events))
      for (const rows of Object.values(hours))
        for (const row of rows) [row[2], ...row.slice(4)].forEach(walk);
    for (const cause of causes) Object.values(cause).forEach(walk);
    for (const entity of doc.entities)
      if (typeof entity !== "string") Object.values(entity[1]).forEach(walk);
    for (let i = 1; i < strings.length; i++) {
      const a = uses.get(strings[i - 1] as string) ?? 0;
      const b = uses.get(strings[i] as string) ?? 0;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });
});

describe("daylight-saving change inside the window", () => {
  // Europe/Madrid, 2026-10-25: 03:00 CEST (+02:00) becomes 02:00 CET (+01:00) at 01:00Z.
  const rows: LogbookRow[] = [
    { when: Date.UTC(2026, 9, 25, 0, 30) / 1000, entity_id: "light.a", state: "on" },
    { when: Date.UTC(2026, 9, 25, 1, 30) / 1000, entity_id: "light.a", state: "off" },
  ];
  const fixture = {
    haVersion: "2026.9.1",
    window: {
      start: Date.UTC(2026, 9, 24, 22) / 1000,
      end: Date.UTC(2026, 9, 25, 4) / 1000,
    },
  };

  it("keeps the repeated local hour in two buckets, the second carrying its offset", () => {
    const doc = encodeStandard(rows, contextFor(fixture)) as LogbookStandardDocument;
    expect(doc.utc_offset).toBe("+02:00");
    expect(Object.keys(doc.events["2026-10-25"] ?? {})).toEqual(["02:00", "02:00+01:00"]);
    expect(doc.first).toBe("2026-10-25T02:30:00");
    expect(doc.last).toBe("2026-10-25T02:30:00+01:00");
  });
});

describe("empty result", () => {
  it("is a valid document with no events", () => {
    const { doc } = encoded(LOGBOOK_EMPTY);
    expect(doc.first).toBeNull();
    expect(doc.last).toBeNull();
    expect(doc.events).toEqual({});
    expect(doc.entities).toEqual([]);
    expect(doc.compression_ratio).toBeGreaterThan(0);
    expect(doc.compression_ratio).toBeLessThan(1);
  });
});

describe("scale", () => {
  it("encodes the 10,000-event window", () => {
    expect(encoded(PERFORMANCE_LOGBOOK).doc.compression_ratio).toBeGreaterThan(3);
  });
});
