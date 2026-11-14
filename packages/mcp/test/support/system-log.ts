import type { RawLevel, RawLogEntry } from "../../src/ha/system-log.js";
import {
  systemLogFixture,
  type SystemLogFixture,
} from "../fixtures/generate-system-log.js";

/** Small synthetic system logs for `ha_system_log` tests (specs/012-ha-system-log). */

/** Seconds since the epoch of a local time in Europe/Madrid in November (+01:00). */
export const at = (local: string): number =>
  Date.parse(`${local}+01:00`) / 1000;

/** The call time of every test: 2026-11-13T12:00:00 in Europe/Madrid. */
export const NOW_MS = at("2026-11-13T12:00:00") * 1000;

const HA = "/usr/src/homeassistant/homeassistant/";
const PY = "/usr/local/lib/python3.14/";

export function entry(
  fields: Partial<RawLogEntry> & {
    name: string;
    source: [string, number];
    last: string;
    first?: string;
  },
): RawLogEntry {
  const { last, first, ...rest } = fields;
  const timestamp = at(last) + 0.512345;
  return {
    message: ["Something went wrong"],
    level: "ERROR" as RawLevel,
    exception: "",
    count: 1,
    ...rest,
    timestamp,
    first_occurred: first === undefined ? timestamp : at(first) + 0.25,
  };
}

/** The traceback of the MQTT entry, as the instance records it. */
export const MQTT_TRACEBACK = [
  "Traceback (most recent call last):",
  `  File "${HA}components/mqtt/client.py", line 598, in _async_connect`,
  "    await self._mqttc.connect(host, port)",
  `  File "${PY}site-packages/paho/mqtt/client.py", line 1435, in connect`,
  "    return self.reconnect()",
  "           ~~~~~~~~~~~~~~^^",
  "ConnectionRefusedError: [Errno 111] Connection refused",
].join("\n");

/** A chained traceback of a custom integration. */
export const ACME_TRACEBACK = [
  "Traceback (most recent call last):",
  '  File "/config/custom_components/acme_cloud/api.py", line 41, in get_state',
  '    return payload["state"]["value"]',
  "KeyError: 'value'",
  "",
  "The above exception was the direct cause of the following exception:",
  "",
  "Traceback (most recent call last):",
  '  File "/config/custom_components/acme_cloud/__init__.py", line 88, in async_update',
  "    data = await self.client.get_state()",
  '  File "/config/custom_components/acme_cloud/api.py", line 43, in get_state',
  '    raise UpdateFailed("bad payload") from err',
  "UpdateFailed: bad payload",
].join("\n");

/**
 * Twelve entries, newest first as the instance answers: built-in, custom and library loggers, a
 * `py.warnings` entry, helpers and the core, every level, an entry of the day before, and three
 * entries at the same time that only the logger and source order.
 */
export const SMALL_LOG: RawLogEntry[] = [
  entry({
    name: "homeassistant.helpers.event",
    source: ["helpers/template/__init__.py", 466],
    last: "2026-11-13T09:31:12",
    message: [
      "Error while processing template: Template<template=({{ 1 / 0 }}) renders=2>",
    ],
  }),
  entry({
    name: "pyacme.client",
    level: "WARNING",
    source: ["custom_components/acme_cloud/__init__.py", 120],
    last: "2026-11-13T09:30:00",
    first: "2026-11-13T08:00:30",
    count: 7,
    message: ["Connection lost, reconnecting in 30 seconds"],
  }),
  entry({
    name: "custom_components.acme_cloud",
    source: ["custom_components/acme_cloud/api.py", 41],
    last: "2026-11-13T09:20:05",
    message: ["Update failed for user someone@example.com"],
    exception: ACME_TRACEBACK,
  }),
  entry({
    name: "homeassistant.components.mqtt.client",
    source: ["components/mqtt/client.py", 612],
    last: "2026-11-13T09:15:40",
    first: "2026-11-13T08:02:11",
    count: 3,
    message: [
      "Failed to connect to MQTT server due to exception: [Errno 111] Connection refused",
    ],
    exception: MQTT_TRACEBACK,
  }),
  entry({
    name: "homeassistant.components.zha",
    level: "WARNING",
    source: ["components/zha/core.py", 5],
    last: "2026-11-13T08:40:00",
    message: ["Device zha_7 is unavailable, will retry"],
  }),
  entry({
    name: "homeassistant.components.cast",
    level: "WARNING",
    source: ["components/cast/media_player.py", 300],
    last: "2026-11-13T08:40:00",
    message: ["Cast device cast_2 lost its connection"],
  }),
  entry({
    name: "homeassistant.components.zha",
    level: "WARNING",
    source: ["components/zha/__init__.py", 10],
    last: "2026-11-13T08:40:00",
    message: ["Radio zha_1 is slow to answer", "Radio zha_1 answered late"],
  }),
  entry({
    name: "pyhueplus.api",
    level: "WARNING",
    source: ["custom_components/hue_plus/sensor.py", 30],
    last: "2026-11-13T08:30:00",
    message: ["Bridge sent an empty reply"],
  }),
  entry({
    name: "homeassistant.core",
    level: "WARNING",
    source: ["core.py", 900],
    last: "2026-11-13T07:10:00",
    message: ["Something is blocking the event loop"],
  }),
  entry({
    name: "py.warnings",
    level: "WARNING",
    source: ["components/hue/light.py", 77],
    last: "2026-11-13T07:05:00",
    message: [
      `${HA}components/hue/light.py:77: DeprecationWarning: the brightness attribute is deprecated`,
    ],
  }),
  entry({
    name: "homeassistant.components.recorder.core",
    level: "CRITICAL",
    source: ["components/recorder/core.py", 917],
    last: "2026-11-13T06:50:00",
    first: "2026-11-12T23:50:00",
    count: 2,
    message: ["The recorder could not start, check the database connection"],
  }),
  entry({
    name: "homeassistant.components.sun",
    level: "WARNING",
    source: ["components/sun/entity.py", 99],
    last: "2026-11-12T22:00:00",
    message: ["The sun is in an unexpected position"],
  }),
];

export const SMALL_HOME: SystemLogFixture = systemLogFixture(SMALL_LOG);
