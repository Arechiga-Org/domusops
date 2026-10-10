import { describe, expect, it } from "vitest";
import { main, type CliDeps } from "../src/cli.js";
import { SandboxError } from "../src/errors.js";
import type { Sandbox } from "../src/instance/handle.js";
import type { SandboxListing } from "../src/instance/list.js";
import type { StartOptions } from "../src/instance/start.js";
import type { Removal } from "../src/runtime/reaper.js";
import type { ConfigSummary } from "../src/types.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RESULT_FORMAT,
  STEP_NAMES,
  type RunResult,
} from "../src/results/result.js";
import type { SmokeTarget } from "../src/smoke/run.js";

const TOKEN = "tok-0123456789abcdef";

function passedRun(): RunResult {
  return {
    format: RESULT_FORMAT,
    channel: "stable",
    release: "2026.10.1",
    outcome: "passed",
    steps: STEP_NAMES.map((name) => ({ name, status: "passed", ms: 5 })),
    startedAt: "2026-10-08T10:00:00Z",
    finishedAt: "2026-10-08T10:01:00Z",
    runner: "linux-x64",
    sandboxVersion: "0.1.0",
  };
}

function fakeSandbox(
  stopped: string[],
  mode: "tied" | "background" = "tied",
  reaped: Removal[] = [],
  detached: string[] = [],
): Sandbox {
  return {
    id: "0123456789ab",
    release: { channel: "stable", release: "2026.10.1", beta: false },
    mode,
    reaped,
    detach: async () => {
      detached.push("0123456789ab");
    },
    deadline: "2026-10-06T20:00:00.000Z",
    url: "http://127.0.0.1:49152",
    config: null,
    devices: [],
    addDevices: async () => [],
    setState: async () => undefined,
    getState: async () => null,
    callService: async () => undefined,
    time: {
      freeze: async () => undefined,
      advance: async () => ({ now: "2031-03-04T03:00:10Z", fired: 0 }),
      resume: async () => undefined,
      now: async () => ({ now: "2031-03-04T03:00:10Z", frozen: false }),
    },
    connection: () => ({
      url: "http://127.0.0.1:49152",
      wsUrl: "ws://127.0.0.1:49152/api/websocket",
      token: TOKEN,
    }),
    mcpEnv: () => ({
      DOMUSOPS_HA_URL: "http://127.0.0.1:49152",
      DOMUSOPS_HA_TOKEN: TOKEN,
    }),
    stop: async () => {
      stopped.push("0123456789ab");
    },
  };
}

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  stopped: string[];
  detached: string[];
  stoppedIds: string[];
  reaped: Removal[];
  listings: SandboxListing[];
  started: StartOptions[];
  ran: { argv: readonly string[]; env: NodeJS.ProcessEnv }[];
  smoked: SmokeTarget[];
  smokeResult: RunResult;
}

function harness(
  overrides: Partial<CliDeps> = {},
  env: NodeJS.ProcessEnv = {},
  exitCode = 0,
): Harness {
  const h: Harness = {
    out: [],
    err: [],
    stopped: [],
    detached: [],
    stoppedIds: [],
    reaped: [],
    listings: [],
    started: [],
    ran: [],
    smoked: [],
    smokeResult: passedRun(),
    deps: undefined as unknown as CliDeps,
  };
  h.deps = {
    start: async (options) => {
      h.started.push(options);
      return fakeSandbox(h.stopped, options.mode, h.reaped, h.detached);
    },
    attach: async () => fakeSandbox(h.stopped, "background"),
    list: async () => h.listings,
    held: () => false,
    stop: async (id) => {
      if (id === "foreign000000") {
        throw new SandboxError("not_a_sandbox", `"${id}" is not a sandbox.`);
      }
      h.stoppedIds.push(id);
    },
    cleanup: async () => ({ removed: h.reaped }),
    resolve: async (channel) => ({
      channel,
      release: "2026.10.1",
      beta: false,
    }),
    smoke: async (target) => {
      h.smoked.push(target);
      return h.smokeResult;
    },
    run: async (argv, runEnv) => {
      h.ran.push({ argv, env: runEnv });
      return exitCode;
    },
    out: (text) => h.out.push(text),
    err: (text) => h.err.push(text),
    env,
    ...overrides,
  };
  return h;
}

describe("usage errors", () => {
  it.each([
    [[]],
    [["frobnicate"]],
    [["resolve"]],
    [["resolve", "nightly"]],
    [["start"]],
    [["start", "--"]],
    [["start", "--channel", "stable", "--release", "2026.10.1", "--", "true"]],
    [["start", "--channel", "nightly", "--", "true"]],
    [["start", "--readiness-timeout", "soon", "--", "true"]],
    [["start", "--bogus", "--", "true"]],
  ])("exits 2 for %j", async (argv) => {
    const h = harness();
    expect(await main(argv, h.deps)).toBe(2);
    expect(h.started).toEqual([]);
  });

  it("validates the options before starting anything", async () => {
    const h = harness();
    expect(await main(["start", "--release", "x", "--", "true"], h.deps)).toBe(
      2,
    );
    expect(
      await main(["start", "--max-lifetime", "0", "--", "true"], h.deps),
    ).toBe(2);
    expect(h.started).toEqual([]);
  });

  it("does not report a runtime TypeError as a usage error", async () => {
    const h = harness({
      start: async () => {
        throw new TypeError("Cannot read properties of undefined");
      },
    });
    expect(await main(["start", "--", "true"], h.deps)).toBe(1);
    expect(h.err.join("")).toContain("Cannot read properties of undefined");
    expect(h.err.join("")).not.toContain("Usage");
  });
});

describe("resolve", () => {
  it("prints the release", async () => {
    const h = harness();
    expect(await main(["resolve", "stable"], h.deps)).toBe(0);
    expect(h.out.join("")).toBe("2026.10.1\n");
  });

  it("prints JSON", async () => {
    const h = harness();
    await main(["resolve", "previous-stable", "--json"], h.deps);
    expect(JSON.parse(h.out.join(""))).toEqual({
      channel: "previous-stable",
      release: "2026.10.1",
      beta: false,
    });
  });

  it("reports no beta in progress and still succeeds", async () => {
    const h = harness({
      resolve: async () => {
        throw new SandboxError("no_beta_in_progress", "none");
      },
    });
    expect(await main(["resolve", "beta"], h.deps)).toBe(0);
    expect(h.out.join("")).toBe("no beta in progress\n");
  });

  it("exits 3 when the channel cannot be resolved", async () => {
    const h = harness({
      resolve: async () => {
        throw new SandboxError("channel_unresolved", "offline");
      },
    });
    expect(await main(["resolve", "stable"], h.deps)).toBe(3);
  });
});

describe("start -- <command>", () => {
  it("runs the command with the instance's environment and stops it", async () => {
    const h = harness({}, { PATH: "/bin", DOMUSOPS_HA_TOKEN: "ambient" }, 7);
    const code = await main(
      [
        "start",
        "--channel",
        "beta",
        "--readiness-timeout",
        "90",
        "--",
        "pnpm",
        "test",
      ],
      h.deps,
    );
    expect(code).toBe(7);
    expect(h.started).toHaveLength(1);
    expect(h.started[0]).toMatchObject({
      mode: "tied",
      channel: "beta",
      readinessTimeoutSeconds: 90,
    });
    expect(h.ran[0]?.argv).toEqual(["pnpm", "test"]);
    expect(h.ran[0]?.env["DOMUSOPS_HA_URL"]).toBe("http://127.0.0.1:49152");
    expect(h.ran[0]?.env["DOMUSOPS_HA_TOKEN"]).toBe(TOKEN);
    expect(h.ran[0]?.env["PATH"]).toBe("/bin");
    expect(h.stopped).toEqual(["0123456789ab"]);
  });

  it("ignores DOMUSOPS_HA_* from its own environment when starting", async () => {
    const h = harness(
      {},
      {
        DOMUSOPS_HA_URL: "http://real-ha.local:8123",
        DOMUSOPS_HA_TOKEN: "real-token",
      },
    );
    await main(["start", "--", "true"], h.deps);
    expect(JSON.stringify(h.started)).not.toContain("real");
    expect(h.ran[0]?.env["DOMUSOPS_HA_URL"]).toBe("http://127.0.0.1:49152");
  });

  it("stops the instance even when the command cannot be run", async () => {
    const h = harness({
      run: async () => {
        throw new Error("spawn failed");
      },
    });
    expect(await main(["start", "--", "nope"], h.deps)).toBe(1);
    expect(h.stopped).toEqual(["0123456789ab"]);
  });

  it("reports progress on stderr, never the token", async () => {
    const h = harness({
      start: async (options) => {
        options.onProgress?.("pulling");
        options.onProgress?.("pulling", "using the local copy");
        return fakeSandbox([]);
      },
    });
    await main(["start", "--json", "--", "true"], h.deps);
    const err = h.err.join("");
    expect(err).toContain("pulling\n");
    expect(err).toContain("pulling: using the local copy");
    expect(err).not.toContain(TOKEN);
    expect(h.out.join("")).toBe("");
  });

  it.each([
    ["runtime_missing", 3],
    ["image_unavailable", 3],
    ["channel_unresolved", 3],
    ["not_ready", 1],
    ["config_invalid", 1],
  ] as const)("exits %s with %i", async (code, expected) => {
    const h = harness({
      start: async () => {
        throw new SandboxError(code, "boom", { logs: ["line one"] });
      },
    });
    expect(await main(["start", "--", "true"], h.deps)).toBe(expected);
    expect(h.err.join("")).toContain(code);
    expect(h.ran).toEqual([]);
  });

  it("prints the log lines of a not_ready failure", async () => {
    const h = harness({
      start: async () => {
        throw new SandboxError("not_ready", "late", { logs: ["a", "b"] });
      },
    });
    await main(["start", "--", "true"], h.deps);
    expect(h.err.join("")).toContain("  a\n  b\n");
  });
});

const listing = (id: string): SandboxListing => ({
  id,
  containerId: `full-${id}`,
  mode: "background",
  release: "2026.10.1",
  url: "http://127.0.0.1:49152",
  deadline: "2026-10-06T20:00:00.000Z",
  owner: null,
});

describe("start --device", () => {
  it("passes each device through as a specification", async () => {
    const h = harness();
    expect(
      await main(
        [
          "start",
          "--device",
          "light:Hall",
          "--device",
          "binary_sensor:Door:motion",
          "--",
          "true",
        ],
        h.deps,
      ),
    ).toBe(0);
    expect(h.started[0]?.devices).toEqual([
      { kind: "light", name: "Hall" },
      { kind: "binary_sensor", name: "Door", class: "motion" },
    ]);
  });

  it.each([
    [["--device", "light"]],
    [["--device", "light:a:b:c"]],
    [["--device", "toaster:Hall"]],
  ])("exits 2 for %j before starting anything", async (flags) => {
    const h = harness();
    expect(await main(["start", ...flags, "--", "true"], h.deps)).toBe(2);
    expect(h.started).toEqual([]);
  });

  it("says which entity id each device got, as text and as JSON", async () => {
    const devices = [
      { kind: "light" as const, name: "Hall", entityId: "light.hall" },
    ];
    const withDevices = (h: Harness): Partial<CliDeps> => ({
      start: async (options) => {
        h.started.push(options);
        return {
          ...fakeSandbox(h.stopped, options.mode, h.reaped, h.detached),
          devices,
        };
      },
    });
    const text = harness();
    Object.assign(text.deps, withDevices(text));
    await main(["start", "--background", "--device", "light:Hall"], text.deps);
    expect(text.out.join("")).toContain('device light "Hall" light.hall');

    const json = harness();
    Object.assign(json.deps, withDevices(json));
    await main(
      ["start", "--background", "--json", "--device", "light:Hall"],
      json.deps,
    );
    expect(
      (JSON.parse(json.out.join("")) as { devices: unknown }).devices,
    ).toEqual(devices);
    expect(json.out.join("")).not.toContain(TOKEN);
  });

  it("explains that a name cannot contain a colon", async () => {
    const h = harness();
    expect(
      await main(["start", "--device", "light:a:b:c", "--", "true"], h.deps),
    ).toBe(2);
    expect(h.err.join("")).toContain('cannot contain ":"');
  });

  it("starts without devices when none are given", async () => {
    const h = harness();
    await main(["start", "--", "true"], h.deps);
    expect(h.started[0]?.devices).toBeUndefined();
  });
});

describe("start --background", () => {
  it("prints the instance and never the token, and leaves it running", async () => {
    const h = harness();
    expect(await main(["start", "--background"], h.deps)).toBe(0);
    expect(h.started[0]?.mode).toBe("background");
    const printed = h.out.join("") + h.err.join("");
    expect(printed).toContain("0123456789ab");
    expect(printed).toContain("http://127.0.0.1:49152");
    expect(printed).not.toContain(TOKEN);
    expect(h.detached).toEqual(["0123456789ab"]);
    expect(h.stopped).toEqual([]);
    expect(h.ran).toEqual([]);
  });

  it("prints JSON without the token", async () => {
    const h = harness();
    await main(["start", "--background", "--json"], h.deps);
    const parsed = JSON.parse(h.out.join("")) as Record<string, unknown>;
    expect(parsed["id"]).toBe("0123456789ab");
    expect(h.out.join("")).not.toContain(TOKEN);
  });

  it("passes --max-lifetime through", async () => {
    const h = harness();
    await main(["start", "--background", "--max-lifetime", "30"], h.deps);
    expect(h.started[0]?.maxLifetimeMinutes).toBe(30);
  });

  it.each([
    [["start", "--background", "--", "true"]],
    [["start", "--max-lifetime", "soon", "--", "true"]],
  ])("exits 2 for %j", async (argv) => {
    const h = harness();
    expect(await main(argv, h.deps)).toBe(2);
  });

  it("reports what the reaper removed before starting", async () => {
    const h = harness();
    h.reaped.push({
      id: "aaaaaaaaaaaa",
      containerId: "full",
      reason: "owner process gone",
    });
    await main(["start", "--", "true"], h.deps);
    expect(h.err.join("")).toContain(
      "removed aaaaaaaaaaaa: owner process gone",
    );
  });
});

describe("env", () => {
  it("is the only command that prints the token", async () => {
    const h = harness();
    expect(await main(["env", "0123456789ab"], h.deps)).toBe(0);
    expect(h.out.join("")).toBe(
      `DOMUSOPS_HA_URL=http://127.0.0.1:49152\nDOMUSOPS_HA_TOKEN=${TOKEN}\n`,
    );
  });

  it("needs exactly one id", async () => {
    const h = harness();
    expect(await main(["env"], h.deps)).toBe(2);
  });
});

describe("list", () => {
  it("says so when there is nothing", async () => {
    const h = harness();
    expect(await main(["list"], h.deps)).toBe(0);
    expect(h.out.join("")).toBe("no sandbox instances\n");
  });

  it("lists instances, as text and as JSON", async () => {
    const h = harness();
    h.listings.push(listing("0123456789ab"));
    await main(["list"], h.deps);
    expect(h.out.join("")).toContain("0123456789ab");
    h.out.length = 0;
    await main(["list", "--json"], h.deps);
    expect(JSON.parse(h.out.join(""))).toHaveLength(1);
  });
});

describe("stop", () => {
  it("stops the ids given", async () => {
    const h = harness();
    expect(await main(["stop", "aaaaaaaaaaaa", "bbbbbbbbbbbb"], h.deps)).toBe(
      0,
    );
    expect(h.stoppedIds).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("stops every listed instance with --all", async () => {
    const h = harness();
    h.listings.push(listing("aaaaaaaaaaaa"), listing("bbbbbbbbbbbb"));
    expect(await main(["stop", "--all"], h.deps)).toBe(0);
    expect(h.stoppedIds).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("refuses an id that is not a sandbox, keeps going, and exits 1", async () => {
    const h = harness();
    expect(await main(["stop", "foreign000000", "aaaaaaaaaaaa"], h.deps)).toBe(
      1,
    );
    expect(h.stoppedIds).toEqual(["aaaaaaaaaaaa"]);
    expect(h.err.join("")).toContain("not_a_sandbox");
  });

  describe("--all and tied instances", () => {
    const tied = (id: string): SandboxListing => ({
      ...listing(id),
      mode: "tied",
      owner: { host: "build-1", pid: 4242 },
    });

    it("keeps a tied instance whose owner may still be running", async () => {
      const h = harness({
        held: (l) => l.mode === "tied",
      });
      h.listings.push(listing("aaaaaaaaaaaa"), tied("bbbbbbbbbbbb"));
      expect(await main(["stop", "--all"], h.deps)).toBe(0);
      expect(h.stoppedIds).toEqual(["aaaaaaaaaaaa"]);
      expect(h.err.join("")).toContain(
        "kept bbbbbbbbbbbb: tied to build-1:4242",
      );
    });

    it("stops a tied instance whose owner is gone", async () => {
      const h = harness();
      h.listings.push(tied("bbbbbbbbbbbb"));
      expect(await main(["stop", "--all"], h.deps)).toBe(0);
      expect(h.stoppedIds).toEqual(["bbbbbbbbbbbb"]);
    });

    it("stops everything with --force", async () => {
      const h = harness({ held: () => true });
      h.listings.push(listing("aaaaaaaaaaaa"), tied("bbbbbbbbbbbb"));
      expect(await main(["stop", "--all", "--force"], h.deps)).toBe(0);
      expect(h.stoppedIds).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    });

    it("stops a named tied instance without --force", async () => {
      const h = harness({ held: () => true });
      h.listings.push(tied("bbbbbbbbbbbb"));
      expect(await main(["stop", "bbbbbbbbbbbb"], h.deps)).toBe(0);
      expect(h.stoppedIds).toEqual(["bbbbbbbbbbbb"]);
    });
  });

  it.each([
    [["stop"]],
    [["stop", "--all", "aaaaaaaaaaaa"]],
    [["stop", "--force", "aaaaaaaaaaaa"]],
  ])("exits 2 for %j", async (argv) => {
    const h = harness();
    expect(await main(argv, h.deps)).toBe(2);
    expect(h.stoppedIds).toEqual([]);
  });
});

describe("cleanup", () => {
  it("lists what was removed and why", async () => {
    const h = harness();
    h.reaped.push({
      id: "aaaaaaaaaaaa",
      containerId: "full",
      reason: "deadline passed",
    });
    expect(await main(["cleanup"], h.deps)).toBe(0);
    expect(h.out.join("")).toBe("removed aaaaaaaaaaaa: deadline passed\n");
  });

  it("says so when there is nothing to do", async () => {
    const h = harness();
    await main(["cleanup"], h.deps);
    expect(h.out.join("")).toBe("nothing to clean up\n");
  });
});

describe("start --config", () => {
  const summary: ConfigSummary = {
    source: "/work/ha-config",
    files: 12,
    excluded: [".storage/", "secrets.yaml"],
    skippedLinks: ["leaves.yaml"],
    secrets: "placeholders",
    placeholderKeys: ["a", "b"],
    userVirtualIntegration: true,
  };

  function withConfig(h: Harness): Partial<CliDeps> {
    return {
      start: async (options) => {
        h.started.push(options);
        return {
          ...fakeSandbox(h.stopped, options.mode, h.reaped, h.detached),
          config: { ...summary },
        };
      },
    };
  }

  it("passes the directory and the secrets file as absolute paths", async () => {
    const h = harness();
    await main(
      ["start", "--config", "ha", "--secrets-file", "own.yaml", "--", "true"],
      h.deps,
    );
    const config = h.started[0]?.config;
    expect(config?.dir).toBe(`${process.cwd()}/ha`);
    expect(config?.secretsFile).toBe(`${process.cwd()}/own.yaml`);
  });

  it("starts without a configuration when none is given", async () => {
    const h = harness();
    await main(["start", "--", "true"], h.deps);
    expect(h.started[0]?.config).toBeUndefined();
  });

  it("rejects --secrets-file without --config", async () => {
    const h = harness();
    expect(
      await main(["start", "--secrets-file", "own.yaml", "--", "true"], h.deps),
    ).toBe(2);
    expect(h.started).toEqual([]);
  });

  it("rejects an empty --config or --secrets-file", async () => {
    for (const args of [
      ["start", "--config", "", "--", "true"],
      ["start", "--config", "ha", "--secrets-file", "", "--", "true"],
    ]) {
      const h = harness();
      expect(await main(args, h.deps)).toBe(2);
      expect(h.started).toEqual([]);
    }
  });

  it("says what was loaded, on stderr, before running the command", async () => {
    const h = harness();
    Object.assign(h.deps, withConfig(h));
    await main(["start", "--config", "ha", "--", "true"], h.deps);
    const err = h.err.join("");
    expect(err).toContain("config /work/ha-config: 12 files");
    expect(err).toContain("placeholders for 2 keys");
    expect(err).toContain(".storage/, secrets.yaml");
    expect(err).toContain("leaves.yaml");
    expect(err).toContain("custom_components/virtual");
    expect(h.out.join("")).toBe("");
  });

  it("says what was loaded on stdout for a background instance", async () => {
    const h = harness();
    Object.assign(h.deps, withConfig(h));
    await main(["start", "--background", "--config", "ha"], h.deps);
    expect(h.out.join("")).toContain("config /work/ha-config: 12 files");
  });

  it("includes the summary in the JSON and never the token", async () => {
    const h = harness();
    Object.assign(h.deps, withConfig(h));
    await main(["start", "--background", "--json", "--config", "ha"], h.deps);
    const parsed = JSON.parse(h.out.join("")) as {
      config: { files: number };
    };
    expect(parsed.config.files).toBe(12);
    expect(h.out.join("")).not.toContain(TOKEN);
  });

  it("exits 1 for a directory the sandbox cannot use", async () => {
    const h = harness({
      start: async () => {
        throw new SandboxError("config_dir_invalid", "No configuration.yaml");
      },
    });
    expect(await main(["start", "--config", "ha", "--", "true"], h.deps)).toBe(
      1,
    );
    expect(h.err.join("")).toContain("config_dir_invalid");
  });
});

describe("smoke", () => {
  it("checks the stable channel by default and exits 0 for a pass", async () => {
    const h = harness();
    expect(await main(["smoke"], h.deps)).toBe(0);
    expect(h.smoked).toEqual([{ channel: "stable" }]);
    expect(h.out.join("")).toContain("stable 2026.10.1: passed");
  });

  it("takes a channel or an exact release", async () => {
    const h = harness();
    await main(["smoke", "--channel", "previous-stable"], h.deps);
    await main(["smoke", "--release", "2026.9.3"], h.deps);
    expect(h.smoked).toEqual([
      { channel: "previous-stable" },
      { release: "2026.9.3" },
    ]);
  });

  it.each([
    [["smoke", "--channel", "nightly"]],
    [["smoke", "--release", "latest"]],
    [["smoke", "--channel", "stable", "--release", "2026.9.3"]],
    [["smoke", "--result", ""]],
    [["smoke", "--bogus"]],
    [["smoke", "extra"]],
  ])("exits 2 for %j without running anything", async (argv) => {
    const h = harness();
    expect(await main(argv, h.deps)).toBe(2);
    expect(h.smoked).toEqual([]);
  });

  it("exits 1 for a failed check and names the step", async () => {
    const h = harness();
    h.smokeResult = {
      ...passedRun(),
      outcome: "failed",
      failedStep: "time",
      steps: STEP_NAMES.map((name) => ({
        name,
        status: name === "time" ? "failed" : "passed",
        ms: 1,
        ...(name === "time" ? { message: "automation did not fire" } : {}),
      })),
    };
    expect(await main(["smoke"], h.deps)).toBe(1);
    expect(h.out.join("")).toContain("failed at time");
    expect(h.out.join("")).toContain("automation did not fire");
  });

  it("exits 3 when the run could not happen, and 0 when no beta is in progress", async () => {
    const h = harness();
    h.smokeResult = {
      ...passedRun(),
      outcome: "could-not-run",
      failedStep: "pull",
      steps: [],
    };
    expect(await main(["smoke"], h.deps)).toBe(3);
    const rest = Object.fromEntries(
      Object.entries(passedRun()).filter(([name]) => name !== "release"),
    ) as RunResult;
    h.smokeResult = {
      ...rest,
      channel: "beta",
      outcome: "no-beta-in-progress",
      steps: [],
    };
    expect(await main(["smoke", "--channel", "beta"], h.deps)).toBe(0);
  });

  it("keeps the run's exit code when the result file cannot be written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domusops-smoke-"));
    try {
      const h = harness();
      const code = await main(
        ["smoke", "--result", join(dir, "missing", "result.json")],
        h.deps,
      );
      expect(h.out.join("")).toContain("passed");
      expect(h.err.join("")).toContain("Could not write");
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the result file when asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domusops-smoke-"));
    try {
      const file = join(dir, "result.json");
      const h = harness();
      await main(["smoke", "--result", file], h.deps);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(passedRun());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
