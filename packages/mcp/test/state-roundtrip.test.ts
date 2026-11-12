import {
  expandState,
  type StateRecord,
  type StateStandardDocument,
} from "@domusops/schema";
import { afterEach, describe, expect, it } from "vitest";
import type { HaState } from "../src/ha/states.js";
import { formatLocalIso } from "../src/logbook/local-time.js";
import { EXEMPT_KEYS, redactRows } from "../src/snapshot/redact.js";
import { queryState } from "../src/tools/ha-state.js";
import { REFERENCE_500 } from "./fixtures/generate.js";
import { FAKE_TOKEN, startFakeHa } from "./support/fake-ha.js";
import { BASE_MS } from "./support/states.js";

/**
 * `expandState(encode(redact(states)))` equals the redacted states, times to the second in local
 * form and context IDs full (specs/010-ha-state data-model §7, FR-018, SC-002).
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const { config } = REFERENCE_500.records;
const ZONE = String(config["time_zone"]);
const ALL = REFERENCE_500.records.states as unknown as HaState[];

const local = (text: string): string =>
  formatLocalIso(Date.parse(text), ZONE, null);

/** What the decoder must return for these states: redacted, in entity-ID order. */
function expected(states: readonly HaState[]): StateRecord[] {
  const redacted = redactRows(states, {
    token: FAKE_TOKEN,
    exemptKeys: EXEMPT_KEYS,
    coordinates: {
      latitude: config["latitude"],
      longitude: config["longitude"],
    },
  });
  return redacted
    .map((state, at) => {
      const raw = states[at] as HaState;
      return {
        entity_id: state.entity_id,
        state: state.state,
        attributes: state.attributes,
        last_changed: local(raw.last_changed),
        last_updated: local(raw.last_updated),
        last_reported: local(raw.last_reported),
        context: state.context,
      };
    })
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1));
}

describe("the state document round trip", () => {
  it.each([
    ["every entity", undefined, () => true],
    ["light.*", ["light.*"], (id: string) => id.startsWith("light.")],
    ["sensor.*", ["sensor.*"], (id: string) => id.startsWith("sensor.")],
    [
      "one entity",
      [ALL[7]!.entity_id],
      (id: string) => id === ALL[7]!.entity_id,
    ],
    ["none", ["no_such_domain.*"], () => false],
  ])("decodes %s back to the redacted states", async (_, entities, keep) => {
    const ha = await startFakeHa({ fixture: REFERENCE_500 });
    cleanups.push(() => ha.close());
    const { document } = await queryState(
      { DOMUSOPS_HA_URL: ha.url, DOMUSOPS_HA_TOKEN: FAKE_TOKEN },
      { ...(entities === undefined ? {} : { entities }), now: BASE_MS },
    );
    const decoded = expandState(JSON.parse(document) as StateStandardDocument);
    expect(decoded).toEqual(expected(ALL.filter((s) => keep(s.entity_id))));
  });
});
