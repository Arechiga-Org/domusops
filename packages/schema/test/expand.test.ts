import { describe, expect, it } from "vitest";
import {
  FORMAT,
  expand,
  type RawRecords,
  type StandardDocument,
} from "../src/index.js";

// A hand-built `standard` document that exercises every decoding rule (data-model §3).
const doc: StandardDocument = {
  format: FORMAT,
  detail: "standard",
  ha_version: "2026.9.1",
  compression_ratio: 5,
  config: { location_name: "Home" },
  areas: {
    kitchen: { name: "Kitchen", temperature_entity_id: "sensor.kitchen_temp" },
    den: { name: "Den", humidity_entity_id: "!sensor.ghost_humidity" },
  },
  entries: { e1: { id: "ENTRY-ONE", domain: "hue", title: "Hue" } },
  templates: {
    t1: { const: { manufacturer: "Signify" }, cols: ["area_id", "name"] },
    t2: {
      const: {
        "reg.original_name": "Light",
        "~state": "escaped attribute value",
      },
      cols: ["brightness", "reg.area_id"],
    },
  },
  devices: {
    t1: [
      ["d1", "dev-one", "kitchen", "Ceiling"],
      ["d2", "dev-two", "!ghost_area", "Lamp"],
    ],
    _: [
      {
        alias: "d3",
        id: "dev-three",
        name: "Solo",
        via_device_id: "d1",
        config_entries: ["e1", "!ENTRY-GONE"],
        primary_config_entry: "e1",
      },
    ],
  },
  integrations: {
    hue: {
      e1: {
        light: {
          t2: [
            ["light.a", "on", "d1", 255, "kitchen"],
            ["light.b", "off", "d2", 10, "!ghost_area"],
          ],
          _: [
            {
              entity_id: "light.c",
              state: "on",
              device: "!dev-gone",
              "reg.icon": "mdi:lamp",
              icon: "attribute icon",
            },
          ],
        },
      },
      "!ENTRY-GONE": {
        light: { _: [{ entity_id: "light.d", "reg.name": "D" }] },
      },
    },
    automation: {
      _yaml: {
        automation: {
          _: [{ entity_id: "automation.x", state: "on", friendly_name: "X" }],
        },
      },
    },
    _unregistered: {
      _none: {
        sensor: {
          _: [{ entity_id: "sensor.legacy", state: "3", friendly_name: "L" }],
        },
      },
    },
  },
};

function byKey<T extends Record<string, unknown>>(
  records: T[],
  key: string,
  value: string,
): T {
  const found = records.find((r) => r[key] === value);
  if (found === undefined) throw new Error(`no record with ${key}=${value}`);
  return found;
}

describe("expand", () => {
  const records: RawRecords = expand(doc);

  it("restores defaults, including the derived device defaults", () => {
    expect(records.config).toEqual({
      location_name: "Home",
      safe_mode: false,
      recovery_mode: false,
      state: "RUNNING",
    });
    const solo = byKey(records.device_registry, "id", "dev-three");
    expect(solo["manufacturer"]).toBeNull();
    expect(solo["labels"]).toEqual([]);
    // Two entries, so no derived primary default; the explicit value is kept.
    expect(solo["primary_config_entry"]).toBe("ENTRY-ONE");
    expect(solo["config_entries_subentries"]).toEqual({
      "ENTRY-ONE": [null],
      "ENTRY-GONE": [null],
    });
    const ceiling = byKey(records.device_registry, "id", "dev-one");
    expect(ceiling["manufacturer"]).toBe("Signify");
    expect(ceiling["sw_version"]).toBeNull();
  });

  it("restores template constants and positional columns", () => {
    const lightA = byKey(records.entity_registry, "entity_id", "light.a");
    expect(lightA["original_name"]).toBe("Light");
    expect(lightA["area_id"]).toBe("kitchen");
    const stateA = byKey(records.states, "entity_id", "light.a");
    expect(stateA["state"]).toBe("on");
    expect(stateA["attributes"]).toEqual({
      brightness: 255,
      state: "escaped attribute value",
    });
  });

  it("restores device, entry, and template aliases", () => {
    const lightA = byKey(records.entity_registry, "entity_id", "light.a");
    expect(lightA["device_id"]).toBe("dev-one");
    expect(lightA["config_entry_id"]).toBe("ENTRY-ONE");
    expect(lightA["platform"]).toBe("hue");
    const solo = byKey(records.device_registry, "id", "dev-three");
    expect(solo["via_device_id"]).toBe("dev-one");
    expect(records.config_entries).toEqual([
      expect.objectContaining({
        entry_id: "ENTRY-ONE",
        domain: "hue",
        title: "Hue",
      }),
    ]);
  });

  it("restores the entry groups _yaml, orphan, and _unregistered/_none", () => {
    const automation = byKey(
      records.entity_registry,
      "entity_id",
      "automation.x",
    );
    expect(automation["config_entry_id"]).toBeNull();
    expect(automation["device_id"]).toBeNull();
    const orphanEntry = byKey(records.entity_registry, "entity_id", "light.d");
    expect(orphanEntry["config_entry_id"]).toBe("ENTRY-GONE");
    expect(
      records.entity_registry.some((e) => e.entity_id === "sensor.legacy"),
    ).toBe(false);
    expect(byKey(records.states, "entity_id", "sensor.legacy")["state"]).toBe(
      "3",
    );
  });

  it("restores '!'-prefixed orphan references in every reference field", () => {
    expect(
      byKey(records.entity_registry, "entity_id", "light.c")["device_id"],
    ).toBe("dev-gone");
    expect(
      byKey(records.entity_registry, "entity_id", "light.b")["area_id"],
    ).toBe("ghost_area");
    expect(byKey(records.device_registry, "id", "dev-two")["area_id"]).toBe(
      "ghost_area",
    );
    expect(
      byKey(records.area_registry, "area_id", "den")["humidity_entity_id"],
    ).toBe("sensor.ghost_humidity");
    expect(
      byKey(records.device_registry, "id", "dev-three")["config_entries"],
    ).toEqual(["ENTRY-ONE", "ENTRY-GONE"]);
    // A valid reference is not touched.
    expect(
      byKey(records.area_registry, "area_id", "kitchen")[
        "temperature_entity_id"
      ],
    ).toBe("sensor.kitchen_temp");
  });

  it("restores no state record for a null state column", () => {
    expect(records.states.some((s) => s.entity_id === "light.d")).toBe(false);
    expect(records.entity_registry.some((e) => e.entity_id === "light.d")).toBe(
      true,
    );
  });

  it("keeps registry fields separate from same-named attributes", () => {
    const lightC = byKey(records.entity_registry, "entity_id", "light.c");
    expect(lightC["icon"]).toBe("mdi:lamp");
    expect(byKey(records.states, "entity_id", "light.c")["attributes"]).toEqual(
      {
        icon: "attribute icon",
      },
    );
  });

  it("returns every array sorted by its identity key", () => {
    const ids = records.entity_registry.map((e) => e.entity_id);
    expect(ids).toEqual([...ids].sort());
    const devices = records.device_registry.map((d) => d.id);
    expect(devices).toEqual([...devices].sort());
  });
});
