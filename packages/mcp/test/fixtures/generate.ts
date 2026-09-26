import type {
  JsonObject,
  RawArea,
  RawConfigEntry,
  RawDevice,
  RawEntityRegistryEntry,
  RawRecords,
  RawState,
} from "@domusops/schema";

/**
 * Deterministic generator of raw Home Assistant payloads, shaped exactly like the serializers
 * verified in research R1 (data-model §1). Same `(entityCount, seed)` gives the same output.
 *
 * Calibration (fixed before encoder work; changing it needs a comment here saying why): raw fields
 * carry realistic high-entropy values (32-hex registry `id`, `unique_id` of 12 to 40 characters,
 * float `created_at`/`modified_at`, microsecond ISO timestamps, 26-character `context.id`, MAC
 * `connections`). Every `friendly_name` is distinct and numeric attribute values vary per entity.
 * The mix follows typical installations: sensors dominate, then binary sensors, lights, switches,
 * automations, updates, and a few cameras, media players, climate devices, people, and zones.
 */

export interface Fixture {
  haVersion: string;
  user: JsonObject;
  records: RawRecords;
}

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }
  weighted<T>(items: readonly { w: number; v: T }[]): T {
    const total = items.reduce((sum, item) => sum + item.w, 0);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= item.w;
      if (roll < 0) return item.v;
    }
    return (items[items.length - 1] as { v: T }).v;
  }
  hex(length: number): string {
    let out = "";
    while (out.length < length)
      out += Math.floor(this.next() * 16).toString(16);
    return out;
  }
  ulid(): string {
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let out = "01";
    while (out.length < 26)
      out += alphabet.charAt(this.int(0, alphabet.length - 1));
    return out;
  }
  float(min: number, max: number, decimals: number): number {
    return Number((min + this.next() * (max - min)).toFixed(decimals));
  }
  mac(): string {
    return Array.from({ length: 6 }, () => this.hex(2)).join(":");
  }
}

function slug(text: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s === "" ? "x" : s;
}

const AREAS: readonly (readonly [string, string, string | null])[] = [
  ["kitchen", "Kitchen", "ground"],
  ["living_room", "Living room", "ground"],
  ["bedroom", "Bedroom", "first"],
  ["hallway", "Hallway", "ground"],
  ["bathroom", "Bathroom", "first"],
  ["office", "Office", "first"],
  ["garage", "Garage", null],
  ["garden", "Garden 🌳", null],
  ["kuche", "Küche", "ground"],
  ["wohnzimmer", "Wohnzimmer", "ground"],
  ["ke_ting", "客厅", "ground"],
  ["sotano", "Sótano", null],
];

type Kind =
  | "sensor"
  | "binary_sensor"
  | "light"
  | "switch"
  | "automation"
  | "update"
  | "camera"
  | "media_player"
  | "climate"
  | "person"
  | "zone"
  | "device_tracker";

interface Profile {
  platform: string;
  weight: number;
  entries: number;
  devices: boolean;
  kinds: readonly { w: number; v: Kind }[];
  makers: readonly (readonly [string, string, string])[];
}

const PROFILES: readonly Profile[] = [
  {
    platform: "zha",
    weight: 20,
    entries: 1,
    devices: true,
    kinds: [
      { w: 45, v: "sensor" },
      { w: 30, v: "binary_sensor" },
      { w: 15, v: "light" },
      { w: 10, v: "switch" },
    ],
    makers: [
      ["IKEA of Sweden", "TRADFRI bulb E27 WS opal 980lm", "LED1545G12"],
      ["LUMI", "lumi.weather", "WSDCGQ11LM"],
      ["SONOFF", "SNZB-03", "SNZB-03"],
    ],
  },
  {
    platform: "hue",
    weight: 10,
    entries: 1,
    devices: true,
    kinds: [
      { w: 50, v: "light" },
      { w: 20, v: "sensor" },
      { w: 20, v: "binary_sensor" },
      { w: 10, v: "switch" },
    ],
    makers: [
      ["Signify Netherlands B.V.", "Hue color lamp", "LCA001"],
      ["Signify Netherlands B.V.", "Hue motion sensor", "SML001"],
    ],
  },
  {
    platform: "shelly",
    weight: 8,
    entries: 1,
    devices: true,
    kinds: [
      { w: 50, v: "switch" },
      { w: 50, v: "sensor" },
    ],
    makers: [["Shelly", "Shelly Plus 1PM", "SNSW-001P16EU"]],
  },
  {
    platform: "esphome",
    weight: 16,
    entries: 2,
    devices: true,
    kinds: [
      { w: 60, v: "sensor" },
      { w: 20, v: "binary_sensor" },
      { w: 10, v: "switch" },
      { w: 10, v: "light" },
    ],
    makers: [["Espressif", "esp32-poe", "esp32-poe"]],
  },
  {
    platform: "mqtt",
    weight: 14,
    entries: 1,
    devices: true,
    kinds: [
      { w: 70, v: "sensor" },
      { w: 20, v: "binary_sensor" },
      { w: 10, v: "switch" },
    ],
    makers: [["Zigbee2MQTT", "Generic sensor", "GEN-01"]],
  },
  {
    platform: "sonos",
    weight: 3,
    entries: 1,
    devices: true,
    kinds: [{ w: 100, v: "media_player" }],
    makers: [["Sonos", "Sonos One", "S18"]],
  },
  {
    platform: "hassio",
    weight: 4,
    entries: 1,
    devices: true,
    kinds: [
      { w: 50, v: "update" },
      { w: 30, v: "sensor" },
      { w: 20, v: "binary_sensor" },
    ],
    makers: [["Home Assistant", "Add-on", "addon"]],
  },
  {
    platform: "nest",
    weight: 3,
    entries: 1,
    devices: true,
    kinds: [
      { w: 40, v: "climate" },
      { w: 10, v: "camera" },
      { w: 50, v: "sensor" },
    ],
    makers: [["Google Inc.", "Nest Thermostat", "GA02081-US"]],
  },
  {
    platform: "mobile_app",
    weight: 2,
    entries: 1,
    devices: true,
    kinds: [
      { w: 40, v: "device_tracker" },
      { w: 60, v: "sensor" },
    ],
    makers: [["Apple", "iPhone", "iPhone15,2"]],
  },
  {
    platform: "automation",
    weight: 8,
    entries: 0,
    devices: false,
    kinds: [{ w: 100, v: "automation" }],
    makers: [],
  },
  {
    platform: "template",
    weight: 5,
    entries: 0,
    devices: false,
    kinds: [
      { w: 50, v: "sensor" },
      { w: 50, v: "binary_sensor" },
    ],
    makers: [],
  },
];

const FORCED: readonly { platform: string; kind: Kind }[] = [
  { platform: "person", kind: "person" },
  { platform: "person", kind: "person" },
  { platform: "zone", kind: "zone" },
  { platform: "mobile_app", kind: "device_tracker" },
  { platform: "nest", kind: "camera" },
  { platform: "hassio", kind: "update" },
  { platform: "nest", kind: "climate" },
  { platform: "sonos", kind: "media_player" },
  { platform: "hue", kind: "light" },
  { platform: "automation", kind: "automation" },
];

const SENSOR_TYPES = [
  {
    name: "Temperature",
    unit: "°C",
    cls: "temperature",
    cat: null,
    lo: 14,
    hi: 29,
    dec: 1,
    sc: "measurement",
  },
  {
    name: "Humidity",
    unit: "%",
    cls: "humidity",
    cat: null,
    lo: 25,
    hi: 80,
    dec: 1,
    sc: "measurement",
  },
  {
    name: "Power",
    unit: "W",
    cls: "power",
    cat: null,
    lo: 0,
    hi: 2400,
    dec: 1,
    sc: "measurement",
  },
  {
    name: "Energy",
    unit: "kWh",
    cls: "energy",
    cat: null,
    lo: 0,
    hi: 9000,
    dec: 3,
    sc: "total_increasing",
  },
  {
    name: "Battery",
    unit: "%",
    cls: "battery",
    cat: "diagnostic",
    lo: 5,
    hi: 100,
    dec: 0,
    sc: "measurement",
  },
  {
    name: "Signal strength",
    unit: "dBm",
    cls: "signal_strength",
    cat: "diagnostic",
    lo: -95,
    hi: -40,
    dec: 0,
    sc: "measurement",
  },
  {
    name: "Illuminance",
    unit: "lx",
    cls: "illuminance",
    cat: null,
    lo: 0,
    hi: 900,
    dec: 0,
    sc: "measurement",
  },
  {
    name: "Voltage",
    unit: "V",
    cls: "voltage",
    cat: null,
    lo: 218,
    hi: 243,
    dec: 1,
    sc: "measurement",
  },
  {
    name: "Link quality",
    unit: "lqi",
    cls: null,
    cat: "diagnostic",
    lo: 0,
    hi: 255,
    dec: 0,
    sc: "measurement",
  },
] as const;

const BINARY_TYPES = [
  { name: "Motion", cls: "motion", cat: null },
  { name: "Door", cls: "door", cat: null },
  { name: "Window", cls: "window", cat: null },
  { name: "Occupancy", cls: "occupancy", cat: null },
  { name: "Moisture", cls: "moisture", cat: null },
  { name: "Connectivity", cls: "connectivity", cat: "diagnostic" },
] as const;

function isoAt(rng: Rng, dayOffset: number): string {
  const day = String(20 + (dayOffset % 8)).padStart(2, "0");
  const hh = String(rng.int(0, 23)).padStart(2, "0");
  const mm = String(rng.int(0, 59)).padStart(2, "0");
  const ss = String(rng.int(0, 59)).padStart(2, "0");
  const micro = String(rng.int(0, 999999)).padStart(6, "0");
  return `2026-09-${day}T${hh}:${mm}:${ss}.${micro}+00:00`;
}

function epochAt(rng: Rng): number {
  return Number((1726000000 + rng.next() * 30_000_000).toFixed(6));
}

interface Made {
  state: string;
  attributes: JsonObject;
  originalName: string;
  options: JsonObject;
  entityCategory: string | null;
}

export function generate(entityCount: number, seed: number): Fixture {
  const rng = new Rng(seed);
  const haVersion = "2026.9.1";

  const config: JsonObject = {
    latitude: 52.3731,
    longitude: 4.8922,
    elevation: 12,
    radius: 100,
    unit_system: {
      length: "km",
      accumulated_precipitation: "mm",
      mass: "g",
      pressure: "Pa",
      temperature: "°C",
      volume: "L",
      wind_speed: "m/s",
    },
    location_name: "Home",
    time_zone: "Europe/Amsterdam",
    components: Array.from({ length: 180 }, (_, i) => `integration_${i}`),
    config_dir: "/config",
    allowlist_external_dirs: ["/config/www", "/media"],
    allowlist_external_urls: [],
    version: haVersion,
    internal_url: "http://192.168.1.10:8123",
    external_url: null,
    currency: "EUR",
    country: "NL",
    language: "en",
    safe_mode: false,
    recovery_mode: false,
    state: "RUNNING",
    debug: false,
  };
  const user: JsonObject = {
    id: rng.hex(32),
    name: "Owner",
    is_owner: true,
    is_admin: true,
    credentials: [],
    mfa_modules: [],
  };

  if (entityCount === 0) {
    return {
      haVersion,
      user,
      records: {
        config,
        states: [],
        entity_registry: [],
        device_registry: [],
        area_registry: [],
        config_entries: [],
      },
    };
  }

  const areas: RawArea[] = AREAS.map(([areaId, name, floor]) => ({
    aliases: [],
    area_id: areaId,
    floor_id: floor,
    humidity_entity_id: null,
    icon: null,
    labels: [],
    name,
    picture: null,
    temperature_entity_id: null,
    created_at: epochAt(rng),
    modified_at: epochAt(rng),
  }));

  const configEntries: RawConfigEntry[] = [];
  const entriesByPlatform = new Map<string, string[]>();
  for (const profile of PROFILES) {
    const ids: string[] = [];
    for (let i = 0; i < profile.entries; i++) {
      const entryId = rng.ulid();
      ids.push(entryId);
      configEntries.push({
        created_at: epochAt(rng),
        entry_id: entryId,
        domain: profile.platform,
        modified_at: epochAt(rng),
        title: `${profile.platform} ${rng.hex(6).toUpperCase()}`,
        source: rng.pick(["user", "user", "zeroconf", "discovery"]),
        state: "loaded",
        supports_options: rng.chance(0.5),
        supports_remove_device: true,
        supports_unload: true,
        supports_reconfigure: false,
        supported_subentry_types: {},
        pref_disable_new_entities: false,
        pref_disable_polling: false,
        disabled_by: null,
        reason: null,
        error_reason_translation_domain: null,
        error_reason_translation_key: null,
        error_reason_translation_placeholders: null,
        num_subentries: 0,
      });
    }
    entriesByPlatform.set(profile.platform, ids);
  }
  // Non-entity-bearing entries so summaries have integrations without entities.
  for (const domain of ["sun", "met"]) {
    configEntries.push({
      created_at: epochAt(rng),
      entry_id: rng.ulid(),
      domain,
      modified_at: epochAt(rng),
      title: domain === "sun" ? "Sun" : "Home",
      source: "user",
      state: "loaded",
    });
  }

  const devices: RawDevice[] = [];
  const devicesByPlatform = new Map<string, RawDevice[]>();
  const entities: RawEntityRegistryEntry[] = [];
  const states: RawState[] = [];
  const usedIds = new Set<string>();
  let deviceCounter = 0;

  function newDevice(profile: Profile): RawDevice {
    deviceCounter++;
    const [manufacturer, model, modelId] = rng.pick(profile.makers);
    const entry = rng.pick(entriesByPlatform.get(profile.platform) ?? []);
    const mac = rng.mac();
    const room = rng.pick(AREAS);
    const area = rng.chance(0.86) ? room[0] : null;
    const name = `${room[1]} ${model.split(" ")[0] ?? "Device"} ${deviceCounter}`;
    const device: RawDevice = {
      area_id: area,
      config_entries: [entry],
      config_entries_subentries: { [entry]: [null] },
      configuration_url: rng.chance(0.3)
        ? `http://192.168.1.${rng.int(2, 250)}`
        : null,
      connections: [["mac", mac]],
      created_at: epochAt(rng),
      disabled_by: null,
      entry_type: null,
      hw_version: rng.chance(0.5) ? `${rng.int(1, 4)}.${rng.int(0, 9)}` : null,
      id: rng.hex(32),
      identifiers: [[profile.platform, `${mac}-${rng.hex(4)}`]],
      labels: [],
      manufacturer,
      model,
      model_id: modelId,
      modified_at: epochAt(rng),
      name_by_user: rng.chance(0.15) ? `${name} (custom)` : null,
      name,
      primary_config_entry: entry,
      serial_number: rng.chance(0.4) ? rng.hex(12).toUpperCase() : null,
      sw_version: `${rng.int(1, 9)}.${rng.int(0, 30)}.${rng.int(0, 20)}`,
      via_device_id: null,
      config_entry_id: null,
      config_subentry_id: null,
    };
    devices.push(device);
    const list = devicesByPlatform.get(profile.platform) ?? [];
    list.push(device);
    devicesByPlatform.set(profile.platform, list);
    return device;
  }

  function make(kind: Kind, friendly: string, index: number): Made {
    const exposeOptions: JsonObject = rng.chance(0.6)
      ? { conversation: { should_expose: false } }
      : {};
    switch (kind) {
      case "sensor": {
        const t = rng.pick(SENSOR_TYPES);
        const attributes: JsonObject = {
          ...(rng.chance(0.85) ? { state_class: t.sc } : {}),
          unit_of_measurement: t.unit,
          ...(t.cls === null ? {} : { device_class: t.cls }),
          friendly_name: friendly,
        };
        const options: JsonObject =
          t.dec > 0 && rng.chance(0.5)
            ? {
                ...exposeOptions,
                sensor: { suggested_display_precision: t.dec },
              }
            : exposeOptions;
        return {
          state: String(rng.float(t.lo, t.hi, t.dec)),
          attributes,
          originalName: t.name,
          options,
          entityCategory: t.cat,
        };
      }
      case "binary_sensor": {
        const t = rng.pick(BINARY_TYPES);
        return {
          state: rng.chance(0.3) ? "on" : "off",
          attributes: { device_class: t.cls, friendly_name: friendly },
          originalName: t.name,
          options: exposeOptions,
          entityCategory: t.cat,
        };
      }
      case "light": {
        const on = rng.chance(0.5);
        const attributes: JsonObject = on
          ? {
              min_color_temp_kelvin: 2000,
              max_color_temp_kelvin: 6535,
              min_mireds: 153,
              max_mireds: 500,
              supported_color_modes: ["color_temp", "xy"],
              color_mode: "color_temp",
              brightness: rng.int(1, 255),
              color_temp_kelvin: rng.int(2000, 6500),
              color_temp: rng.int(153, 500),
              hs_color: [rng.float(0, 360, 3), rng.float(0, 100, 3)],
              rgb_color: [rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)],
              xy_color: [rng.float(0, 1, 3), rng.float(0, 1, 3)],
              friendly_name: friendly,
              supported_features: 0,
            }
          : {
              min_color_temp_kelvin: 2000,
              max_color_temp_kelvin: 6535,
              min_mireds: 153,
              max_mireds: 500,
              supported_color_modes: ["color_temp", "xy"],
              color_mode: null,
              friendly_name: friendly,
              supported_features: 0,
            };
        return {
          state: on ? "on" : "off",
          attributes,
          originalName: "Light",
          options: exposeOptions,
          entityCategory: null,
        };
      }
      case "switch":
        return {
          state: rng.chance(0.4) ? "on" : "off",
          attributes: {
            device_class: rng.pick(["outlet", "switch"]),
            friendly_name: friendly,
          },
          originalName: rng.pick(["Relay", "Outlet", "Switch"]),
          options: exposeOptions,
          entityCategory: null,
        };
      case "automation":
        return {
          state: rng.chance(0.9) ? "on" : "off",
          attributes: {
            id: String(1_700_000_000_000 + rng.int(0, 99_999_999)),
            last_triggered: rng.chance(0.8) ? isoAt(rng, index) : null,
            mode: rng.pick(["single", "restart", "queued"]),
            current: 0,
            friendly_name: friendly,
          },
          originalName: friendly,
          options: {},
          entityCategory: null,
        };
      case "update":
        return {
          state: rng.chance(0.3) ? "on" : "off",
          attributes: {
            auto_update: false,
            installed_version: `${rng.int(1, 9)}.${rng.int(0, 30)}.${rng.int(0, 9)}`,
            in_progress: false,
            latest_version: `${rng.int(1, 9)}.${rng.int(0, 30)}.${rng.int(0, 9)}`,
            release_summary: null,
            release_url: `https://github.com/example/addon-${index}/releases`,
            skipped_version: null,
            title: `Add-on ${index}`,
            update_percentage: null,
            entity_picture: `https://brands.example.invalid/_/addon_${index}/icon.png`,
            friendly_name: friendly,
            supported_features: 23,
            device_class: "firmware",
          },
          originalName: "Update",
          options: exposeOptions,
          entityCategory: "diagnostic",
        };
      case "camera": {
        const token = rng.hex(32);
        return {
          state: "idle",
          attributes: {
            access_token: token,
            entity_picture: `/api/camera_proxy/camera.front_door_${index}?token=${token}`,
            friendly_name: friendly,
            frontend_stream_type: "hls",
            supported_features: 2,
          },
          originalName: "Camera",
          options: {},
          entityCategory: null,
        };
      }
      case "media_player":
        return {
          state: rng.pick(["paused", "idle", "playing", "off"]),
          attributes: {
            volume_level: rng.float(0, 1, 2),
            is_volume_muted: rng.chance(0.2),
            friendly_name: friendly,
            supported_features: 152461,
            device_class: "speaker",
          },
          originalName: "Speaker",
          options: exposeOptions,
          entityCategory: null,
        };
      case "climate":
        return {
          state: rng.pick(["heat", "off", "auto"]),
          attributes: {
            hvac_modes: ["off", "heat", "cool", "heat_cool"],
            min_temp: 9,
            max_temp: 32,
            target_temp_step: 0.5,
            current_temperature: rng.float(15, 26, 1),
            temperature: rng.float(16, 24, 1),
            hvac_action: rng.pick(["heating", "idle", "off"]),
            preset_modes: ["none", "eco"],
            preset_mode: "none",
            friendly_name: friendly,
            supported_features: 401,
          },
          originalName: "Thermostat",
          options: exposeOptions,
          entityCategory: null,
        };
      case "person":
        return {
          state: "home",
          attributes: {
            editable: false,
            id: rng.hex(32),
            device_trackers: [`device_tracker.phone_${index}`],
            user_id: rng.hex(32),
            latitude: rng.float(52.3, 52.4, 6),
            longitude: rng.float(4.8, 4.9, 6),
            gps_accuracy: rng.int(5, 40),
            source: `device_tracker.phone_${index}`,
            friendly_name: friendly,
          },
          originalName: friendly,
          options: {},
          entityCategory: null,
        };
      case "zone":
        return {
          state: String(rng.int(0, 2)),
          attributes: {
            latitude: rng.float(52.3, 52.4, 6),
            longitude: rng.float(4.8, 4.9, 6),
            radius: rng.int(50, 250),
            passive: false,
            persons: [],
            editable: true,
            icon: "mdi:map-marker",
            friendly_name: friendly,
          },
          originalName: friendly,
          options: {},
          entityCategory: null,
        };
      case "device_tracker":
        return {
          state: "home",
          attributes: {
            source_type: "gps",
            latitude: rng.float(52.3, 52.4, 6),
            longitude: rng.float(4.8, 4.9, 6),
            gps_accuracy: rng.int(5, 40),
            battery_level: rng.int(10, 100),
            friendly_name: friendly,
          },
          originalName: "Location",
          options: {},
          entityCategory: null,
        };
    }
  }

  const profileByPlatform = new Map(PROFILES.map((p) => [p.platform, p]));
  const forcedCount = entityCount >= FORCED.length * 2 ? FORCED.length : 0;
  const orphanEntityIndex = Math.min(3, entityCount - 1);

  for (let i = 0; i < entityCount; i++) {
    const forced = i < forcedCount ? FORCED[i] : undefined;
    const profile: Profile | undefined = forced
      ? (profileByPlatform.get(forced.platform) ?? {
          platform: forced.platform,
          weight: 0,
          entries: 0,
          devices: false,
          kinds: [],
          makers: [],
        })
      : rng.weighted(PROFILES.map((p) => ({ w: p.weight, v: p })));
    const kind: Kind = forced ? forced.kind : rng.weighted(profile.kinds);

    let device: RawDevice | undefined;
    if (profile.devices) {
      const existing = devicesByPlatform.get(profile.platform) ?? [];
      const target = Math.max(1, Math.round(entityCount / 3));
      device =
        existing.length === 0 || (devices.length < target && rng.chance(0.45))
          ? newDevice(profile)
          : rng.pick(existing);
    }

    const deviceLabel =
      device === undefined ? rng.pick(AREAS)[1] : (device.name as string);
    const made0 = make(kind, "", i);
    const originalName = made0.originalName;
    const friendly =
      kind === "automation"
        ? `Automation ${i} ${rng.pick(["lights off", "morning routine", "alert", "heating schedule"])}`
        : kind === "person" || kind === "zone"
          ? `${kind === "person" ? "Person" : "Zone"} ${i}`
          : `${deviceLabel} ${originalName}`;
    const made = make(kind, friendly, i);

    let objectId = slug(friendly);
    while (usedIds.has(`${kind}.${objectId}`)) objectId += `_${i}`;
    const entityId = `${kind}.${objectId}`;
    usedIds.add(entityId);

    const entries = entriesByPlatform.get(profile.platform);
    const disabled = kind !== "person" && kind !== "zone" && rng.chance(0.04);
    const entry: RawEntityRegistryEntry = {
      area_id:
        device !== undefined && rng.chance(0.05) ? rng.pick(AREAS)[0] : null,
      categories: {},
      config_entry_id:
        device !== undefined
          ? (device.config_entries as string[])[0]!
          : entries === undefined
            ? null
            : (entries[0] ?? null),
      config_subentry_id: null,
      created_at: epochAt(rng),
      device_id: device === undefined ? null : (device.id as string),
      disabled_by: disabled ? "integration" : null,
      entity_category: made.entityCategory,
      entity_id: entityId,
      has_entity_name: kind !== "automation",
      hidden_by: !disabled && rng.chance(0.03) ? "user" : null,
      icon: kind === "zone" ? null : rng.chance(0.03) ? "mdi:flash" : null,
      id: rng.hex(32),
      labels: [],
      modified_at: epochAt(rng),
      name: rng.chance(0.06) ? friendly : null,
      options: made.options,
      original_name: kind === "automation" ? friendly : originalName,
      platform: profile.platform,
      translation_key: rng.chance(0.3) ? slug(originalName) : null,
      unique_id:
        kind === "automation"
          ? String(made.attributes["id"])
          : `${rng.hex(rng.int(12, 24))}-${rng.int(1, 9)}-${rng.hex(4)}`,
    };

    if (i === orphanEntityIndex && device !== undefined) {
      entry.device_id = rng.hex(32); // orphan device reference
    }
    if (i === orphanEntityIndex + 1 && device !== undefined) {
      entry.config_entry_id = rng.ulid(); // orphan config entry reference
    }
    entities.push(entry);

    if (!disabled) {
      states.push({
        entity_id: entityId,
        state: made.state,
        attributes: made.attributes,
        last_changed: isoAt(rng, i),
        last_reported: isoAt(rng, i),
        last_updated: isoAt(rng, i),
        context: { id: rng.ulid(), parent_id: null, user_id: null },
      });
    }
  }

  // State-only entities (no registry entry), about 2% of the total.
  const stateOnly = Math.max(1, Math.round(entityCount * 0.02));
  for (let i = 0; i < stateOnly; i++) {
    const kind: Kind = i % 2 === 0 ? "sensor" : "binary_sensor";
    const entityId = `${kind}.legacy_template_${i}`;
    const friendly = `Legacy template ${i}`;
    states.push({
      entity_id: entityId,
      state: kind === "sensor" ? String(rng.float(0, 100, 1)) : "off",
      attributes: { friendly_name: friendly },
      last_changed: isoAt(rng, i),
      last_reported: isoAt(rng, i),
      last_updated: isoAt(rng, i),
      context: { id: rng.ulid(), parent_id: null, user_id: null },
    });
  }

  // Orphan references on devices and areas, and valid area sensor references.
  if (devices.length >= 2) {
    (devices[0] as RawDevice)["area_id"] = "ghost_area"; // orphan area reference
    (devices[1] as RawDevice)["via_device_id"] = rng.hex(32); // orphan via-device reference
  }
  (areas[2] as RawArea)["temperature_entity_id"] =
    "sensor.ghost_bedroom_temperature"; // orphan entity
  const temperatureSensors = states.filter(
    (s) =>
      (s.attributes as JsonObject | undefined)?.["device_class"] ===
      "temperature",
  );
  if (temperatureSensors[0] !== undefined) {
    (areas[0] as RawArea)["temperature_entity_id"] =
      temperatureSensors[0].entity_id;
  }

  return {
    haVersion,
    user,
    records: {
      config,
      states,
      entity_registry: entities,
      device_registry: devices,
      area_registry: areas,
      config_entries: configEntries,
    },
  };
}

export const REFERENCE_500: Fixture = generate(500, 500);
export const PERF_1000: Fixture = generate(1000, 1000);
export const EMPTY: Fixture = generate(0, 0);
