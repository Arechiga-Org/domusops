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
