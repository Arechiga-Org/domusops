import { describe, expect, it } from "vitest";
import {
  decodeValue,
  expandTrace,
  formatIsoMicros,
  formatMsOffset,
  parseIsoMicros,
  parseLocalIsoMicros,
  parseMsOffset,
  type TraceStandardDocument,
} from "../src/index.js";

/** A document written by hand, so this test does not depend on the encoder. */
const document = {
  format: "domusops.trace/0.1",
  detail: "standard",
  ha_version: "2026.9.3",
  compression_ratio: 1,
  time_zone: "Europe/Madrid",
  utc_offset: "+01:00",
  selection: {},
  counts: { items: 2, runs: 2, not_triggered: 0 },
  strings: ["binary_sensor.hall_motion"],
  values: [{ service: "turn_on", target: "#0" }],
  configs: [{ alias: "Hall", triggers: [{ entity_id: "#0" }] }],
  ids: { "automation.hall_night": "1700000000001" },
  items: {
    "automation.hall_night": {
      this: {
        entity_id: "automation.hall_night",
        attributes: { mode: "single", friendly_name: "Hall night" },
      },
      runs: [
        {
          run: "0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b",
          start: "2026-03-14T11:00:00.116474+01:00",
          duration_ms: 412.508,
          trigger: "state of binary_sensor.hall_motion",
          outcome: "finished",
          context: "12:7Q3KXW2M9ZB4Y6AR",
          parent_context: "-3:7Q3KXW2M9ZB4Y6AQ",
          config: 0,
          steps: [
            [
              "trigger/0",
              0,
              0,
              {
                this: {
                  D: [
                    "this",
                    "on",
                    { current: 0 },
                    [],
                    "@-3600000",
                    0,
                    0,
                    null,
                  ],
                },
                trigger: {
                  from_state: {
                    S: [
                      "#0",
                      "off",
                      { device_class: "motion" },
                      "@-600000",
                      0,
                      0,
                      null,
                    ],
                  },
                  to_state: {
                    D: [
                      "from",
                      "on",
                      {},
                      ["device_class"],
                      "@-0.5",
                      0,
                      "@-0.4",
                      null,
                    ],
                  },
                },
              },
            ],
            [
              "action/0",
              0.912,
              { $: 0 },
              0,
              ["script.night_light", "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d"],
              "boom",
              ["oops"],
            ],
            { step: { path: "action/1", t: 1.5, future: { v: "#0" } } },
          ],
        },
      ],
    },
    "script:removed": {
      runs: [
        {
          run: "1f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b",
          start: "2026-03-14T11:00:05+01:00",
          state: "stopped",
          script_execution: null,
          context: { v: "#5" },
          config: null,
          steps: [],
          extra: { note: "kept" },
          last_step: "action/9",
        },
      ],
    },
  },
} as unknown as TraceStandardDocument;

describe("expandTrace on a hand-written document (data-model §3, §5)", () => {
  const [run, removed] = expandTrace(document);

  it("rebuilds the run's identity, times, and outcome", () => {
    expect(run).toMatchObject({
      run_id: "0f3c9a2b7d1e4c5f8a6b9c0d1e2f3a4b",
      domain: "automation",
      item_id: "1700000000001",
      state: "stopped",
      script_execution: "finished",
      trigger: "state of binary_sensor.hall_motion",
      timestamp: {
        start: "2026-03-14T10:00:00.116474+00:00",
        finish: "2026-03-14T10:00:00.528982+00:00",
      },
      last_step: "action/1",
    });
  });

  it("rebuilds the context and the configuration", () => {
    expect(run?.context.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(run?.context.id.endsWith("7Q3KXW2M9ZB4Y6AR")).toBe(true);
    expect(run?.context.parent_id?.endsWith("7Q3KXW2M9ZB4Y6AQ")).toBe(true);
    expect(run?.context.user_id).toBeNull();
    expect(run?.config).toEqual({
      alias: "Hall",
      triggers: [{ entity_id: "binary_sensor.hall_motion" }],
    });
    expect(run?.blueprint_inputs).toBeNull();
  });

  it("rebuilds states from a template and from a from_state", () => {
    const vars = run?.trace["trigger/0"]?.[0]?.changed_variables as {
      this: { attributes: unknown; last_changed: string };
      trigger: {
        from_state: { attributes: unknown };
        to_state: Record<string, unknown>;
      };
    };
    expect(vars.this.attributes).toEqual({
      mode: "single",
      friendly_name: "Hall night",
      current: 0,
    });
    expect(vars.this.last_changed).toBe("2026-03-14T09:00:00.116474+00:00");
    expect(vars.trigger.to_state).toMatchObject({
      entity_id: "binary_sensor.hall_motion",
      state: "on",
      attributes: {},
      last_changed: "2026-03-14T10:00:00.115974+00:00",
      last_updated: "2026-03-14T10:00:00.115974+00:00",
      last_reported: "2026-03-14T10:00:00.116074+00:00",
      context: null,
    });
  });

  it("rebuilds a step's result, child, error, template errors, and time", () => {
    const step = run?.trace["action/0"]?.[0];
    expect(step).toMatchObject({
      timestamp: "2026-03-14T10:00:00.117386+00:00",
      result: { service: "turn_on", target: "binary_sensor.hall_motion" },
      child_id: {
        domain: "script",
        item_id: "night_light",
        run_id: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
      },
      error: "boom",
      template_errors: ["oops"],
    });
  });

  it("rebuilds a step given as an object, with its literal", () => {
    expect(run?.trace["action/1"]?.[0]).toEqual({
      path: "action/1",
      timestamp: "2026-03-14T10:00:00.117974+00:00",
      future: "#0",
    });
  });

  it("rebuilds a run of a removed item, still running, with extra keys", () => {
    expect(removed).toMatchObject({
      domain: "script",
      item_id: "removed",
      state: "stopped",
      script_execution: null,
      timestamp: { start: "2026-03-14T10:00:05+00:00", finish: null },
      config: null,
      blueprint_inputs: null,
      last_step: "action/9",
      note: "kept",
      trace: {},
    });
    expect(removed?.context.id).toBe("#5");
  });

  it("keeps an explicit null last_step, and derives it only when the key is absent", () => {
    const withLastStep = (value: string | null | undefined) => {
      const copy = structuredClone(document) as unknown as {
        items: Record<string, { runs: Record<string, unknown>[] }>;
      };
      const source = copy.items["automation.hall_night"]?.runs[0];
      if (source === undefined) throw new Error("fixture changed");
      delete source["last_step"];
      if (value !== undefined) source["last_step"] = value;
      return expandTrace(copy as unknown as TraceStandardDocument)[0];
    };
    expect(withLastStep(null)?.last_step).toBeNull();
    expect(withLastStep(undefined)?.last_step).toBe("action/1");
    expect(withLastStep("trigger/0")?.last_step).toBe("trigger/0");
  });

  it("throws on a reference that does not resolve", () => {
    expect(() =>
      decodeValue("#9", null, { strings: [], values: [] }),
    ).toThrowError(/unresolved/);
    expect(() =>
      decodeValue({ $: 3 }, null, { strings: [], values: [] }),
    ).toThrowError(/unresolved/);
    expect(() =>
      decodeValue({ D: ["this", "on", {}, [], 0, 0, 0, null] }, null, {
        strings: [],
        values: [],
      }),
    ).toThrowError(/no base/);
  });
});

describe("timestamp helpers", () => {
  it.each([
    "2026-03-14T10:00:03.500000+00:00",
    "2026-03-14T10:00:04+00:00",
    "1999-12-31T23:59:59.999999+00:00",
  ])("round-trips %s", (text) => {
    expect(formatIsoMicros(parseIsoMicros(text) as number)).toBe(text);
  });

  it("refuses text that is not the canonical form", () => {
    for (const bad of [
      "2026-03-14T10:00:03Z",
      "2026-03-14T10:00:03.000000+00:00",
      "x",
    ]) {
      expect(parseIsoMicros(bad)).toBeNull();
    }
  });

  it("formats and parses millisecond offsets with up to three decimals", () => {
    for (const micros of [
      0, 1, 500, 1000, 12500, -912, -3376544, 86_400_000_000,
    ]) {
      expect(parseMsOffset(formatMsOffset(micros))).toBe(micros);
    }
    expect(formatMsOffset(12_500)).toBe("12.5");
    expect(formatMsOffset(-912)).toBe("-0.912");
  });

  it("parses a local time with its offset", () => {
    expect(parseLocalIsoMicros("2026-03-14T11:00:00.116474+01:00")).toBe(
      parseIsoMicros("2026-03-14T10:00:00.116474+00:00"),
    );
    expect(parseLocalIsoMicros("2026-03-14T11:00:00")).toBeNull();
  });
});
