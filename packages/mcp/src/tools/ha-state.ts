import type { StateDetailLevel } from "@domusops/schema";
import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig, readStateLimit } from "../ha/config.js";
import { readCore, readCurrentUser } from "../ha/instance.js";
import { readStates, type HaState } from "../ha/states.js";
import { parseSelectors } from "../logbook/selectors.js";
import {
  exclusionNote,
  notFoundNote,
  nothingMatchedNote,
  type Response,
} from "../notes.js";
import { byteLength, finalize, measureRowsBytes } from "../snapshot/ratio.js";
import { EXEMPT_KEYS, redactRows } from "../snapshot/redact.js";
import { encodeStandardState } from "../state/encode-standard.js";
import { encodeSummaryState } from "../state/encode-summary.js";
import { stateFrame } from "../state/envelope.js";
import { parseStateInputs } from "../state/inputs.js";
import { selectStates, trimAttributes } from "../state/select.js";

export interface StateOptions {
  /** Defaults to `standard`. */
  detail?: StateDetailLevel;
  entities?: string[];
  domain?: string[];
  state?: string[];
  /** Entity IDs and patterns left out after the other filters. */
  exclude?: string[];
  /** Attribute names to keep (`standard` only). */
  attributes?: string[];
  timeouts?: Partial<Timeouts>;
  /** The time of the call, in epoch milliseconds. Defaults to the clock; tests pin it. */
  now?: number;
}

/** The minified document of a `ha_state` call, without its notes. Throws a `ToolError`. */
export async function runState(
  env: Readonly<Record<string, string | undefined>>,
  options: StateOptions = {},
): Promise<string> {
  return (await queryState(env, options)).document;
}

/**
 * The whole `ha_state` pipeline (specs/010-ha-state): configuration, input validation, one
 * connection, the administrator check, the states and core config, selection, redaction and
 * encoding. Resolves with the minified document and the notes that follow it, or throws a
 * `ToolError`.
 */
export async function queryState(
  env: Readonly<Record<string, string | undefined>>,
  options: StateOptions = {},
): Promise<Response> {
  const config = readConfig(env);
  // Everything that can be checked without the instance is checked before connecting.
  const now = options.now ?? Date.now();
  const selectors = parseSelectors(options.entities);
  const exclude = parseSelectors(options.exclude, "exclusion selector");
  const inputs = parseStateInputs({
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.attributes === undefined
      ? {}
      : { attributes: options.attributes }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  });
  const limit = readStateLimit(env);

  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    // The user and the core config are read together. A user who is not an administrator can
    // receive a filtered set of states, so the states are read only after the check (research R1).
    // The reads settle in the order they are sent, so which error is reported when several fail
    // does not depend on timing.
    const current = readCurrentUser(client);
    const core = readCore(client);
    core.catch(() => undefined);
    const user = await current;
    if (!user.isAdmin) throw errors.notAdmin("states");
    const states = readStates(client);
    states.catch(() => undefined);
    const { instance } = await core;
    const all = await states;

    const { selected, notFound } = selectStates(all, {
      ...(selectors === undefined ? {} : { entities: selectors }),
      ...(inputs.domains === undefined ? {} : { domains: inputs.domains }),
      ...(inputs.states === undefined ? {} : { states: inputs.states }),
      ...(exclude === undefined ? {} : { exclude }),
    });
    // The raw size is the selected states as received, before redaction and trimming (R10).
    const rawBytes = measureRowsBytes(selected);
    const frame = stateFrame({
      detail: inputs.detail,
      haVersion: instance.haVersion,
      timeZone: instance.timeZone,
      states: selected,
      nowMs: now,
      ...(selectors === undefined ? {} : { selectors }),
      ...(inputs.domains === undefined ? {} : { domains: inputs.domains }),
      ...(inputs.states === undefined ? {} : { stateValues: inputs.states }),
      ...(inputs.attributes === undefined
        ? {}
        : { attributes: inputs.attributes }),
    });

    let text: string;
    if (inputs.detail === "summary") {
      // The summary carries no attribute, so nothing in it needs redaction; it is never refused
      // for its size, which the counts bound (research R8, R9).
      text = finalize(encodeSummaryState(frame, selected), rawBytes);
    } else {
      const redacted = redactRows(selected, {
        token: config.token,
        exemptKeys: EXEMPT_KEYS,
        coordinates: {
          latitude: instance.latitude,
          longitude: instance.longitude,
        },
      }).map(
        // Times are read from the states as received: redaction never applies to them.
        (state, at): HaState => {
          const raw = selected[at] as HaState;
          return {
            ...state,
            last_changed: raw.last_changed,
            last_updated: raw.last_updated,
            last_reported: raw.last_reported,
          };
        },
      );
      const kept =
        inputs.attributes === undefined
          ? redacted
          : trimAttributes(redacted, inputs.attributes);
      text = finalize(encodeStandardState(frame, kept), rawBytes);
      // A result above the limit is an error, never a truncated result (FR-012).
      const bytes = byteLength(text);
      if (bytes > limit) {
        throw errors.tooLargeStates(selected.length, bytes, limit);
      }
    }

    const notes: string[] = [];
    if (exclude !== undefined) notes.push(exclusionNote(exclude));
    if (notFound.length > 0) notes.push(notFoundNote(notFound));
    if (selected.length === 0) notes.push(nothingMatchedNote());
    return { document: text, notes };
  } finally {
    client.close();
  }
}
