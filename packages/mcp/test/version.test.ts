import { describe, expect, it } from "vitest";
import { SnapshotError } from "../src/errors.js";
import { MIN_VERSION, isSupported, parseVersion } from "../src/ha/version.js";

describe("version floor", () => {
  it("states the refusal threshold", () => {
    expect(MIN_VERSION).toBe("2025.1.0");
  });

  it("accepts the minimum and later versions", () => {
    expect(isSupported("2025.1.0")).toBe(true);
    expect(isSupported("2025.1.4")).toBe(true);
    expect(isSupported("2025.12.0")).toBe(true);
    expect(isSupported("2026.9.1")).toBe(true);
  });

  it("rejects earlier versions", () => {
    expect(isSupported("2024.12.4")).toBe(false);
    expect(isSupported("2023.1.0")).toBe(false);
  });

  it("compares beta and dev builds by their base version", () => {
    expect(parseVersion("2026.10.0b3")).toEqual([2026, 10, 0]);
    expect(parseVersion("2026.10.0.dev20260915")).toEqual([2026, 10, 0]);
    expect(isSupported("2026.10.0b3")).toBe(true);
    expect(isSupported("2026.10.0.dev20260915")).toBe(true);
    expect(isSupported("2024.12.0b1")).toBe(false);
  });

  it("treats an unparseable version as a protocol error", () => {
    for (const version of ["banana", "", "2025.1", "v2025.1.0"]) {
      expect(() => isSupported(version)).toThrow(SnapshotError);
      try {
        isSupported(version);
      } catch (error) {
        expect((error as SnapshotError).kind).toBe("protocol_error");
      }
    }
  });
});
