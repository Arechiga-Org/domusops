import { describe, expect, it } from "vitest";
import { exactRelease, resolveChannel } from "../src/release/resolve.js";
import type { SandboxError } from "../src/errors.js";

function indexOf(
  releases: Record<string, { yanked: boolean }[]>,
): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ releases }), {
      status: 200,
    })) as unknown as typeof fetch;
}

const file = [{ yanked: false }];
const yanked = [{ yanked: true }];

const base = {
  "2026.8.4": file,
  "2026.9.2": file,
  "2026.9.3": file,
  "2026.10.0b1": file,
  "2026.10.0b2": file,
  "2026.10.0": file,
  "2026.10.1": file,
  "2026.11.0b1": file,
  "2026.11.0b10": file,
  "2026.11.0b9": file,
  "2026.12.0.dev20260101": file,
  "2026.10.2": yanked,
  "2026.10.3": [],
};

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as SandboxError).code;
  }
  return "no error";
}

describe("resolveChannel", () => {
  it("picks the newest non-beta release as stable, skipping yanked and empty ones", async () => {
    const resolved = await resolveChannel("stable", {
      fetch: indexOf(base),
    });
    expect(resolved).toEqual({
      channel: "stable",
      release: "2026.10.1",
      beta: false,
    });
  });

  it("picks the newest release of an earlier month series as previous stable", async () => {
    const resolved = await resolveChannel("previous-stable", {
      fetch: indexOf(base),
    });
    expect(resolved.release).toBe("2026.9.3");
    expect(resolved.beta).toBe(false);
  });

  it("orders betas numerically", async () => {
    const resolved = await resolveChannel("beta", { fetch: indexOf(base) });
    expect(resolved).toEqual({
      channel: "beta",
      release: "2026.11.0b10",
      beta: true,
    });
  });

  it("reports no beta in progress when the newest beta is not newer than stable", async () => {
    const rest = Object.fromEntries(
      Object.entries(base).filter(
        ([release]) => !release.startsWith("2026.11"),
      ),
    );
    expect(await codeOf(resolveChannel("beta", { fetch: indexOf(rest) }))).toBe(
      "no_beta_in_progress",
    );
  });

  it("reports channel_unresolved when there is no earlier series", async () => {
    expect(
      await codeOf(
        resolveChannel("previous-stable", {
          fetch: indexOf({ "2026.10.0": file, "2026.10.1": file }),
        }),
      ),
    ).toBe("channel_unresolved");
  });

  it("reports channel_unresolved on a network failure", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await codeOf(resolveChannel("stable", { fetch: failing }))).toBe(
      "channel_unresolved",
    );
  });

  it("reports channel_unresolved on an error status and on a malformed document", async () => {
    const status = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const malformed = (async () =>
      new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await codeOf(resolveChannel("stable", { fetch: status }))).toBe(
      "channel_unresolved",
    );
    expect(await codeOf(resolveChannel("stable", { fetch: malformed }))).toBe(
      "channel_unresolved",
    );
  });
});

describe("exactRelease", () => {
  it("accepts releases and flags betas", () => {
    expect(exactRelease("2026.9.3")).toEqual({
      channel: "exact",
      release: "2026.9.3",
      beta: false,
    });
    expect(exactRelease("2026.11.0b2").beta).toBe(true);
  });

  it("rejects anything that is not a release string", () => {
    expect(() => exactRelease("stable")).toThrow(TypeError);
    expect(() => exactRelease("2026.10.1; rm -rf /")).toThrow(TypeError);
  });
});
