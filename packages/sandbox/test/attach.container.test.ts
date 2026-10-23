import { describe, expect, it } from "vitest";
import { attachSandbox, startSandbox, stopSandbox } from "../src/index.js";
import { CHANNELS, startTarget } from "./support/channels.js";

const MINUTE = 60_000;

/**
 * A process that attaches to a background instance can keep adding virtual devices
 * (specs/007-debt-paydown FR-013, research R10). The unit tests cover the state file against a
 * fake instance; this one proves it against a real one on every release in the matrix.
 */
describe.each(CHANNELS)("devices on an attached handle, on %s", (channel) => {
  it(
    "adds devices to an instance started with `devices`, and a later attach sees them",
    async () => {
      const sandbox = await startSandbox({
        ...startTarget(channel),
        mode: "background",
        devices: [{ kind: "light", name: "Lamp" }],
      });
      try {
        await sandbox.detach();

        const attached = await attachSandbox(sandbox.id);
        expect(attached.devices.map((device) => device.entityId)).toEqual([
          "light.lamp",
        ]);
        const [porch] = await attached.addDevices([
          { kind: "switch", name: "Porch" },
        ]);
        expect(porch?.entityId).toBe("switch.porch");
        expect(await attached.getState("switch.porch")).not.toBeNull();
        // The devices that were already there are still there.
        expect(await attached.getState("light.lamp")).not.toBeNull();
        await attached.detach();

        const later = await attachSandbox(sandbox.id);
        expect(later.devices.map((device) => device.entityId).sort()).toEqual([
          "light.lamp",
          "switch.porch",
        ]);
        await later.detach();
      } finally {
        await stopSandbox(sandbox.id);
      }
    },
    10 * MINUTE,
  );

  it(
    "works for an instance started with an empty list of devices",
    async () => {
      const sandbox = await startSandbox({
        ...startTarget(channel),
        mode: "background",
        devices: [],
      });
      try {
        await sandbox.detach();
        const attached = await attachSandbox(sandbox.id);
        expect(attached.devices).toEqual([]);
        await attached.addDevices([{ kind: "sensor", name: "Temp" }]);
        expect(await attached.getState("sensor.temp")).not.toBeNull();
        await attached.detach();
      } finally {
        await stopSandbox(sandbox.id);
      }
    },
    10 * MINUTE,
  );

  it(
    "says so for an instance started without `devices`",
    async () => {
      const sandbox = await startSandbox({
        ...startTarget(channel),
        mode: "background",
      });
      try {
        await sandbox.detach();
        const attached = await attachSandbox(sandbox.id);
        await expect(
          attached.addDevices([{ kind: "light", name: "Lamp" }]),
        ).rejects.toMatchObject({
          code: "virtual_unavailable",
          message: expect.stringContaining("started without virtual-device"),
        });
        await attached.detach();
      } finally {
        await stopSandbox(sandbox.id);
      }
    },
    10 * MINUTE,
  );
});
