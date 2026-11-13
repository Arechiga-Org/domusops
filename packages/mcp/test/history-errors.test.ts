import { describe, expect, it } from "vitest";
import { errors } from "../src/errors.js";

/**
 * The errors `ha_history` adds (specs/011-ha-history research R2, R4, R5, R10), and the wordings
 * the other tools keep byte-identical (FR-021).
 */

describe("the ha_history errors", () => {
  it("refuses a user who is not an administrator with its own remediation", () => {
    const error = errors.notAdmin("entity_history");
    expect(error.kind).toBe("not_admin");
    expect(error.message).toBe(
      "The token belongs to a user without administrator privileges. Use a token of an administrator user. Every DomusOps tool requires one, so a result never depends on what a restricted user may read.",
    );
  });

  it("says the instance does not provide recorded state history", () => {
    const error = errors.historyUnavailable("states");
    expect(error.kind).toBe("history_unavailable");
    expect(error.message).toBe(
      "The instance does not provide recorded state history. Enable the history and recorder integrations in Home Assistant (both are part of default_config), then try again.",
    );
  });

  it("names the attributes limit and the summary rule for a bad input", () => {
    const error = errors.inputInvalid("attributes has no entry", "history");
    expect(error.kind).toBe("input_invalid");
    expect(error.message).toBe(
      "The input is not valid: attributes has no entry. Give attributes as 1 to 100 entries of 1 to 128 characters, and only with detail=standard.",
    );
  });

  it("refuses a window longer than 10 days", () => {
    const error = errors.windowTooLong();
    expect(error.kind).toBe("window_invalid");
    expect(error.message).toBe(
      "The time window is not valid: it is longer than 10 days. Use a window of at most 10 days; read a longer period in several calls.",
    );
  });

  it("refuses an oversize standard result with the counts and how to narrow it", () => {
    const error = errors.tooLargeHistory(3, 9120, 146210, 100000, "standard");
    expect(error.kind).toBe("too_large");
    expect(error.message).toBe(
      "The result has 3 entities and 9120 changes and would be 146210 bytes, above the limit of 100000 bytes. Use detail=summary to see which entities are busy, or narrow the query with a shorter window, fewer entities, exclude, or attributes; to allow larger results, raise DOMUSOPS_HISTORY_MAX_BYTES.",
    );
  });

  it("refuses an oversize summary with the summary's own remediation", () => {
    const error = errors.tooLargeHistory(
      2400,
      90000,
      120000,
      100000,
      "summary",
    );
    expect(error.message).toBe(
      "The result has 2400 entities and 90000 changes and would be 120000 bytes, above the limit of 100000 bytes. Leave out entities to get the counts per domain, or narrow the query with fewer entities or exclude; to allow larger results, raise DOMUSOPS_HISTORY_MAX_BYTES.",
    );
  });
});

describe("the wordings of the other tools", () => {
  it("keeps the default subjects as they were", () => {
    expect(errors.notAdmin().message).toBe(errors.notAdmin("snapshot").message);
    expect(errors.historyUnavailable().message).toBe(
      "The instance does not provide logbook history. Enable the logbook and recorder integrations in Home Assistant (both are part of default_config), then try again.",
    );
    expect(errors.inputInvalid("x").message).toBe(
      "The input is not valid: x. Give domain as 1 to 100 entries of 1 to 64 characters of a-z, 0-9 and _; state as 1 to 100 entries of 1 to 255 characters; attributes as 1 to 100 entries of 1 to 128 characters, and only with detail=standard.",
    );
  });
});
