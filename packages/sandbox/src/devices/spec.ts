import { SandboxError } from "../errors.js";

export const DEVICE_KINDS = [
  "switch",
  "binary_sensor",
  "sensor",
  "light",
  "lock",
  "fan",
  "cover",
  "valve",
  "device_tracker",
] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface VirtualDeviceSpec {
  /** 1 to 64 characters, unique within the instance. */
  name: string;
  kind: DeviceKind;
  /** The integration's `class`, for example `motion` on a binary sensor. */
  class?: string;
  /** The integration's `initial_value`. */
  initial?: string;
}

export interface VirtualDevice extends VirtualDeviceSpec {
  /** Read back from the instance after creation. */
  entityId: string;
}

/** The file inside the container, relative to the configuration directory. */
export const DEVICE_FILE = "domusops-virtual.yaml";

export const MAX_DEVICE_NAME = 64;

function isKind(value: unknown): value is DeviceKind {
  return (DEVICE_KINDS as readonly unknown[]).includes(value);
}

/** The integration reads a leading `+` or `!` in a name as an instruction about the entity id. */
const RESERVED_NAME_START = /^[+!]/;

/** The id fragment Home Assistant derives from a name; names with the same one would collide. */
export function slugOf(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? name.toLowerCase() : slug;
}

/**
 * Checks `specs` and returns them normalised. `taken` holds the names already in the instance.
 * A kind the device integration does not offer is a `SandboxError`; everything else wrong with
 * the input is a programmer error, thrown before anything is touched.
 */
export function validateDevices(
  specs: readonly VirtualDeviceSpec[],
  taken: readonly string[] = [],
): VirtualDeviceSpec[] {
  if (!Array.isArray(specs)) {
    throw new TypeError("`devices` must be an array of device specifications.");
  }
  const seen = new Set(taken.map(slugOf));
  return specs.map((spec, index) => {
    const where = `devices[${String(index)}]`;
    if (typeof spec !== "object" || spec === null) {
      throw new TypeError(`${where} must be an object.`);
    }
    if (!isKind(spec.kind)) {
      throw new SandboxError(
        "unsupported_device_kind",
        `${where}: "${String(spec.kind)}" is not a device kind the virtual-device integration (hass-virtual) offers. Use one of: ${DEVICE_KINDS.join(", ")}.`,
      );
    }
    if (typeof spec.name !== "string") {
      throw new TypeError(`${where}.name must be a string.`);
    }
    const name = spec.name.trim();
    if (name === "" || name.length > MAX_DEVICE_NAME) {
      throw new TypeError(
        `${where}.name must be 1 to ${String(MAX_DEVICE_NAME)} characters.`,
      );
    }
    if (/\p{Cc}/u.test(name)) {
      throw new TypeError(`${where}.name must not contain control characters.`);
    }
    if (RESERVED_NAME_START.test(name)) {
      throw new TypeError(`${where}.name must not start with "+" or "!".`);
    }
    if (seen.has(slugOf(name))) {
      throw new TypeError(
        `${where}.name "${name}" is already used by another device in this instance (names are compared by the entity id they produce, so "Hall Light" and "hall-light" collide).`,
      );
    }
    seen.add(slugOf(name));
    for (const field of ["class", "initial"] as const) {
      const value = spec[field];
      if (value !== undefined && (typeof value !== "string" || value === "")) {
        throw new TypeError(`${where}.${field} must be a non-empty string.`);
      }
    }
    const normal: VirtualDeviceSpec = { name, kind: spec.kind };
    if (spec.class !== undefined) normal.class = spec.class;
    if (spec.initial !== undefined) normal.initial = spec.initial;
    return normal;
  });
}

/**
 * The integration's device file for `devices`: one device per specification, holding one entity
 * with an explicit name, so the entity id is `<kind>.<slug of the name>`. Strings are written as
 * JSON strings, which are valid YAML scalars, so no value needs escaping rules of its own.
 */
export function renderDeviceFile(
  devices: readonly VirtualDeviceSpec[],
): string {
  const lines = ["version: 1", "devices:"];
  if (devices.length === 0) lines[1] = "devices: {}";
  for (const device of devices) {
    lines.push(`  ${JSON.stringify(device.name)}:`);
    lines.push(`    - platform: ${device.kind}`);
    lines.push(`      name: ${JSON.stringify(device.name)}`);
    if (device.class !== undefined) {
      lines.push(`      class: ${JSON.stringify(device.class)}`);
    }
    if (device.initial !== undefined) {
      lines.push(`      initial_value: ${JSON.stringify(device.initial)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
