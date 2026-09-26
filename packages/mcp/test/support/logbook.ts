import type { EncodeContext } from "../../src/logbook/encode-standard.js";
import type { LogbookFixture } from "../fixtures/generate-logbook.js";

/** The encoding context of a fixture's window, as the tool would resolve it. */
export function contextFor(
  fixture: Pick<LogbookFixture, "window" | "haVersion">,
  timeZone = "Europe/Madrid",
): EncodeContext {
  const startMs = fixture.window.start * 1000;
  const endMs = fixture.window.end * 1000;
  return {
    haVersion: fixture.haVersion,
    timeZone,
    window: {
      startMs,
      endMs,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
    },
    selectors: undefined,
    noEvents: [],
  };
}
