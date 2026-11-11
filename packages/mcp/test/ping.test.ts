import { PING_FORMAT, type PingDocument } from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import { packageVersion, SERVER_NAME } from "../src/package-info.js";
import { encodePing } from "../src/ping/encode.js";
import { byteLength, measureRowsBytes } from "../src/snapshot/ratio.js";
import { runPing } from "../src/tools/ha-ping.js";
import { REFERENCE_500, type Fixture } from "./fixtures/generate.js";
import {
  FAKE_TOKEN,
  startFakeHa,
  type FakeHa,
  type FakeHaOptions,
} from "./support/fake-ha.js";

/** `ha_ping` (specs/009-ha-ping: FR-001 to FR-013, FR-018, SC-001 to SC-004, research R1 to R8). */

const running: FakeHa[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

const NEEDED = ["logbook", "trace"];

/** The reference instance with the given integrations loaded among its many others. */
function instance(loaded: readonly string[] = NEEDED): Fixture {
  const config = REFERENCE_500.records.config as Record<string, unknown>;
  const others = (config["components"] as string[]).filter(
    (name) => !NEEDED.includes(name),
  );
  return {
    ...REFERENCE_500,
    records: {
      ...REFERENCE_500.records,
      config: { ...config, components: [...others, ...loaded] },
    },
  };
}

async function ping(
  fixture: Fixture = instance(),
  fake: Partial<FakeHaOptions> = {},
): Promise<{ ha: FakeHa; text: string; document: PingDocument }> {
  const ha = await startFakeHa({ fixture, ...fake });
  running.push(ha);
  const text = await runPing({
    DOMUSOPS_HA_URL: ha.url,
    DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
  });
  return { ha, text, document: JSON.parse(text) as PingDocument };
}

describe("ha_ping on a healthy instance", () => {
  it("returns the document of the contract", async () => {
    const fixture = instance();
    const { document, text } = await ping(fixture);
    const rawBytes = measureRowsBytes([
      { ...fixture.user, is_admin: true },
      fixture.records.config,
    ]);
    const { compression_ratio: ratio, ...rest } = document;
    expect(rest).toEqual({
      format: PING_FORMAT,
      server: { name: SERVER_NAME, version: packageVersion() },
      instance: {
        version: fixture.haVersion,
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
    });
    expect(Object.keys(document)).toEqual([
      "format",
      "server",
      "instance",
      "admin",
      "integrations",
      "tools",
      "compression_ratio",
    ]);
    const emitted = byteLength(
      JSON.stringify({ ...document, compression_ratio: 0 }),
    );
    expect(ratio).toBe(Math.round((rawBytes / emitted) * 100) / 100);
    expect(text).toBe(JSON.stringify(document));
  });

  it("meets the compression floor of 3 on the reference instance (FR-013, research R7)", async () => {
    expect((await ping()).document.compression_ratio).toBeGreaterThanOrEqual(3);
  });

  it("reports the server's name and version as the handshake does (FR-002)", async () => {
    const { document } = await ping();
    expect(document.server).toEqual({
      name: "domusops-mcp",
      version: packageVersion(),
    });
  });

  it("opens one connection and reads only the user and the core configuration (FR-008, SC-002)", async () => {
    const { ha } = await ping();
    expect(ha.connections).toBe(1);
    expect(ha.received).toEqual(["auth/current_user", "get_config"]);
  });

  it("gives byte-identical documents on two calls (User Story 1, scenario 2)", async () => {
    const fixture = instance();
    expect((await ping(fixture)).text).toBe((await ping(fixture)).text);
  });

  it("carries no token, address, location, name or id of the instance or its user (FR-010)", async () => {
    const fixture = instance();
    const { text, ha } = await ping(fixture);
    const config = fixture.records.config as Record<string, unknown>;
    const secrets = [
      FAKE_TOKEN,
      ha.url,
      String(ha.port),
      String(config["latitude"]),
      String(config["longitude"]),
      String(config["elevation"]),
      String(config["location_name"]),
      String(config["internal_url"]),
      String(fixture.user["id"]),
      String(fixture.user["name"]),
    ];
    for (const secret of secrets) expect(text).not.toContain(secret);
  });
});

describe("ha_ping on an instance with a setup problem", () => {
  const dotted = (): Fixture => instance(["logbook", "trace.sensor"]);

  it("names a user who is not an administrator in every tool, with one sentence (User Story 2, scenario 1)", async () => {
    const { document } = await ping(instance(), { isAdmin: false });
    expect(document.admin).toBe(false);
    for (const tool of Object.values(document.tools)) {
      expect(tool).toEqual({ ready: false, reasons: ["not_admin"] });
    }
    expect(document.next_steps).toEqual([
      "Use a token of an administrator user, which ha_snapshot, ha_logbook_query, ha_trace need",
    ]);
  });

  it("names a missing integration only in the tools that need it (scenario 2)", async () => {
    const { document } = await ping(instance(["logbook"]));
    expect(document.integrations).toEqual({ logbook: true, trace: false });
    expect(document.tools).toEqual({
      ha_snapshot: { ready: true },
      ha_logbook_query: { ready: true },
      ha_trace: { ready: false, reasons: ["integration_missing:trace"] },
    });
    expect(document.next_steps).toEqual([
      "Enable the trace integration in Home Assistant (it is part of default_config), then try again",
    ]);
  });

  it("a missing logbook affects only ha_logbook_query", async () => {
    const { document } = await ping(instance(["trace"]));
    expect(document.tools["ha_logbook_query"]?.reasons).toEqual([
      "integration_missing:logbook",
    ]);
    expect(document.tools["ha_trace"]).toEqual({ ready: true });
    expect(document.tools["ha_snapshot"]).toEqual({ ready: true });
  });

  it("does not count a platform of an integration as the integration (research R2)", async () => {
    const { document } = await ping(dotted());
    expect(document.integrations["trace"]).toBe(false);
    expect(document.tools["ha_trace"]?.ready).toBe(false);
  });

  it("reports an instance below the minimum in the document, not as an error (scenario 3)", async () => {
    const { document, ha } = await ping(instance(), { haVersion: "2024.12.4" });
    expect(document.instance).toMatchObject({
      version: "2024.12.4",
      minimum: "2025.1.0",
      supported: false,
    });
    for (const tool of Object.values(document.tools)) {
      expect(tool.reasons).toEqual(["version_unsupported"]);
    }
    expect(document.next_steps).toEqual([
      "Upgrade the instance to 2025.1.0 or later",
    ]);
    expect(ha.connections).toBe(1);
  });

  it("judges a beta build on its base version", async () => {
    const { document } = await ping(instance(), { haVersion: "2026.10.0b3" });
    expect(document.instance).toMatchObject({
      version: "2026.10.0b3",
      supported: true,
    });
  });

  it("lists reasons in the order of the data model, and one sentence per distinct reason", async () => {
    const { document } = await ping(instance([]), {
      haVersion: "2024.12.4",
      isAdmin: false,
    });
    expect(document.tools["ha_logbook_query"]?.reasons).toEqual([
      "version_unsupported",
      "not_admin",
      "integration_missing:logbook",
    ]);
    expect(document.next_steps).toEqual([
      "Upgrade the instance to 2025.1.0 or later",
      "Use a token of an administrator user, which ha_snapshot, ha_logbook_query, ha_trace need",
      "Enable the logbook integration in Home Assistant (it is part of default_config), then try again",
      "Enable the trace integration in Home Assistant (it is part of default_config), then try again",
    ]);
  });
});

describe("ha_ping failures before the instance answers", () => {
  const SHORT = { connectMs: 200, commandMs: 500, totalMs: 1_000 };

  async function failure(
    run: () => Promise<unknown>,
  ): Promise<{ kind?: string; message: string }> {
    return run().then(
      () => ({ message: "did not fail" }),
      (error: { kind?: string; message: string }) => error,
    );
  }

  async function withInstance(
    fake: Partial<FakeHaOptions>,
    env: (ha: FakeHa) => Record<string, string>,
    timeouts: Partial<typeof SHORT> = SHORT,
  ): Promise<{ error: { kind?: string; message: string }; ha: FakeHa }> {
    const ha = await startFakeHa({ fixture: instance(), ...fake });
    running.push(ha);
    const error = await failure(() => runPing(env(ha), { timeouts }));
    return { error, ha };
  }

  const good = (ha: FakeHa): Record<string, string> => ({
    DOMUSOPS_HA_URL: ha.url,
    DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
  });

  it("gives timeout, not a document, when get_config stalls", async () => {
    const { error } = await withInstance({ stall: "get_config" }, good);
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("get_config");
  });

  it("gives timeout within the connection limit when the instance never greets (SC-004)", async () => {
    const started = Date.now();
    const { error } = await withInstance({ stall: "connect" }, good);
    expect(error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("gives auth_invalid for a refused token, without echoing it", async () => {
    const { error } = await withInstance({}, (ha) => ({
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: "wrong-token",
    }));
    expect(error.kind).toBe("auth_invalid");
    expect(error.message).not.toContain("wrong-token");
  });

  it("gives unreachable when nothing answers at the address", async () => {
    const error = await failure(() =>
      runPing(
        {
          DOMUSOPS_HA_URL: "http://127.0.0.1:1",
          DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
        },
        { timeouts: SHORT },
      ),
    );
    expect(error.kind).toBe("unreachable");
  });

  it.each([
    ["DOMUSOPS_HA_URL", { DOMUSOPS_HA_TOKEN: FAKE_TOKEN }, "config_missing"],
    [
      "DOMUSOPS_HA_TOKEN",
      { DOMUSOPS_HA_URL: "http://127.0.0.1:1" },
      "config_missing",
    ],
    [
      "a malformed address",
      { DOMUSOPS_HA_URL: "not a url", DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
      "config_invalid",
    ],
  ])(
    "gives %s as the other tools do, before connecting",
    async (_, env, kind) => {
      const error = await failure(() => runPing(env, { timeouts: SHORT }));
      expect(error.kind).toBe(kind);
    },
  );
});

describe("ha_ping reads the same core configuration as the other tools", () => {
  it("does not need the recorder to report ha_logbook_query ready, as the tool does not (research R4)", async () => {
    const { document } = await ping(instance(["logbook", "trace"]));
    expect(document.tools["ha_logbook_query"]).toEqual({ ready: true });
  });

  it("gives a protocol error when the components are not all names, rather than showing every integration missing", async () => {
    const fixture = instance();
    const config = fixture.records.config as Record<string, unknown>;
    const bad: Fixture = {
      ...fixture,
      records: {
        ...fixture.records,
        config: { ...config, components: [...NEEDED, { name: "trace" }] },
      },
    };
    const ha = await startFakeHa({ fixture: bad });
    running.push(ha);
    const error = await runPing({
      DOMUSOPS_HA_URL: ha.url,
      DOMUSOPS_HA_TOKEN: FAKE_TOKEN,
    }).then(
      () => ({ kind: "did not fail" }),
      (failure: { kind?: string }) => failure,
    );
    expect(error.kind).toBe("protocol_error");
  });
});

describe("encodePing: the administrator sentence", () => {
  it("names only the tools that need an administrator", () => {
    const text = encodePing(
      {
        serverVersion: "0.2.0",
        instanceVersion: "2026.10.0",
        timeZone: "Europe/Amsterdam",
        admin: false,
        components: [],
        rawBytes: 2_500,
      },
      {
        ha_a: { admin: true, integrations: [] },
        ha_b: { admin: false, integrations: [] },
      },
    );
    const document = JSON.parse(text) as PingDocument;
    expect(document.tools).toEqual({
      ha_a: { ready: false, reasons: ["not_admin"] },
      ha_b: { ready: true },
    });
    expect(document.next_steps).toEqual([
      "Use a token of an administrator user, which ha_a need",
    ]);
  });
});

describe("encodePing", () => {
  const BASE = {
    serverVersion: "0.2.0",
    instanceVersion: "2026.10.0",
    timeZone: "Europe/Amsterdam",
    admin: true,
    components: [] as string[],
    rawBytes: 2_500,
  };

  it("stays under 2,000 bytes in the worst case of the 0.2.0 tools, every reason present (SC-003, research R8)", () => {
    // The six tools the release lists, and the five integrations they need between them.
    const table = {
      ha_snapshot: { admin: true, integrations: [] },
      ha_logbook_query: { admin: true, integrations: ["logbook"] },
      ha_trace: { admin: true, integrations: ["trace"] },
      ha_state: { admin: true, integrations: [] },
      ha_history: { admin: true, integrations: ["history", "recorder"] },
      ha_system_log: { admin: true, integrations: ["system_log"] },
    };
    const text = encodePing(
      { ...BASE, instanceVersion: "2024.12.4", admin: false },
      table,
    );
    const document = JSON.parse(text) as PingDocument;
    expect(Object.keys(document.tools)).toEqual(Object.keys(table));
    expect(document.tools["ha_history"]?.reasons).toEqual([
      "version_unsupported",
      "not_admin",
      "integration_missing:history",
      "integration_missing:recorder",
    ]);
    expect(document.next_steps).toHaveLength(7);
    expect(byteLength(text)).toBeLessThan(2_000);
  });
});
