import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxError } from "../src/errors.js";
import { HaSocket, WsCommandError } from "../src/ha/ws.js";
import { SandboxHandle } from "../src/instance/handle.js";
import type { Runtime } from "../src/runtime/docker.js";

const TOKEN = "plain-instance-token-0123456789abcdef";

function handle(): SandboxHandle {
  return new SandboxHandle({
    id: "sb-test",
    containerId: "c",
    release: { release: "2026.12.0" } as never,
    mode: "tied",
    deadline: "2031-01-01T00:00:00Z",
    port: 1,
    token: TOKEN,
    config: null,
    runtime: {} as Runtime,
  });
}

/** Makes the companion answer the next command with an error of its own. */
function companionAnswers(code: string, message: string): void {
  vi.spyOn(HaSocket, "connect").mockResolvedValue({
    command: async (payload: { type: string }) => {
      throw new WsCommandError(payload.type, code, message);
    },
    close: vi.fn(),
  } as unknown as HaSocket);
}

afterEach(() => vi.restoreAllMocks());

describe("time control on a release that lacks what it replaces (spec FR-016)", () => {
  it.each([
    ["freeze", (h: SandboxHandle) => h.time.freeze("2031-03-04T02:59:50")],
    ["advance", (h: SandboxHandle) => h.time.advance(20)],
  ])(
    "rejects %s with time_unavailable, naming time control, the release and the internal",
    async (_name, call) => {
      companionAnswers(
        "time_unavailable",
        "homeassistant.helpers.event.time_tracker_utcnow is missing in Home Assistant 2026.12.0",
      );
      const error = await call(handle()).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(SandboxError);
      expect((error as SandboxError).code).toBe("time_unavailable");
      const text = (error as SandboxError).message;
      expect(text).toContain(
        "Time control is unavailable on Home Assistant 2026.12.0",
      );
      expect(text).toContain("homeassistant.helpers.event.time_tracker_utcnow");
      expect(text).toContain("Other operations still work.");
    },
  );

  it("keeps time_control_failed for a failure of time control that is not an absence", async () => {
    companionAnswers("time_control_failed", "More than 100000 timers fell due");
    const error = await handle()
      .time.advance(20)
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect((error as SandboxError).code).toBe("time_control_failed");
  });

  it("keeps the token out of the message even when the instance echoes it", async () => {
    companionAnswers("time_unavailable", `refused for ${TOKEN}`);
    const error = await handle()
      .time.freeze("2031-03-04T02:59:50")
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect((error as SandboxError).message).not.toContain(TOKEN);
  });
});
