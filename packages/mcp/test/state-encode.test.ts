import { encodeContextId, type StateStandardDocument } from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError } from "../src/errors.js";
import type { HaState } from "../src/ha/states.js";
import { byteLength, measureRowsBytes } from "../src/snapshot/ratio.js";
import { encodeStandardState } from "../src/state/encode-standard.js";
import { encodeSummaryState } from "../src/state/encode-summary.js";
import { stateFrame } from "../src/state/envelope.js";
import { queryState, type StateOptions } from "../src/tools/ha-state.js";
import { REFERENCE_500, type Fixture } from "./fixtures/generate.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";
import { BASE_MS, fixtureOf, stateOf, ulidAt } from "./support/states.js";

/** The encoding of `domusops.state/0.1` (specs/010-ha-state data-model §1 to §5, R4 to R10). */

const ZONE = "Europe/Amsterdam";

function encode(states: HaState[], nowMs = BASE_MS): StateStandardDocument {
  const frame = stateFrame({
    detail: "standard",
    haVersion: "2026.10.0",
    timeZone: ZONE,
    states,
    nowMs,
  });
  return encodeStandardState(frame, states);
}

/** Every record of a document as `[domain, group key, record]`, inline or positional. */
function recordsOf(
  document: StateStandardDocument,
): { domain: string; fields: Record<string, unknown> }[] {
  const out: { domain: string; fields: Record<string, unknown> }[] = [];
  for (const [domain, groups] of Object.entries(document.entities)) {
    for (const [key, rows] of Object.entries(groups)) {
      for (const row of rows) {
        if (key === "_") {
          out.push({ domain, fields: row as Record<string, unknown> });
          continue;
        }
        const template = document.templates[key]!;
        const values = row as unknown[];
        const fields: Record<string, unknown> = {
          id: values[0],
          state: values[1],
          ...template.const,
        };
        template.cols.forEach((col, i) => {
          fields[col] = values[2 + i];
        });
        const extras = values[2 + template.cols.length];
        if (typeof extras === "object" && extras !== null)
          Object.assign(fields, extras);
        out.push({ domain, fields });
      }
    }
  }
  return out;
}

const fieldsOf = (
  document: StateStandardDocument,
  id: string,
): Record<string, unknown> =>
  recordsOf(document).find((r) => r.fields["id"] === id)!.fields;

describe("the standard encoding", () => {
  it("puts the envelope keys first, in the order of data-model §1", () => {
    const document = encode([stateOf("light.a", "on")]);
    expect(Object.keys(document)).toEqual([
      "format",
      "detail",
      "ha_version",
      "compression_ratio",
      "time_zone",
      "utc_offset",
      "anchor",
      "templates",
      "entities",
    ]);
    expect(document).toMatchObject({
      format: "domusops.state/0.1",
      time_zone: ZONE,
      utc_offset: "+02:00",
    });
  });

  it("groups by domain in name order, with the object ID and state first", () => {
    const document = encode([
      stateOf("switch.b", "off"),
      stateOf("light.z", "on"),
      stateOf("binary_sensor.door", "off"),
    ]);
    expect(Object.keys(document.entities)).toEqual([
      "binary_sensor",
      "light",
      "switch",
    ]);
    expect(document.entities["light"]).toEqual({
      _: [expect.objectContaining({ id: "z", state: "on" })],
    });
  });

  it("puts rows that share a shape in a template, with shared values as constants (FR-018)", () => {
    const shared = { supported_features: 40, color_mode: "brightness" };
    const document = encode(
      ["a", "b", "c", "d"].map((id, i) =>
        stateOf(`light.${id}`, "on", { ...shared, brightness: i * 10 }),
      ),
    );
    const [key, template] = Object.entries(document.templates)[0]!;
    expect(template.const).toMatchObject(shared);
    expect(template.cols).toContain("brightness");
    const row = document.entities["light"]?.[key]?.[0] as unknown[];
    expect(row.slice(0, 2)).toEqual(["a", "on"]);
  });

  it("escapes attribute keys that collide with the record's own keys", () => {
    const document = encode([
      stateOf("sensor.x", "1", { state: "s", id: "i", "st.x": 1, "~t": 2 }),
    ]);
    expect(fieldsOf(document, "x")).toMatchObject({
      "~state": "s",
      "~id": "i",
      "~st.x": 1,
      "~~t": 2,
    });
  });

  it("leaves out times equal to the one before them, to the second (R5)", () => {
    const document = encode([
      stateOf("sensor.same", "1"),
      stateOf("sensor.updated", "1", {}, { changed: -60, updated: -30 }),
      stateOf(
        "sensor.reported",
        "1",
        {},
        { changed: -60, updated: -60, reported: 0 },
      ),
    ]);
    const same = fieldsOf(document, "same");
    expect(same["st.last_changed"]).toBe("2026-09-28T21:00:00");
    // A field at its default is absent, or null in a template column (data-model §2).
    expect(same["st.last_updated"] ?? null).toBeNull();
    expect(same["st.last_reported"] ?? null).toBeNull();
    expect(fieldsOf(document, "updated")).toMatchObject({
      "st.last_changed": "2026-09-28T20:59:00",
      "st.last_updated": "2026-09-28T20:59:30",
    });
    const reported = fieldsOf(document, "reported");
    expect(reported["st.last_updated"] ?? null).toBeNull();
    expect(reported["st.last_reported"]).toBe("2026-09-28T21:00:00");
  });

  it("writes the offset only when it differs from utc_offset", () => {
    const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
    const document = encode([
      stateOf("sensor.now", "1"),
      stateOf("sensor.old", "1", {}, { changed: (winter - BASE_MS) / 1000 }),
    ]);
    expect(fieldsOf(document, "old")["st.last_changed"]).toBe(
      "2026-01-15T13:00:00+01:00",
    );
  });

  it("anchors on the latest last_updated, to the second, or the call time (R5)", () => {
    const document = encode([
      stateOf("sensor.a", "1", {}, { changed: -100 }),
      stateOf("sensor.b", "1", {}, { changed: -200, updated: 5 }),
    ]);
    expect(document.anchor).toBe("2026-09-28T21:00:05+02:00");
    expect(encode([], BASE_MS + 61_999).anchor).toBe(
      "2026-09-28T21:01:01+02:00",
    );
  });

  it("gives compact context IDs that ha_trace and ha_logbook_query accept (R6)", () => {
    const state = stateOf("light.a", "on", {}, { parent: true, user: "u1" });
    const document = encode([state]);
    const anchorMs = Date.parse(document.anchor);
    const fields = fieldsOf(document, "a");
    expect(fields["st.context"]).toBe(
      encodeContextId(state.context.id, anchorMs),
    );
    expect(fields["st.context"]).toMatch(/^-?\d+:[0-9A-Z]{16}$/);
    expect(fields["st.parent_id"]).toBe(
      encodeContextId(state.context.parent_id!, anchorMs),
    );
    expect(fields["st.user_id"]).toBe("u1");
  });

  it("keeps a context ID that is not a ULID, and wraps one that looks compact", () => {
    const plain = { ...stateOf("light.a", "on") };
    plain.context = { id: "plain", parent_id: null, user_id: null };
    const compact = { ...stateOf("light.b", "on") };
    compact.context = {
      id: "-5:ABCDEFGHJKMNPQRS",
      parent_id: null,
      user_id: null,
    };
    const document = encode([plain, compact]);
    expect(fieldsOf(document, "a")["st.context"]).toBe("plain");
    expect(fieldsOf(document, "b")["st.context"]).toEqual({
      v: "-5:ABCDEFGHJKMNPQRS",
    });
  });

  it("leaves out a null parent_id and user_id", () => {
    const fields = fieldsOf(encode([stateOf("light.a", "on")]), "a");
    expect(fields).not.toHaveProperty("st.parent_id");
    expect(fields).not.toHaveProperty("st.user_id");
  });
});

describe("the summary encoding", () => {
  // Entity domains are integration names, at most about 20 characters (alarm_control_panel); 120
  // domains of 10 characters is well beyond any real home.
  it("stays under 4,000 bytes with 120 domains (SC-003)", () => {
    const states: HaState[] = [];
    for (let d = 0; d < 120; d++) {
      for (let e = 0; e < 25; e++) {
        states.push(
          stateOf(
            `domain_${String(d).padStart(3, "0")}.entity_${e}`,
            e % 5 === 0 ? "unavailable" : e % 7 === 0 ? "unknown" : "on",
          ),
        );
      }
    }
    const frame = stateFrame({
      detail: "summary",
      haVersion: "2026.10.0",
      timeZone: ZONE,
      states,
      nowMs: BASE_MS,
    });
    const document = encodeSummaryState(frame, states);
    expect(document.counts).toEqual({ entities: 3000, domains: 120 });
    expect(byteLength(JSON.stringify(document))).toBeLessThan(4000);
  });
});

describe("on the reference fixture", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  async function run(
    fixture: Fixture,
    options: StateOptions,
    env: Record<string, string> = {},
  ): Promise<string> {
    const ha = await startFakeHa({ fixture });
    cleanups.push(() => ha.close());
    return (
      await queryState(
        { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN, ...env },
        { ...options, now: BASE_MS },
      )
    ).document;
  }

  const ratioOf = (text: string): number =>
    (JSON.parse(text) as { compression_ratio: number }).compression_ratio;

  it.each([
    ["the whole fixture", {}],
    ["sensor.*, its largest domain", { entities: ["sensor.*"] }],
  ])("compresses %s at least 2x (FR-019, SC-002, R10)", async (_, options) => {
    expect(ratioOf(await run(REFERENCE_500, options))).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("measures the raw size before attributes trims the states (R10)", async () => {
    const text = await run(REFERENCE_500, {
      entities: ["light.*"],
      attributes: ["friendly_name"],
    });
    const raw = measureRowsBytes(
      REFERENCE_500.records.states
        .filter((s) => s.entity_id.startsWith("light."))
        .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1)),
    );
    const emitted = byteLength(
      JSON.stringify({ ...JSON.parse(text), compression_ratio: 0 }),
    );
    expect(ratioOf(text)).toBe(Math.round((raw / emitted) * 100) / 100);
  });

  it("refuses a 3,000-entity home at standard under the default limit (R8)", async () => {
    const states = Array.from({ length: 6 }, (_, copy) =>
      REFERENCE_500.records.states.map((s) => ({
        ...s,
        entity_id: `${s.entity_id}_copy_${copy}`,
        context: {
          id: ulidAt(BASE_MS - copy, copy),
          parent_id: null,
          user_id: null,
        },
      })),
    ).flat();
    await expect(run(fixtureOf(states), {})).rejects.toMatchObject({
      kind: "too_large",
    } satisfies Partial<ToolError>);
  });
});
