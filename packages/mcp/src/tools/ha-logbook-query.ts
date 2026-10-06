import type { LogbookDetailLevel } from "@domusops/schema";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig, readLogbookLimit } from "../ha/config.js";
import { errors } from "../errors.js";
import { fetchEvents, readContext } from "../ha/logbook.js";
import { encodeStandard } from "../logbook/encode-standard.js";
import { encodeSummary } from "../logbook/encode-summary.js";
import {
  noEvents,
  parseSelectors,
  selectRows,
  strategy,
} from "../logbook/selectors.js";
import { parseWindowInput, resolveWindow } from "../logbook/window.js";
import { LOGBOOK_EXEMPT_KEYS, redactRows } from "../snapshot/redact.js";
import { byteLength, finalize, measureRowsBytes } from "../snapshot/ratio.js";

export interface LogbookQueryOptions {
  /** Defaults to `standard`. */
  detail?: LogbookDetailLevel;
  start?: string;
  end?: string;
  entities?: string[];
  timeouts?: Partial<Timeouts>;
  /** The time of the call, in epoch milliseconds. Defaults to the clock; tests pin it. */
  now?: number;
}

/**
 * The whole `ha_logbook_query` pipeline: configuration, connection, all-or-nothing retrieval,
 * selection, redaction, and encoding. Resolves with the minified document, or throws a
 * `ToolError`.
 */
export async function runLogbookQuery(
  env: Readonly<Record<string, string | undefined>>,
  options: LogbookQueryOptions = {},
): Promise<string> {
  const config = readConfig(env);
  // Everything that can be checked without the instance is checked before connecting.
  const now = options.now ?? Date.now();
  const parsedWindow = parseWindowInput({
    ...(options.start === undefined ? {} : { start: options.start }),
    ...(options.end === undefined ? {} : { end: options.end }),
  });
  const selectors = parseSelectors(options.entities);
  // Only `standard` is subject to the size limit (spec FR-019), so `summary`, the call the
  // `too_large` remediation suggests, never fails on a bad limit it would not use.
  const limit = options.detail === "summary" ? Infinity : readLogbookLimit(env);

  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    const context = await readContext(client);
    const window = resolveWindow(parsedWindow, now, context.timeZone);
    const how = strategy(selectors);
    const fetched = await fetchEvents(
      client,
      window.startIso,
      window.endIso,
      how === "exact" ? selectors : undefined,
    );
    // The instance returns chronological rows; a stable sort keeps that order and makes the
    // encoding's buckets safe if it ever did not.
    const selected = selectRows(fetched, selectors).sort(
      (a, b) => a.when - b.when,
    );
    // The raw size is measured on the data as returned; everything after this point is redacted.
    const rawBytes = measureRowsBytes(selected);
    const redacted = redactRows(selected, {
      token: config.token,
      exemptKeys: LOGBOOK_EXEMPT_KEYS,
      // The instance's own coordinates, so a message that spells them out is redacted (rule C3).
      coordinates: { latitude: context.latitude, longitude: context.longitude },
    });
    const encoding = {
      haVersion: context.haVersion,
      timeZone: context.timeZone,
      window,
      selectors,
      noEvents: selectors === undefined ? [] : noEvents(selectors, selected),
    };
    if (options.detail === "summary") {
      // Counts only: not subject to the size limit (spec FR-019).
      return finalize(encodeSummary(redacted, encoding), rawBytes);
    }
    const text = finalize(encodeStandard(redacted, encoding), rawBytes);
    // A result above the limit is an error, never a truncated result (spec FR-017, FR-019).
    const bytes = byteLength(text);
    if (bytes > limit) throw errors.tooLarge(selected.length, bytes, limit);
    return text;
  } finally {
    client.close();
  }
}
