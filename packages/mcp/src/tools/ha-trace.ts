import type {
  TraceDetailLevel,
  TraceExtendedRecord,
  TraceShortRecord,
} from "@domusops/schema";
import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig, readTraceLimit } from "../ha/config.js";
import {
  getTraces,
  listTraces,
  MAX_IN_FLIGHT,
  readContexts,
  readItems,
  readTraceContext,
  refOf,
  type ContextEntry,
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
import { encodeSummary } from "../trace/encode-summary.js";
import { sizeFloor } from "../trace/size.js";
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
 * Starts two reads together and settles them in the order they are listed: when both fail, the
 * first one's error is the one reported, whichever failed first, so which error an agent sees does
 * not depend on timing.
 */
async function together<A, B>(a: Promise<A>, b: Promise<B>): Promise<[A, B]> {
  a.catch(() => undefined);
  b.catch(() => undefined);
  return [await a, await b];
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
    // The instance check comes first, so a user who is not an administrator, or an instance
    // without traces, never gets a trace command. The registry read does not depend on it.
    const [instance, known] = await together(
      readTraceContext(client),
      readItems(client),
    );
    const window =
      request.window === undefined
        ? null
        : resolveWindow(request.window, now, instance.timeZone);
    const items = resolveItems(known);
    const domains = domainsFor(request);
    const [short, contexts] = await together(
      domains.length === 0
        ? Promise.resolve<TraceShortRecord[]>([])
        : listTraces(client, domains),
      request.context !== undefined || detail === "summary"
        ? readContexts(client)
        : Promise.resolve(new Map<string, ContextEntry>()),
    );
    const selection = await selectTraces({
      request,
      items,
      short,
      contexts,
      window,
      fetch: (refs: TraceRef[]) => getTraces(client, refs),
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
    const redaction = {
      token: config.token,
      exemptKeys: TRACE_EXEMPT_KEYS,
      scanExempt: true,
      coordinates: {
        latitude: instance.latitude,
        longitude: instance.longitude,
      },
    };
    // Everything a result needs is read before anything is emitted: a failure gives no runs at
    // all (spec FR-018).
    const readMissing = async (records: TraceShortRecord[]): Promise<void> => {
      const missing = records.filter((r) => !selection.extended.has(r.run_id));
      for (const record of await getTraces(client, missing.map(refOf))) {
        selection.extended.set(record.run_id, record);
      }
    };
    // The runs are read in growing chunks. As soon as the runs read so far already encode above the
    // limit, the result cannot fit and the runs still unread are not read (spec 007 FR-004,
    // research R4). Each run is redacted once, as it is read.
    const readStandard = async (
      shorts: readonly TraceShortRecord[],
    ): Promise<{
      records: TraceExtendedRecord[];
      redacted: TraceExtendedRecord[];
    }> => {
      const records: TraceExtendedRecord[] = [];
      const redacted: TraceExtendedRecord[] = [];
      let from = 0;
      let chunk = MAX_IN_FLIGHT;
      while (from < shorts.length) {
        const slice = shorts.slice(from, from + chunk);
        await readMissing(slice);
        const read = slice.map(
          (record) =>
            selection.extended.get(record.run_id) as TraceExtendedRecord,
        );
        records.push(...read);
        redacted.push(...redactRows(read, redaction));
        from += chunk;
        chunk *= 2;
        if (from < shorts.length) {
          const floor = sizeFloor(encodeStandard(redacted, context));
          if (floor > limit) {
            throw errors.tooLargeRuns(
              shorts.length,
              floor,
              limit,
              detail,
              true,
            );
          }
        }
      }
      return { records, redacted };
    };
    let text: string;
    if (detail === "summary") {
      // The context of a run comes from the context map when it points at that run, and from the
      // run's extended record otherwise (research R4). Both are raw data the ratio measures.
      const contextOfRun = new Map<string, string>();
      for (const [id, entry] of contexts) contextOfRun.set(entry.run_id, id);
      await readMissing(
        selection.shorts.filter((r) => !contextOfRun.has(r.run_id)),
      );
      const suppliers: unknown[] = [];
      const runs = selection.shorts.map((record) => {
        const extended = selection.extended.get(record.run_id);
        if (extended !== undefined) suppliers.push(extended);
        const mapped = contextOfRun.get(record.run_id);
        if (extended === undefined && mapped !== undefined) {
          suppliers.push({ [mapped]: contexts.get(mapped) });
        }
        return {
          record,
          contextId: extended?.context.id ?? (mapped as string),
        };
      });
      const rawBytes =
        measureRowsBytes(selection.shorts) + measureRowsBytes(suppliers);
      const redacted = redactRows(selection.shorts, redaction);
      text = finalize(
        encodeSummary(
          runs.map((r, at) => ({
            record: redacted[at] as TraceShortRecord,
            contextId: r.contextId,
          })),
          context,
        ),
        rawBytes,
      );
    } else {
      const { records, redacted } = await readStandard(selection.shorts);
      // The raw size is measured on the data as returned; everything after this point is
      // redacted.
      const rawBytes = measureRowsBytes(records);
      text = finalize(encodeStandard(redacted, context), rawBytes);
    }
    // A result above the limit is an error, never a truncated result (spec FR-018, FR-020).
    const bytes = byteLength(text);
    if (bytes > limit) {
      throw errors.tooLargeRuns(selection.shorts.length, bytes, limit, detail);
    }
    return text;
  } finally {
    client.close();
  }
}
