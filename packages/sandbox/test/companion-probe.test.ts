import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Time control replaces Home Assistant internals, so a release can remove one. The companion must
 * still load and report `time_unavailable`, naming what is missing, and must leave the clock as it
 * was (specs/007-debt-paydown FR-016, research R12). The probe is run against a stand-in package,
 * so no container is needed.
 */
const here = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const available = python.status === 0;

interface Probe {
  ok: boolean;
  code?: string;
  message?: string;
}

type Results = Record<string, Probe> & { freeze: unknown; advance: unknown };

const run = (): Results => {
  const result = spawnSync(
    "python3",
    [
      here("./support/probe_clock.py"),
      here("../companion/custom_components/domusops_sandbox/clock.py"),
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Results;
};

describe.skipIf(!available)("the companion's time-control probe", () => {
  const results = available ? run() : undefined;

  it("accepts a release that has every internal", () => {
    expect(results?.["complete"]).toEqual({ ok: true });
  });

  it.each([
    ["event", "homeassistant.helpers.event.time_tracker_utcnow"],
    ["entity", "homeassistant.helpers.entity.timer"],
    ["core", "homeassistant.core.time"],
    ["dt", "homeassistant.util.dt.now"],
  ])("names the missing internal when %s lacks one", (key, name) => {
    const probe = results?.[key];
    expect(probe?.ok).toBe(false);
    expect(probe?.code).toBe("time_unavailable");
    expect(probe?.message).toContain(name);
    expect(probe?.message).toContain("2099.1.0");
  });

  it("names a helper module that cannot be imported", () => {
    expect(results?.["script"]).toMatchObject({
      ok: false,
      code: "time_unavailable",
    });
    expect(results?.["script"]?.message).toContain(
      "homeassistant.helpers.script",
    );
  });

  it("leaves the clock unfrozen when the probe fails", () => {
    expect(results?.["freeze"]).toEqual({
      code: "time_unavailable",
      frozen: false,
    });
  });

  it("leaves the clock unfrozen when the event loop has no timer queue", () => {
    expect(results?.["advance"]).toMatchObject({
      code: "time_unavailable",
      frozen: false,
    });
    expect(JSON.stringify(results?.["advance"])).toContain("timer queue");
  });
});
