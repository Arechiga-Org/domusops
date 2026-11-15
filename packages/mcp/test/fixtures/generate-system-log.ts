import type { RawLevel, RawLogEntry } from "../../src/ha/system-log.js";
import { EMPTY, Rng, type Fixture } from "./generate.js";

/**
 * Deterministic generator of a system log, served by the fake instance's `system_log/list`
 * (specs/012-ha-system-log research R14).
 *
 * Calibration (fixed before encoder work; changing it needs a comment here saying why), from the
 * prototype of research R12: 50 entries, newest first, of which about a quarter are coordinator
 * failures of built-in integrations (half with a traceback through the shared coordinator and HTTP
 * client frames), an eighth custom integration errors with tracebacks and one to five messages,
 * an eighth library loggers whose source lies in a custom integration, a quarter repeated
 * warnings, an eighth platform setup errors sharing the entity platform frames, and an eighth core
 * errors; counts from 1 to 180. Eight more entries carry one of each form research R1 measured: a
 * chained traceback, a `<template>` frame, an absolute source path, a `py.warnings` entry, five
 * messages, a `homeassistant.helpers.*` logger, a critical entry and a library logger's error with
 * a traceback. Paths lie under the container image's three roots; Python 3.11 caret lines appear
 * under some frames; times carry microseconds. Integration names are built-in domains or invented
 * custom ones; no name, message or path comes from a real instance.
 */

export interface SystemLogFixture extends Fixture {
  systemLog: RawLogEntry[];
}

/** The configuration directory of the container image, as `get_config` answers it. */
export const CONFIG_DIR = "/config";
const HA = "/usr/src/homeassistant/homeassistant/";
const PY = "/usr/local/lib/python3.14/";
const CFG = `${CONFIG_DIR}/`;

/** 2026-11-13T06:00:00Z, 07:00 in Europe/Madrid (+01:00): the first entry's first occurrence. */
export const LOG_START = 1_794_549_600;
/** The call time of tests on the reference log: a day after `LOG_START`, after every entry. */
export const LOG_NOW_MS = (LOG_START + 86_400) * 1000;

const BUILT_IN = [
  "mqtt",
  "zha",
  "hue",
  "met",
  "shelly",
  "esphome",
  "sonos",
  "cast",
];
const CUSTOM = ["acme_cloud", "widget_hub", "gizmo"];

class Traces {
  constructor(private readonly rng: Rng) {}

  frame(path: string, line: number, fn: string, code?: string): string {
    let text = `  File "${path}", line ${line}, in ${fn}`;
    if (code === undefined) return text;
    text += `\n    ${code}`;
    if (this.rng.chance(0.6)) {
      text += `\n    ${"~".repeat(this.rng.int(4, 14))}${"^".repeat(this.rng.int(2, 10))}`;
    }
    return text;
  }

  traceback(frames: readonly string[], exception: string): string {
    return `Traceback (most recent call last):\n${frames.join("\n")}\n${exception}`;
  }
}

export function generateSystemLog(seed: number): RawLogEntry[] {
  const rng = new Rng(seed);
  const t = new Traces(rng);
  const coordinator = [
    t.frame(
      `${HA}helpers/update_coordinator.py`,
      380,
      "_async_refresh",
      "self.data = await self._async_update_data()",
    ),
    t.frame(
      `${HA}helpers/update_coordinator.py`,
      287,
      "_async_update_data",
      "return await self.update_method()",
    ),
  ];
  const http = [
    t.frame(
      `${PY}site-packages/aiohttp/client.py`,
      703,
      "_request",
      "conn = await self._connector.connect(",
    ),
    t.frame(
      `${PY}site-packages/aiohttp/connector.py`,
      548,
      "connect",
      "proto = await self._create_connection(req, traces, timeout)",
    ),
    t.frame(
      `${PY}site-packages/aiohttp/connector.py`,
      1056,
      "_create_connection",
      "_, proto = await self._create_direct_connection(req, traces, timeout)",
    ),
    t.frame(
      `${PY}asyncio/base_events.py`,
      1167,
      "create_connection",
      "raise exceptions[0]",
    ),
  ];
  const platform = [
    t.frame(
      `${HA}helpers/entity_platform.py`,
      366,
      "_async_setup_platform",
      "await asyncio.shield(awaitable)",
    ),
    t.frame(
      `${HA}helpers/entity_platform.py`,
      655,
      "async_add_entities",
      "await self._async_add_entity(",
    ),
  ];
  const micro = (): number => rng.int(0, 999_999) / 1e6;

  const entries: RawLogEntry[] = [];
  const add = (
    at: number,
    entry: Omit<RawLogEntry, "timestamp" | "first_occurred" | "count">,
    count = 1,
  ): void => {
    const first = at + micro();
    const last = count === 1 ? first : first + rng.int(60, 40_000) + micro();
    entries.push({ ...entry, timestamp: last, first_occurred: first, count });
  };

  for (let i = 0; i < 42; i++) {
    const at = LOG_START + i * 60;
    const kind = rng.pick([
      "coord",
      "coord",
      "custom",
      "lib",
      "warn",
      "warn",
      "plat",
      "core",
    ]);
    const domain = rng.pick(BUILT_IN);
    const custom = rng.pick(CUSTOM);
    const count = rng.pick([1, 1, 2, 3, 7, 24, 180]);
    const level: RawLevel = "ERROR";
    if (kind === "coord") {
      add(
        at,
        {
          name: `homeassistant.components.${domain}.coordinator`,
          message: [
            `Error fetching ${domain} data: Cannot connect to host device-${i}.local:80 ssl:default [Connect call failed ('192.0.2.${i}', 80)]`,
          ],
          level,
          source: ["helpers/update_coordinator.py", 393],
          exception: rng.chance(0.5)
            ? t.traceback(
                [
                  ...coordinator,
                  t.frame(
                    `${HA}components/${domain}/coordinator.py`,
                    rng.int(40, 200),
                    "_async_update_data",
                    "return await self.api.fetch()",
                  ),
                  ...http,
                ],
                "aiohttp.client_exceptions.ClientConnectorError: Cannot connect to host device.local:80 ssl:default [Connect call failed]",
              )
            : "",
        },
        count,
      );
    } else if (kind === "custom") {
      const line = rng.int(10, 300);
      const fields = ["temp", "mode", "fan", "power", "state"].slice(
        0,
        rng.int(1, 5),
      );
      add(
        at,
        {
          name: `custom_components.${custom}`,
          message: fields.map(
            (f) =>
              `Unexpected payload from ${custom} cloud: missing field '${f}'`,
          ),
          level,
          source: [`custom_components/${custom}/api.py`, line],
          exception: t.traceback(
            [
              t.frame(
                `${CFG}custom_components/${custom}/__init__.py`,
                88,
                "async_update",
                "data = await self.client.get_state()",
              ),
              t.frame(
                `${CFG}custom_components/${custom}/api.py`,
                line,
                "get_state",
                "return self._parse(payload)",
              ),
              t.frame(
                `${CFG}custom_components/${custom}/api.py`,
                41,
                "_parse",
                "return payload['state']['value']",
              ),
            ],
            "KeyError: 'value'",
          ),
        },
        count,
      );
    } else if (kind === "lib") {
      add(
        at,
        {
          name: `py${custom.replace(/_/g, "")}.client`,
          message: ["Connection lost, reconnecting in 30 seconds"],
          level: "WARNING",
          source: [`custom_components/${custom}/__init__.py`, rng.int(10, 300)],
          exception: "",
        },
        count,
      );
    } else if (kind === "warn") {
      add(
        at,
        {
          name: `homeassistant.components.${domain}`,
          message: [`Device ${domain}_${i} is unavailable, will retry`],
          level: "WARNING",
          source: [`components/${domain}/__init__.py`, rng.int(10, 300)],
          exception: "",
        },
        count,
      );
    } else if (kind === "plat") {
      add(
        at,
        {
          name: "homeassistant.components.sensor",
          message: [
            `Error adding entity sensor.${domain}_${i} for domain sensor with platform ${domain}`,
          ],
          level,
          source: ["helpers/entity_platform.py", 680],
          exception: t.traceback(
            [
              ...platform,
              t.frame(
                `${HA}components/${domain}/sensor.py`,
                rng.int(50, 400),
                "native_value",
                "return self.coordinator.data[self._key]",
              ),
            ],
            `KeyError: '${domain}_key'`,
          ),
        },
        count,
      );
    } else {
      add(
        at,
        {
          name: "homeassistant.core",
          message: ["Error doing job: Task exception was never retrieved"],
          level,
          source: ["core.py", 900],
          exception: t.traceback(
            [
              t.frame(`${HA}core.py`, 1012, "_run_safely", "await target"),
              t.frame(
                `${HA}helpers/script.py`,
                523,
                "_async_step",
                "await getattr(self, handler)()",
              ),
            ],
            "homeassistant.exceptions.ServiceNotFound: Action light.turn_of not found",
          ),
        },
        count,
      );
    }
  }

  // One entry of each form research R1 measured.
  const at = LOG_START + 42 * 60;
  add(
    at,
    {
      name: "custom_components.acme_cloud.coordinator",
      message: ["Update failed for acme_cloud"],
      level: "ERROR",
      source: ["custom_components/acme_cloud/coordinator.py", 52],
      exception: [
        t.traceback(
          [
            t.frame(
              `${CFG}custom_components/acme_cloud/api.py`,
              41,
              "get_state",
              'return payload["state"]["value"]',
            ),
          ],
          "KeyError: 'value'",
        ),
        "",
        "The above exception was the direct cause of the following exception:",
        "",
        t.traceback(
          [
            ...coordinator,
            t.frame(
              `${CFG}custom_components/acme_cloud/coordinator.py`,
              52,
              "_async_update_data",
              'raise UpdateFailed("bad payload") from err',
            ),
          ],
          "homeassistant.helpers.update_coordinator.UpdateFailed: bad payload",
        ),
      ].join("\n"),
    },
    3,
  );
  add(
    at + 60,
    {
      name: "homeassistant.helpers.template",
      message: [
        "Error rendering template: ZeroDivisionError: division by zero",
      ],
      level: "ERROR",
      source: ["helpers/template/__init__.py", 466],
      exception: t.traceback(
        [
          t.frame(
            `${HA}helpers/template/__init__.py`,
            664,
            "async_render",
            "render_result = _render_with_context(self.template, compiled, **kwargs)",
          ),
          t.frame("<template>", 1, "top-level template code"),
        ],
        "ZeroDivisionError: division by zero",
      ),
    },
    24,
  );
  add(at + 120, {
    name: "aiohttp.server",
    message: ["Error handling request from 192.0.2.77"],
    level: "ERROR",
    source: [`${PY}site-packages/aiohttp/web_protocol.py`, 421],
    exception: t.traceback(
      [
        t.frame(
          `${PY}site-packages/aiohttp/web_protocol.py`,
          421,
          "_handle_request",
          "resp = await request_handler(request)",
        ),
      ],
      "aiohttp.web_exceptions.HTTPBadRequest: Bad Request",
    ),
  });
  add(at + 180, {
    name: "py.warnings",
    message: [
      `${CFG}custom_components/gizmo/sensor.py:77: DeprecationWarning: datetime.datetime.utcnow() is deprecated`,
    ],
    level: "WARNING",
    source: ["custom_components/gizmo/sensor.py", 77],
    exception: "",
  });
  add(
    at + 240,
    {
      name: "custom_components.widget_hub",
      message: ["temp", "mode", "fan", "power", "state"].map(
        (f) => `Unexpected payload from widget_hub cloud: missing field '${f}'`,
      ),
      level: "WARNING",
      source: ["custom_components/widget_hub/api.py", 120],
      exception: "",
    },
    180,
  );
  add(
    at + 300,
    {
      name: "homeassistant.helpers.event",
      message: [
        "Error while dispatching event for sensor.porch_8 to <Job track state_changed event>",
      ],
      level: "ERROR",
      source: ["helpers/event.py", 349],
      exception: "",
    },
    2,
  );
  add(at + 360, {
    name: "homeassistant.components.recorder.core",
    message: ["The recorder could not start, check the database connection"],
    level: "CRITICAL",
    source: ["components/recorder/core.py", 917],
    exception: "",
  });
  add(
    at + 420,
    {
      name: "pygizmo.protocol",
      message: ["Unexpected frame from the gizmo bridge"],
      level: "ERROR",
      source: ["custom_components/gizmo/__init__.py", 64],
      exception: t.traceback(
        [
          t.frame(
            `${CFG}custom_components/gizmo/__init__.py`,
            64,
            "async_setup_entry",
            "await bridge.connect()",
          ),
          t.frame(
            `${PY}site-packages/pygizmo/protocol.py`,
            210,
            "connect",
            "raise ProtocolError(frame)",
          ),
        ],
        "pygizmo.protocol.ProtocolError: unexpected frame",
      ),
    },
    7,
  );

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

/** A fixture whose instance runs in Europe/Madrid, loads `system_log` and keeps `entries`. */
export function systemLogFixture(entries: RawLogEntry[]): SystemLogFixture {
  return {
    ...EMPTY,
    haVersion: "2026.10.0",
    records: {
      ...EMPTY.records,
      config: {
        ...EMPTY.records.config,
        version: "2026.10.0",
        time_zone: "Europe/Madrid",
        latitude: 40.4168,
        longitude: -3.7038,
        config_dir: CONFIG_DIR,
        components: [
          "system_log",
          "logger",
          "http",
          "mqtt",
          "hue",
          "acme_cloud",
          "gizmo",
          "widget_hub",
        ],
      },
    },
    systemLog: entries,
  };
}

/** The reference log of research R12 and R14: CI asserts the compression floor on it. */
export const REFERENCE_SYSTEM_LOG: SystemLogFixture = systemLogFixture(
  generateSystemLog(12),
);
