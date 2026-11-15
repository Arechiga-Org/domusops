import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  expandSystemLog,
  type SystemLogEntryRow,
  type SystemLogPart,
  type SystemLogStandardDocument,
  type SystemLogSummaryDocument,
} from "../src/index.js";

/** The `domusops.system_log/0.1` decoder (specs/012-ha-system-log data-model §5, research R13). */

const envelope = {
  format: "domusops.system_log/0.1",
  detail: "standard",
  ha_version: "2026.10.0",
  compression_ratio: 1,
  time_zone: "Europe/Madrid",
  utc_offset: "+01:00",
} as const;

function document(
  entries: Record<string, SystemLogEntryRow[]>,
  more: { files?: string[]; parts?: SystemLogPart[]; custom?: string[] } = {},
): SystemLogStandardDocument {
  return {
    ...envelope,
    ...(more.custom === undefined ? {} : { custom: more.custom }),
    files: more.files ?? ["components/mqtt/client.py"],
    parts: more.parts ?? [],
    entries,
  };
}

const row = (time: string, ...rest: unknown[]): SystemLogEntryRow =>
  [
    time,
    "error",
    "homeassistant.components.mqtt.client",
    "mqtt",
    [0, 612],
    1,
    ["Failed to connect"],
    ...rest,
  ] as SystemLogEntryRow;

describe("expandSystemLog", () => {
  it("returns the entries in the document's order with local times", () => {
    const records = expandSystemLog(
      document({
        "2026-11-12": [row("23:59:58")],
        "2026-11-13": [row("08:00:00"), row("03:00:00+02:00")],
      }),
    );
    expect(records.map((r) => r.last_occurred)).toEqual([
      "2026-11-12T23:59:58+01:00",
      "2026-11-13T08:00:00+01:00",
      "2026-11-13T03:00:00+02:00",
    ]);
  });

  it("decodes every field of an entry", () => {
    const [record] = expandSystemLog(
      document({ "2026-11-13": [row("09:15:40")] }),
    );
    expect(record).toEqual({
      level: "error",
      logger: "homeassistant.components.mqtt.client",
      integration: "mqtt",
      integration_from: "logger",
      custom: false,
      source: { file: "components/mqtt/client.py", line: 612 },
      count: 1,
      first_occurred: "2026-11-13T09:15:40+01:00",
      last_occurred: "2026-11-13T09:15:40+01:00",
      messages: ["Failed to connect"],
      traceback: null,
    });
  });

  it.each([
    ["absent", [], "2026-11-13T09:15:40+01:00"],
    ["null", [null], "2026-11-13T09:15:40+01:00"],
    ["a time on the same date", ["08:02:11"], "2026-11-13T08:02:11+01:00"],
    [
      "a time with its own offset",
      ["01:02:11+02:00"],
      "2026-11-13T01:02:11+02:00",
    ],
    ["a full ISO time", ["2026-11-10T22:00:00"], "2026-11-10T22:00:00+01:00"],
    [
      "a full ISO time with an offset",
      ["2026-10-20T22:00:00+02:00"],
      "2026-10-20T22:00:00+02:00",
    ],
  ])("restores the first occurrence when it is %s", (_, rest, expected) => {
    const [record] = expandSystemLog(
      document({ "2026-11-13": [row("09:15:40", ...rest)] }),
    );
    expect(record?.first_occurred).toBe(expected);
  });

  it("says where the integration came from and whether it is custom", () => {
    const records = expandSystemLog(
      document(
        {
          "2026-11-13": [
            row("09:00:00"),
            [
              "09:01:00",
              "warning",
              "pyacme.client",
              "acme_cloud",
              [1, 120],
              7,
              ["Connection lost"],
              null,
              null,
              1,
            ],
            [
              "09:02:00",
              "error",
              "homeassistant.helpers.event",
              null,
              [2, 466],
              1,
              ["Error while processing template"],
            ],
          ],
        },
        {
          files: [
            "components/mqtt/client.py",
            "custom_components/acme_cloud/__init__.py",
            "helpers/template/__init__.py",
          ],
          custom: ["acme_cloud"],
        },
      ),
    );
    expect(
      records.map((r) => [r.integration, r.integration_from, r.custom]),
    ).toEqual([
      ["mqtt", "logger", false],
      ["acme_cloud", "source", true],
      [null, null, false],
    ]);
    expect(records[1]?.source).toEqual({
      file: "custom_components/acme_cloud/__init__.py",
      line: 120,
    });
  });

  it("rebuilds a chained traceback with caret lines and a template frame exactly", () => {
    const text = [
      "Traceback (most recent call last):",
      '  File "{config}/custom_components/acme_cloud/api.py", line 41, in get_state',
      '    return payload["state"]["value"]',
      "           ~~~~~~~~~~~~~~~~^^^^^^^^^",
      "KeyError: 'value'",
      "",
      "The above exception was the direct cause of the following exception:",
      "",
      "Traceback (most recent call last):",
      '  File "<template>", line 1, in top-level template code',
      '  File "{python}/asyncio/tasks.py", line 507, in wait_for',
      "    return await fut",
      "UpdateFailed: bad payload",
    ].join("\n");
    const [record] = expandSystemLog(
      document(
        {
          "2026-11-13": [
            row("09:15:40", null, [
              0,
              1,
              "KeyError: 'value'\n\nThe above exception was the direct cause of the following exception:\n",
              0,
              2,
              3,
              "UpdateFailed: bad payload",
            ]),
          ],
        },
        {
          files: [
            "components/mqtt/client.py",
            "{config}/custom_components/acme_cloud/api.py",
            "<template>",
            "{python}/asyncio/tasks.py",
          ],
          parts: [
            "Traceback (most recent call last):",
            [
              1,
              41,
              "get_state",
              '    return payload["state"]["value"]\n           ~~~~~~~~~~~~~~~~^^^^^^^^^',
            ],
            [2, 1, "top-level template code"],
            [3, 507, "wait_for", "    return await fut"],
          ],
        },
      ),
    );
    expect(record?.traceback).toBe(text);
  });

  it("refuses a summary document", () => {
    const summary: SystemLogSummaryDocument = {
      ...envelope,
      detail: "summary",
      counts: { entries: 0, occurrences: 0 },
      by_integration: {},
    };
    expect(() =>
      expandSystemLog(summary as unknown as SystemLogStandardDocument),
    ).toThrow(/detail=standard/);
  });

  it("decodes the standard example of the format contract", () => {
    const [example] = [
      ...readFileSync(
        new URL(
          "../../../specs/012-ha-system-log/contracts/system-log-format.md",
          import.meta.url,
        ),
        "utf8",
      ).matchAll(/```json\n([\s\S]*?)```/g),
    ].map(
      (match) => JSON.parse(match[1] as string) as SystemLogStandardDocument,
    );
    const records = expandSystemLog(example as SystemLogStandardDocument);
    expect(records).toHaveLength(4);
    const [mqtt, acme, library, helper] = records;
    expect(mqtt).toMatchObject({
      integration: "mqtt",
      integration_from: "logger",
      count: 3,
      first_occurred: "2026-11-13T08:02:11+01:00",
      last_occurred: "2026-11-13T09:15:40+01:00",
      source: { file: "components/mqtt/client.py", line: 612 },
    });
    expect(mqtt?.traceback).toBe(
      [
        "Traceback (most recent call last):",
        '  File "{ha}/components/mqtt/client.py", line 598, in _async_connect',
        "    await self._mqttc.connect(host, port)",
        '  File "{python}/site-packages/paho/mqtt/client.py", line 1435, in connect',
        "    return self.reconnect()",
        "           ~~~~~~~~~~~~~~^^",
        "ConnectionRefusedError: [Errno 111] Connection refused",
      ].join("\n"),
    );
    expect(acme).toMatchObject({
      integration: "acme_cloud",
      custom: true,
      first_occurred: "2026-11-13T09:20:05+01:00",
      messages: ["Update failed for user [redacted]"],
    });
    expect(acme?.traceback).toContain(
      '  File "{config}/custom_components/acme_cloud/api.py", line 41, in get_state',
    );
    expect(acme?.traceback?.endsWith("UpdateFailed: bad payload")).toBe(true);
    expect(library).toMatchObject({
      logger: "pyacme.client",
      integration: "acme_cloud",
      integration_from: "source",
      custom: true,
      count: 7,
      traceback: null,
    });
    expect(helper).toMatchObject({
      integration: null,
      integration_from: null,
      custom: false,
      source: { file: "helpers/template/__init__.py", line: 466 },
    });
  });
});
