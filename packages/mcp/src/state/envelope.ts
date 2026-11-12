import {
  STATE_FORMAT,
  type StateDetailLevel,
  type StateEnvelope,
} from "@domusops/schema";
import type { HaState } from "../ha/states.js";
import {
  formatLocalIso,
  formatOffset,
  localParts,
} from "../logbook/local-time.js";

/** The envelope and what encoding needs from it: the anchor and the default offset. */
export interface StateFrame {
  envelope: StateEnvelope;
  timeZone: string;
  /** The anchor in epoch milliseconds, at the start of its second. */
  anchorMs: number;
  /** Minutes east of UTC at the anchor; a local time with this offset leaves it out. */
  offsetMinutes: number;
}

/**
 * The envelope of data-model §1. `anchor` is the latest `last_updated` selected, truncated to the
 * second, or the call time when nothing is selected (research R5).
 */
export function stateFrame(input: {
  detail: StateDetailLevel;
  haVersion: string;
  timeZone: string;
  states: readonly HaState[];
  nowMs: number;
  selectors?: readonly string[];
  domains?: readonly string[];
  /** `state` as parsed; `states` is the selected state objects. */
  stateValues?: readonly string[];
  attributes?: readonly string[];
}): StateFrame {
  const latest = input.states.reduce(
    (max, s) => Math.max(max, Date.parse(s.last_updated)),
    input.states.length === 0 ? input.nowMs : Number.NEGATIVE_INFINITY,
  );
  const anchorMs = Math.floor(latest / 1000) * 1000;
  const offsetMinutes = localParts(anchorMs, input.timeZone).offsetMinutes;
  const envelope: StateEnvelope = {
    format: STATE_FORMAT,
    detail: input.detail,
    ha_version: input.haVersion,
    compression_ratio: 0,
    time_zone: input.timeZone,
    utc_offset: formatOffset(offsetMinutes),
    anchor: formatLocalIso(anchorMs, input.timeZone, null),
    ...(input.selectors === undefined
      ? {}
      : { selectors: [...input.selectors] }),
    ...(input.domains === undefined ? {} : { domains: [...input.domains] }),
    ...(input.stateValues === undefined
      ? {}
      : { states: [...input.stateValues] }),
    ...(input.attributes === undefined
      ? {}
      : { attributes: [...input.attributes] }),
  };
  return { envelope, timeZone: input.timeZone, anchorMs, offsetMinutes };
}
