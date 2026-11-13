import type { HistoryDetailLevel } from "@domusops/schema";
import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig, readHistoryLimit } from "../ha/config.js";
import { readHistory } from "../ha/history.js";
import { readCore, readCurrentUser } from "../ha/instance.js";
import { readStates } from "../ha/states.js";
import { encodeStandardHistory } from "../history/encode-standard.js";
import { encodeSummaryHistory } from "../history/encode-summary.js";
import {
  entityHistories,
  keepAttributes,
  redactHistories,
} from "../history/entries.js";
import { historyFrame } from "../history/envelope.js";
import { parseHistoryInputs } from "../history/inputs.js";
import { candidates, listing, needsCurrentIds } from "../history/select.js";
import { parseSelectors } from "../logbook/selectors.js";
import { localParts } from "../logbook/local-time.js";
import {
  parseWindowInput,
  resolveWindow,
  type ResolvedWindow,
} from "../logbook/window.js";
import {
  exclusionNote,
  noHistoryNote,
  nothingChangedNote,
  nothingMatchedNote,
  type Response,
} from "../notes.js";
import { byteLength, finalize } from "../snapshot/ratio.js";

/** The longest window a call may read: 10 days, the instance's default retention (FR-004). */
const MAX_WINDOW_MS = 10 * 86_400_000;

/**
 * The window's length on the instance's wall clock, so a daylight-saving change inside it neither
 * adds nor removes an hour: 10 local days are allowed even when they last 10 days and 1 hour
 * (research R5).
 */
function localLength(window: ResolvedWindow, timeZone: string): number {
  const wall = (epochMs: number): number => {
    const p = localParts(epochMs, timeZone);
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) +
      (epochMs % 1000)
    );
  };
  return wall(window.endMs) - wall(window.startMs);
}

export interface HistoryOptions {
  /** Defaults to `standard`. */
  detail?: HistoryDetailLevel;
  entities?: string[];
  /** Entity IDs and patterns left out after `entities`. */
  exclude?: string[];
  /** ISO 8601; defaults to 24 hours before `end`. */
  start?: string | undefined;
  /** ISO 8601; defaults to now. */
  end?: string | undefined;
  /** Attribute names to keep (`standard` only). */
  attributes?: string[];
  /** Only the changes the instance considers significant. */
  significant_only?: boolean;
  timeouts?: Partial<Timeouts>;
  /** The time of the call, in epoch milliseconds. Defaults to the clock; tests pin it. */
  now?: number;
}

/** The minified document of a `ha_history` call, without its notes. Throws a `ToolError`. */
export async function runHistory(
  env: Readonly<Record<string, string | undefined>>,
  options: HistoryOptions = {},
): Promise<string> {
  return (await queryHistory(env, options)).document;
}

/**
 * The whole `ha_history` pipeline (specs/011-ha-history): configuration, input validation, one
 * connection, the administrator and integration checks, the window, the candidates, one history
 * read, the listing rule, redaction and encoding. Resolves with the minified document and the notes
 * that follow it, or throws a `ToolError`.
 */
export async function queryHistory(
  env: Readonly<Record<string, string | undefined>>,
  options: HistoryOptions = {},
): Promise<Response> {
  const config = readConfig(env);
  // Everything that can be checked without the instance is checked before connecting.
  const now = options.now ?? Date.now();
  const selectors = parseSelectors(options.entities);
  const exclude = parseSelectors(options.exclude, "exclusion selector");
  const parsedWindow = parseWindowInput({
    ...(options.start === undefined ? {} : { start: options.start }),
    ...(options.end === undefined ? {} : { end: options.end }),
  });
  const inputs = parseHistoryInputs({
    ...(options.attributes === undefined
      ? {}
      : { attributes: options.attributes }),
    ...(options.significant_only === undefined
      ? {}
      : { significant_only: options.significant_only }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  });
  const limit = readHistoryLimit(env);

  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    // The user and the core config are read together; nothing else is read for a user who is not
    // an administrator (research R2). The reads settle in the order they are sent.
    const current = readCurrentUser(client);
    const core = readCore(client);
    core.catch(() => undefined);
    const user = await current;
    if (!user.isAdmin) throw errors.notAdmin("entity_history");
    const { instance } = await core;
    if (!instance.components.includes("history")) {
      throw errors.historyUnavailable("states");
    }
    const window = resolveWindow(parsedWindow, now, instance.timeZone);
    // Checked once the time zone is known, before the history is read (research R5).
    if (localLength(window, instance.timeZone) > MAX_WINDOW_MS) {
      throw errors.windowTooLong();
    }

    const currentIds = needsCurrentIds(selectors)
      ? (await readStates(client)).map((state) => state.entity_id)
      : null;
    const chosen = candidates(currentIds, selectors, exclude);
    const frame = historyFrame({
      detail: inputs.detail,
      haVersion: instance.haVersion,
      timeZone: instance.timeZone,
      window,
      significantOnly: inputs.significantOnly,
      ...(selectors === undefined ? {} : { selectors }),
      ...(inputs.attributes === undefined
        ? {}
        : { attributes: inputs.attributes }),
    });

    const notes: string[] = [];
    if (exclude !== undefined) notes.push(exclusionNote(exclude));
    if (chosen.ids.length === 0) {
      // Exact IDs left here are not valid entity IDs: nothing was ever recorded for them.
      if (chosen.exact.length > 0) notes.push(noHistoryNote(chosen.exact));
      notes.push(nothingMatchedNote());
      return {
        document: finalize(
          inputs.detail === "summary"
            ? encodeSummaryHistory(
                frame,
                {},
                window.startMs,
                selectors !== undefined,
              )
            : encodeStandardHistory(frame, []),
          0,
        ),
        notes,
      };
    }

    const answer = await readHistory(client, {
      start_time: window.startIso,
      end_time: window.endIso,
      entity_ids: chosen.ids,
      include_start_time_state: true,
      significant_changes_only: inputs.significantOnly,
      // The summary needs only the states and `lc` (research R11).
      no_attributes: inputs.detail === "summary",
    });
    // The raw size is the history as received, before redaction (research R12).
    const rawBytes = byteLength(JSON.stringify(answer));
    const { listed, noHistory } = listing(
      entityHistories(answer, window.startMs),
      chosen,
    );
    if (noHistory.length > 0) notes.push(noHistoryNote(noHistory));

    if (inputs.detail === "summary") {
      // The summary carries no attribute or state, so nothing in it needs redaction. Without
      // entities it has no rows per entity and is never refused for its size (research R10, R11).
      const withEntities = selectors !== undefined;
      const document = encodeSummaryHistory(
        frame,
        answer,
        window.startMs,
        withEntities,
      );
      const text = finalize(document, rawBytes);
      const bytes = byteLength(text);
      if (withEntities && bytes > limit) {
        throw errors.tooLargeHistory(
          document.counts.entities,
          document.counts.changes,
          bytes,
          limit,
          "summary",
        );
      }
      if (document.counts.entities === 0) notes.push(nothingChangedNote());
      return { document: text, notes };
    }

    const redacted = redactHistories(listed, {
      token: config.token,
      coordinates: {
        latitude: instance.latitude,
        longitude: instance.longitude,
      },
    });
    const kept =
      inputs.attributes === undefined
        ? redacted
        : keepAttributes(redacted, inputs.attributes);
    const text = finalize(encodeStandardHistory(frame, kept), rawBytes);
    // A result above the limit is an error, never a truncated result (FR-011).
    const bytes = byteLength(text);
    if (bytes > limit) {
      throw errors.tooLargeHistory(
        kept.length,
        kept.reduce((sum, history) => sum + history.changes.length, 0),
        bytes,
        limit,
        "standard",
      );
    }

    if (listed.length === 0) notes.push(nothingChangedNote());
    return { document: text, notes };
  } finally {
    client.close();
  }
}
