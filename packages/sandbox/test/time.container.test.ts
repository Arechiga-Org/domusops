import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { startSandbox } from "../src/index.js";
import { CHANNELS, startTarget } from "./support/channels.js";

const MINUTE = 60_000;
const REFERENCE = fileURLToPath(
  new URL("../fixtures/reference-config", import.meta.url),
);

describe.each(CHANNELS)("time control on %s", (channel) => {
  it(
    "runs the 03:00 reference automation by advancing a frozen clock (SC-004)",
    async () => {
      const sandbox = await startSandbox({
        ...startTarget(channel),
        config: { dir: REFERENCE },
        devices: [{ kind: "light", name: "Hall" }],
      });
      try {
        await sandbox.callService("light", "turn_off", {
          entity_id: "light.hall",
        });
        expect(await sandbox.getState("light.hall")).toMatchObject({
          state: "off",
        });

        await sandbox.time.freeze("2031-03-04T02:59:50Z");
        expect(await sandbox.time.now()).toEqual({
          now: "2031-03-04T02:59:50Z",
          frozen: true,
        });

        const began = Date.now();
        const result = await sandbox.time.advance(20);
        expect(result.now).toBe("2031-03-04T03:00:10Z");
        expect(result.fired).toBeGreaterThanOrEqual(1);
        await expect
          .poll(async () => (await sandbox.getState("light.hall"))?.state, {
            timeout: 10_000,
          })
          .toBe("on");
        expect(Date.now() - began).toBeLessThan(10_000);

        await sandbox.time.resume();
        expect((await sandbox.time.now()).frozen).toBe(false);
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );

  it(
    "runs a multi-step automation with a delay and stamps states with the frozen clock",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "domusops-chain-"));
      writeFileSync(
        join(dir, "configuration.yaml"),
        "default_config:\nautomation: !include automations.yaml\n",
      );
      writeFileSync(
        join(dir, "automations.yaml"),
        [
          "- alias: chain",
          "  triggers:",
          "    - trigger: time",
          '      at: "03:00:00"',
          "  actions:",
          "    - action: light.turn_on",
          "      target: {entity_id: light.hall}",
          "    - delay: 5",
          "    - action: light.turn_off",
          "      target: {entity_id: light.hall}",
          "    - action: switch.turn_on",
          "      target: {entity_id: switch.chain_done}",
          "",
        ].join("\n"),
      );
      const sandbox = await startSandbox({
        ...startTarget(channel),
        config: { dir },
        devices: [
          { kind: "light", name: "Hall" },
          { kind: "switch", name: "Chain Done" },
        ],
      });
      try {
        await sandbox.callService("light", "turn_off", {
          entity_id: "light.hall",
        });
        await sandbox.callService("switch", "turn_off", {
          entity_id: "switch.chain_done",
        });
        await sandbox.time.freeze("2031-03-04T02:59:50Z");

        // A state changed after the freeze carries the frozen time, not the wall clock.
        await sandbox.callService("switch", "turn_on", {
          entity_id: "switch.chain_done",
        });
        await sandbox.callService("switch", "turn_off", {
          entity_id: "switch.chain_done",
        });
        const { url, token } = sandbox.connection();
        const response = await fetch(`${url}/api/template`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            template:
              "{{ states.switch.chain_done.last_changed.year }} {{ ((now() - states.switch.chain_done.last_changed).total_seconds() | abs) < 60 }}",
          }),
        });
        expect(await response.text()).toBe("2031 True");

        // The 5 s delay falls due inside the same advance, not after 5 s of real time.
        const began = Date.now();
        await sandbox.time.advance(20);
        await expect
          .poll(
            async () => (await sandbox.getState("switch.chain_done"))?.state,
            { timeout: 4_000 },
          )
          .toBe("on");
        expect(Date.now() - began).toBeLessThan(5_000);
        expect((await sandbox.getState("light.hall"))?.state).toBe("off");
      } finally {
        await sandbox.stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    8 * MINUTE,
  );

  it(
    "rejects an advance that is out of range",
    async () => {
      const sandbox = await startSandbox({ ...startTarget(channel) });
      try {
        await expect(sandbox.time.advance(0)).rejects.toThrow(RangeError);
        await expect(sandbox.time.freeze("not a date")).rejects.toThrow(
          TypeError,
        );
      } finally {
        await sandbox.stop();
      }
    },
    5 * MINUTE,
  );
});
