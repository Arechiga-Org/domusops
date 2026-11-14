import { describe, expect, it } from "vitest";
import { errors } from "../src/errors.js";

/**
 * The errors `ha_system_log` adds (specs/012-ha-system-log research R2, R4, R9), and the wordings
 * the other tools keep byte-identical (FR-020).
 */

describe("the ha_system_log errors", () => {
  it("refuses a user who is not an administrator with the shared remediation", () => {
    const error = errors.notAdmin("required");
    expect(error.kind).toBe("not_admin");
    expect(error.message).toBe(
      "The token belongs to a user without administrator privileges. Use a token of an administrator user. Every DomusOps tool requires one, so a result never depends on what a restricted user may read.",
    );
  });

  it("says the instance does not provide its system log", () => {
    const error = errors.systemLogUnavailable();
    expect(error.kind).toBe("system_log_unavailable");
    expect(error.toToolText("ha_system_log")).toBe(
      "ha_system_log failed [system_log_unavailable]: The instance does not provide its system log. Make sure the system_log integration is loaded (Home Assistant loads it at startup unless the configuration prevents it), then try again.",
    );
  });

  it("names integration domains for a bad integration selector", () => {
    const error = errors.selectorInvalid(
      "mqtt.client",
      undefined,
      "integration",
    );
    expect(error.kind).toBe("selector_invalid");
    expect(error.message).toBe(
      'The integration selector "mqtt.client" is not valid. Use an integration domain or a pattern made of lowercase letters, digits, underscores, and * (for example mqtt, hue*, or *_cloud).',
    );
  });

  it("keeps the entity selector wording", () => {
    expect(errors.selectorInvalid("Light.X").message).toBe(
      'The entity selector "Light.X" is not valid. Use an entity ID or a pattern made of lowercase letters, digits, underscores, dots, and * (for example light.hallway, light.*, or *_motion).',
    );
  });

  it("lists the three levels for a bad level", () => {
    const error = errors.inputInvalid(
      'level is "info", not warning, error, or critical',
      "system_log",
    );
    expect(error.kind).toBe("input_invalid");
    expect(error.message).toBe(
      'The input is not valid: level is "info", not warning, error, or critical. Give level as warning, error, or critical.',
    );
  });

  it("refuses a standard result above the limit with the entry count and the summary hint", () => {
    const error = errors.tooLargeSystemLog(50, 131204, 100000, "standard");
    expect(error.kind).toBe("too_large");
    expect(error.message).toBe(
      "The result has 50 entries and would be 131204 bytes, above the limit of 100000 bytes. Use detail=summary to see which integrations are logging, or narrow the query with integrations, exclude, level, or start; to allow larger results, raise DOMUSOPS_SYSTEM_LOG_MAX_BYTES.",
    );
  });

  it("refuses a summary above the limit without pointing at the summary", () => {
    expect(
      errors.tooLargeSystemLog(900, 120000, 100000, "summary").message,
    ).toBe(
      "The result has 900 entries and would be 120000 bytes, above the limit of 100000 bytes. Narrow the query with integrations, exclude, level, or start; to allow larger results, raise DOMUSOPS_SYSTEM_LOG_MAX_BYTES.",
    );
  });
});
