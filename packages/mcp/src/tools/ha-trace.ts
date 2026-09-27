import type { TraceDetailLevel, TraceExtendedRecord } from "@domusops/schema";
import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig, readTraceLimit } from "../ha/config.js";
import {
  getTraces,
  listTraces,
  readContexts,
  readItems,
  readTraceContext,
  type TraceRef,
} from "../ha/trace.js";
import { formatLocalIso } from "../logbook/local-time.js";
import { resolveWindow } from "../logbook/window.js";
import { byteLength, finalize, measureRowsBytes } from "../snapshot/ratio.js";
import { redactRows, TRACE_EXEMPT_KEYS } from "../snapshot/redact.js";
import {
  encodeStandard,
  type TraceEncodeContext,
} from "../trace/encode-standard.js";
import { resolveItems } from "../trace/items.js";
import { domainsFor, parseRequest, selectTraces } from "../trace/select.js";

export interface TraceOptions {
  /** Defaults to `standard`. */
  detail?: TraceDetailLevel;
  entities?: string[];
  start?: string;
  end?: string;
  run?: string;
  context?: string;
  timeouts?: Partial<Timeouts>;
  /** The time of the call, in epoch milliseconds. Defaults to the clock; tests pin it. */
  now?: number;
}

/**
 * The whole `ha_trace` pipeline: configuration, connection, all-or-nothing retrieval, selection,
 * redaction, and encoding. Resolves with the minified document, or throws a `ToolError`.
 */
export async function runTrace(
  env: Readonly<Record<string, string | undefined>>,
  options: TraceOptions = {},
): Promise<string> {
  const config = readConfig(env);
  // Everything that can be checked without the instance is checked before connecting.
  const now = options.now ?? Date.now();
  const request = parseRequest({
    entities: options.entities,
    start: options.start,
    end: options.end,
    run: options.run,
    context: options.context,
  });
  const limit = readTraceLimit(env);
  const detail = options.detail ?? "standard";

  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    const instance = await readTraceContext(client);
    const window =
      request.window === undefined
        ? null
        : resolveWindow(request.window, now, instance.timeZone);
    const items = resolveItems(await readItems(client));
    const domains = domainsFor(request);
    const short = domains.length === 0 ? [] : await listTraces(client, domains);
    const contexts =
      request.context !== undefined
        ? await readContexts(client)
        : new Map<string, never>();
    const selection = await selectTraces({
      request,
      items,
      short,
      contexts,
      window,
      fetch: (refs: TraceRef[]) => getTraces(client, refs),
    });

    // The extended records of everything selected, read before anything is emitted: a failure
    // gives no runs at all (spec FR-018).
    const missing = selection.shorts.filter(
      (record) => !selection.extended.has(record.run_id),
    );
    for (const record of await getTraces(
      client,
      missing.map((r): TraceRef => ({
        domain: r.domain as TraceRef["domain"],
        item_id: r.item_id,
        run_id: r.run_id,
      })),
    )) {
      selection.extended.set(record.run_id, record);
    }
    const records = selection.shorts.map(
      (record) => selection.extended.get(record.run_id) as TraceExtendedRecord,
    );

    // The raw size is measured on the data as returned; everything after this point is redacted.
    const rawBytes = measureRowsBytes(records);
    const redacted = redactRows(records, {
      token: config.token,
      exemptKeys: TRACE_EXEMPT_KEYS,
      coordinates: {
        latitude: instance.latitude,
        longitude: instance.longitude,
      },
    });
    const context: TraceEncodeContext = {
      haVersion: instance.haVersion,
      timeZone: instance.timeZone,
      nowMs: now,
      selection: {
        ...(request.selectors === undefined
          ? {}
          : { entities: request.selectors }),
        ...(window === null
          ? {}
          : {
              start: formatLocalIso(window.startMs, instance.timeZone, null),
              end: formatLocalIso(window.endMs, instance.timeZone, null),
            }),
        ...(request.run === undefined ? {} : { run: request.run }),
        ...(request.context === undefined ? {} : { context: request.context }),
      },
      items,
      noRuns: selection.noRuns,
    };
    if (detail === "summary") {
      throw errors.protocolError("the summary level is not built yet");
    }
    const text = finalize(encodeStandard(redacted, context), rawBytes);
    // A result above the limit is an error, never a truncated result (spec FR-018, FR-020).
    const bytes = byteLength(text);
    if (bytes > limit) {
      throw errors.tooLargeRuns(records.length, bytes, limit, "standard");
    }
    return text;
  } finally {
    client.close();
  }
}
