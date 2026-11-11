import { PING_FORMAT, pingJsonSchema } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

/** The `domusops.ping/0.1` format (specs/009-ha-ping FR-012, FR-019, research R9). */

const validate = new Ajv({ allErrors: true, strict: false }).compile(
  pingJsonSchema,
);

const healthy = {
  format: "domusops.ping/0.1",
  server: { name: "domusops-mcp", version: "0.2.0" },
  instance: {
    version: "2026.10.0",
    minimum: "2025.1.0",
    supported: true,
    time_zone: "Europe/Amsterdam",
  },
  admin: true,
  integrations: { logbook: true, trace: true },
  tools: {
    ha_snapshot: { ready: true },
    ha_logbook_query: { ready: true },
    ha_trace: { ready: true },
  },
  compression_ratio: 5.71,
};

const troubled = {
  ...healthy,
  admin: false,
  integrations: { logbook: true, trace: false },
  tools: {
    ha_snapshot: { ready: false, reasons: ["not_admin"] },
    ha_logbook_query: { ready: false, reasons: ["not_admin"] },
    ha_trace: {
      ready: false,
      reasons: ["not_admin", "integration_missing:trace"],
    },
  },
  next_steps: [
    "Use a token of an administrator user, which ha_snapshot, ha_logbook_query, ha_trace need",
    "Enable the trace integration in Home Assistant (it is part of default_config), then try again",
  ],
  compression_ratio: 4.02,
};

const without = (document: object, key: string): object =>
  Object.fromEntries(Object.entries(document).filter(([k]) => k !== key));

describe("the ping format", () => {
  it("is identified as domusops.ping/0.1", () => {
    expect(PING_FORMAT).toBe("domusops.ping/0.1");
  });

  it.each([
    ["a healthy instance", healthy],
    ["a user who is not an administrator, without traces", troubled],
  ])("accepts %s", (_, document) => {
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts tools and integrations it does not know (FR-019)", () => {
    const later = {
      ...healthy,
      integrations: { ...healthy.integrations, history: true },
      tools: {
        ...healthy.tools,
        ha_state: { ready: false, reasons: ["integration_missing:history"] },
      },
    };
    expect(validate(later), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ["no format", without(healthy, "format")],
    ["no server", without(healthy, "server")],
    ["no instance", without(healthy, "instance")],
    ["no tools", without(healthy, "tools")],
    ["no compression_ratio", without(healthy, "compression_ratio")],
    ["a wrong format identifier", { ...healthy, format: "domusops.ping/9" }],
    ["admin that is not a boolean", { ...healthy, admin: "yes" }],
    ["an unknown top-level key", { ...healthy, user: "Owner" }],
    [
      "an instance without a time zone",
      { ...healthy, instance: without(healthy.instance, "time_zone") },
    ],
    [
      "an integration that is not a boolean",
      { ...healthy, integrations: { trace: "yes" } },
    ],
    [
      "an unknown reason",
      {
        ...troubled,
        tools: { ha_trace: { ready: false, reasons: ["broken"] } },
      },
    ],
    [
      "an integration_missing reason without a valid name",
      {
        ...troubled,
        tools: {
          ha_trace: { ready: false, reasons: ["integration_missing:Trace"] },
        },
      },
    ],
    [
      "a tool that is not ready and has no reasons",
      { ...healthy, tools: { ha_trace: { ready: false } } },
    ],
    [
      "a tool that is ready and has reasons",
      {
        ...healthy,
        tools: { ha_trace: { ready: true, reasons: ["not_admin"] } },
      },
    ],
    ["an empty next_steps", { ...troubled, next_steps: [] }],
  ])("rejects %s", (_, document) => {
    expect(validate(document)).toBe(false);
  });
});
