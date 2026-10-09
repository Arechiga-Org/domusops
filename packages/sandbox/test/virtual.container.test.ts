import { describe, expect, it } from "vitest";
import { SandboxError } from "../src/errors.js";
import { startSandbox } from "../src/index.js";
import { CHANNELS, startTarget } from "./support/channels.js";

const MINUTE = 60_000;

describe.each(CHANNELS)("virtual devices on %s", (channel) => {
  it(
    "creates devices at start, sets and reads states, and adds devices later",
    async () => {
      const sandbox = await startSandbox({
        ...startTarget(channel),
        devices: [
          { kind: "light", name: "Lamp" },
          { kind: "binary_sensor", name: "Hall", class: "motion" },
        ],
      });
      try {
        expect(sandbox.devices.map((d) => d.entityId).sort()).toEqual([
          "binary_sensor.hall",
          "light.lamp",
        ]);

        await sandbox.setState("binary_sensor.hall", "on");
        expect(await sandbox.getState("binary_sensor.hall")).toMatchObject({
          state: "on",
        });
        await sandbox.callService("virtual", "turn_off", {
          entity_id: "binary_sensor.hall",
        });
        expect(await sandbox.getState("binary_sensor.hall")).toMatchObject({
          state: "off",
        });
        expect(await sandbox.getState("sensor.does_not_exist")).toBeNull();

        const [porch] = await sandbox.addDevices([
          { kind: "switch", name: "Porch" },
        ]);
        expect(porch?.entityId).toBe("switch.porch");
        expect(await sandbox.getState("switch.porch")).not.toBeNull();
        expect(await sandbox.getState("light.lamp")).not.toBeNull();
        expect(sandbox.devices).toHaveLength(3);
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );

  it(
    "keeps the state and attributes of earlier devices when devices are added",
    async () => {
      const sandbox = await startSandbox({
        ...startTarget(channel),
        devices: [{ kind: "sensor", name: "Temp" }],
      });
      try {
        await sandbox.setState("sensor.temp", "21", {
          unit_of_measurement: "C",
        });
        // Without attributes the entity keeps the ones it has.
        await sandbox.setState("sensor.temp", "22");
        expect(await sandbox.getState("sensor.temp")).toMatchObject({
          state: "22",
          attributes: { unit_of_measurement: "C" },
        });

        await sandbox.addDevices([{ kind: "switch", name: "Extra" }]);

        expect(await sandbox.getState("sensor.temp")).toMatchObject({
          state: "22",
          attributes: { unit_of_measurement: "C" },
        });
        expect(await sandbox.getState("switch.extra")).not.toBeNull();
      } finally {
        await sandbox.stop();
      }
    },
    8 * MINUTE,
  );

  it(
    "refuses to add devices to an instance started without them",
    async () => {
      const sandbox = await startSandbox({ ...startTarget(channel) });
      try {
        await expect(
          sandbox.addDevices([{ kind: "switch", name: "Porch" }]),
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "virtual_unavailable",
        } satisfies Partial<SandboxError>);
      } finally {
        await sandbox.stop();
      }
    },
    5 * MINUTE,
  );
});
