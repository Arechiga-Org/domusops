import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SandboxError } from "../src/errors.js";
import { HaSocket, type HaEvent } from "../src/ha/ws.js";
import { startSandbox, type Sandbox } from "../src/index.js";
import { CHANNELS, startTarget } from "./support/channels.js";

/**
 * Verification before building (specs/006-scenario-dsl, research.md): the five facts about Home
 * Assistant that the runner's design rests on, checked against a real instance on every channel
 * before `actions.py`, `record.ts`, `expect.ts` and `prepare.ts` are written. If a fact fails,
 * the research decision it supports (R6, R7, R8 or R16) changes first.
 */
const MINUTE = 60_000;
const FIXTURE = fileURLToPath(
  new URL("../fixtures/scenario-config", import.meta.url),
);
const PROBE = fileURLToPath(
  new URL("./fixtures/probe-actions/custom_components", import.meta.url),
);

/** A copy of the scenario fixture in a temporary directory, for the test to change freely. */
function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "domusops-facts-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

async function startOrSkip(
  channel: (typeof CHANNELS)[number],
  dir: string,
): Promise<Sandbox | null> {
  try {
    return await startSandbox({
      ...startTarget(channel),
      config: { dir },
      devices: [],
    });
  } catch (error) {
    if (error instanceof SandboxError && error.code === "no_beta_in_progress") {
      return null;
    }
    throw error;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The event of `type` that satisfies `match`, once it has arrived. */
function arrived(
  events: HaEvent[],
  type: string,
  match: (data: Record<string, unknown>) => boolean = () => true,
): Promise<HaEvent> {
  return vi.waitFor(
    () => {
      const found = events.find(
        (event) => event.event_type === type && match(event.data),
      );
      if (found === undefined) throw new Error(`no ${type} event yet`);
      return found;
    },
    { timeout: 20_000, interval: 50 },
  );
}

const ofType = (events: HaEvent[], type: string): HaEvent[] =>
  events.filter((event) => event.event_type === type);

const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value];

describe.each(CHANNELS)("scenario facts on %s", (channel) => {
  it(
    "facts 1, 2, 3 and 5: the script engine sees a wrapped registry, events carry what the recorder needs, the clock is frozen, and re-enabling fires nothing",
    async () => {
      const dir = copyFixture();
      cpSync(PROBE, join(dir, "custom_components"), { recursive: true });
      appendFileSync(
        join(dir, "configuration.yaml"),
        [
          "",
          "domusops_probe:",
          "",
          "script:",
          "  probe_unknown:",
          "    sequence:",
          "      - action: nope.nothing",
          "      - action: input_boolean.turn_on",
          "        target: { entity_id: input_boolean.study_light }",
          "  probe_answered:",
          "    sequence:",
          "      - action: absent_ok.nothing",
          "      - action: input_boolean.turn_on",
          "        target: { entity_id: input_boolean.study_light }",
          "",
        ].join("\n"),
      );
      const sandbox = await startOrSkip(channel, dir);
      if (sandbox === null) return;
      let socket: HaSocket | undefined;
      try {
        const connection = sandbox.connection();
        socket = await HaSocket.connect(connection.wsUrl, connection.token);
        const events: HaEvent[] = [];
        for (const type of [
          "state_changed",
          "call_service",
          "automation_triggered",
          "domusops_probe_missing",
        ]) {
          await socket.subscribe(type, (event) => events.push(event));
        }

        // Fact 1: wrapping ServiceRegistry.async_call at class level is seen by the script
        // engine; an unknown action raises ServiceNotFound, and an answered one lets the
        // script go on to its next action.
        await sandbox.callService("script", "probe_unknown").catch(() => {});
        const missing = await arrived(
          events,
          "domusops_probe_missing",
          (data) => data["domain"] === "nope",
        );
        expect(missing.data).toMatchObject({
          domain: "nope",
          service: "nothing",
          answered: false,
        });
        expect(
          (await sandbox.getState("input_boolean.study_light"))?.state,
        ).toBe("off");

        await sandbox.callService("script", "probe_answered");
        await arrived(
          events,
          "domusops_probe_missing",
          (data) => data["domain"] === "absent_ok",
        );
        await vi.waitFor(async () => {
          const light = await sandbox.getState("input_boolean.study_light");
          if (light?.state !== "on")
            throw new Error("the script did not go on");
        });
        await sandbox.callService("input_boolean", "turn_off", {
          entity_id: "input_boolean.study_light",
        });

        // Fact 3: with the clock frozen, `time_fired` is the frozen instant.
        const frozen = "2026-04-15T03:00:00Z";
        await sandbox.time.freeze(frozen);
        events.length = 0;
        await sandbox.setState("presence.house", "away");
        const stamped = await arrived(
          events,
          "state_changed",
          (data) => data["entity_id"] === "presence.house",
        );
        expect(new Date(stamped.time_fired).toISOString()).toBe(
          new Date(frozen).toISOString(),
        );

        // Fact 2: a call with a target carries it inside `service_data`, and a triggered
        // automation reports its own entity ID.
        await sandbox.setState("binary_sensor.study_motion", "off");
        events.length = 0;
        await sandbox.setState("binary_sensor.study_motion", "on");
        const triggered = await arrived(events, "automation_triggered");
        expect(triggered.data["entity_id"]).toBe(
          "automation.helper_night_motion",
        );
        const called = await arrived(
          events,
          "call_service",
          (data) => data["domain"] === "input_boolean",
        );
        expect(called.data).toMatchObject({ service: "turn_on" });
        const serviceData = called.data["service_data"] as Record<
          string,
          unknown
        >;
        expect(asList(serviceData["entity_id"])).toEqual([
          "input_boolean.study_light",
        ]);
        await vi.waitFor(async () => {
          const level = await sandbox.getState("input_number.study_brightness");
          if (Number(level?.state) !== 15) throw new Error("not applied yet");
        });

        // Fact 5: turning the automation off with stop_actions, changing its trigger entity and
        // turning it on again fires nothing; a later change still fires it (the control).
        await sandbox.setState("binary_sensor.study_motion", "off");
        await sleep(500);
        events.length = 0;
        await sandbox.callService("automation", "turn_off", {
          entity_id: "automation.helper_night_motion",
          stop_actions: true,
        });
        await sandbox.setState("binary_sensor.study_motion", "on");
        await sandbox.callService("automation", "turn_on", {
          entity_id: "automation.helper_night_motion",
        });
        await sleep(1_500);
        expect(ofType(events, "automation_triggered")).toEqual([]);
        await sandbox.setState("binary_sensor.study_motion", "off");
        await sandbox.setState("binary_sensor.study_motion", "on");
        await arrived(events, "automation_triggered");
        await sleep(500);
        expect(ofType(events, "automation_triggered")).toHaveLength(1);
      } finally {
        socket?.close();
        await sandbox.stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    10 * MINUTE,
  );

  it(
    "fact 4: the time zone of the configuration survives onboarding",
    async () => {
      const dir = copyFixture();
      const file = join(dir, "configuration.yaml");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          "  name: DomusOps Scenario Reference\n",
          "  name: DomusOps Scenario Reference\n  time_zone: Europe/Lisbon\n",
        ),
      );
      expect(readFileSync(file, "utf8")).toContain("time_zone: Europe/Lisbon");
      const sandbox = await startOrSkip(channel, dir);
      if (sandbox === null) return;
      let socket: HaSocket | undefined;
      try {
        const connection = sandbox.connection();
        socket = await HaSocket.connect(connection.wsUrl, connection.token);
        const config = await socket.command<{ time_zone: string }>({
          type: "get_config",
        });
        expect(config.time_zone).toBe("Europe/Lisbon");
      } finally {
        socket?.close();
        await sandbox.stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    10 * MINUTE,
  );
});
