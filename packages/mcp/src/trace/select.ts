import {
  parseIsoMicros,
  type TraceDomain,
  type TraceExtendedRecord,
  type TraceShortRecord,
} from "@domusops/schema";
import { errors } from "../errors.js";
import type { ContextEntry, TraceRef } from "../ha/trace.js";
import { matches, parseSelectors } from "../logbook/selectors.js";
import {
  parseWindowInput,
  type ParsedWindow,
  type ResolvedWindow,
} from "../logbook/window.js";
import {
  contextTimeMs,
  parseContextId,
  parseRunId,
  sameContext,
} from "./context-id.js";
import type { ItemResolver } from "./items.js";

const DOMAINS: readonly TraceDomain[] = ["automation", "script"];

/** What the caller asked for, validated (research R14). */
export interface TraceRequest {
  selectors?: string[];
  run?: string;
  context?: string;
  /** Present only when `start` or `end` was given. */
  window?: ParsedWindow;
}

/**
 * Validates the selection without a connection: `run` and `context` each exclude every other
 * selection parameter, IDs and selectors have their forms, and the window's syntax is right.
 */
export function parseRequest(input: {
  entities?: string[] | undefined;
  start?: string | undefined;
  end?: string | undefined;
  run?: string | undefined;
  context?: string | undefined;
}): TraceRequest {
  const given = (
    [
      ["entities", input.entities],
      ["start", input.start],
      ["end", input.end],
      ["run", input.run],
      ["context", input.context],
    ] as const
  )
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  for (const exclusive of ["run", "context"] as const) {
    if (given.includes(exclusive) && given.length > 1) {
      throw errors.selectionInvalid(
        `${exclusive} cannot be combined with ${given
          .filter((name) => name !== exclusive)
          .join(", ")}`,
      );
    }
  }
  const request: TraceRequest = {};
  if (input.run !== undefined) request.run = parseRunId(input.run);
  if (input.context !== undefined) {
    request.context = parseContextId(input.context);
  }
  const selectors = parseSelectors(input.entities);
  if (selectors !== undefined) request.selectors = selectors;
  if (input.start !== undefined || input.end !== undefined) {
    request.window = parseWindowInput({
      ...(input.start === undefined ? {} : { start: input.start }),
      ...(input.end === undefined ? {} : { end: input.end }),
    });
  }
  return request;
}

function selectorDomains(selector: string): TraceDomain[] {
  const star = selector.indexOf("*");
  const prefix = star === -1 ? selector : selector.slice(0, star);
  const dot = prefix.indexOf(".");
  if (dot >= 0) {
    const domain = prefix.slice(0, dot);
    return DOMAINS.filter((d) => d === domain);
  }
  // No dot before the first `*`: an exact ID with no dot is no entity ID; a pattern may match
  // any domain whose name starts with what precedes the `*`.
  return star === -1 ? [] : DOMAINS.filter((d) => d.startsWith(prefix));
}

/** The domains whose traces a request can select, so `trace/list` is sent for those only. */
export function domainsFor(request: TraceRequest): TraceDomain[] {
  if (request.selectors === undefined) return [...DOMAINS];
  const wanted = new Set(request.selectors.flatMap(selectorDomains));
  return DOMAINS.filter((d) => wanted.has(d));
}

/** Selectors and items that produced no runs, with the reason (spec FR-004). */
export interface NoRuns {
  no_match?: string[];
  no_stored_runs?: string[];
  none_in_window?: string[];
  untraceable?: string[];
}

export interface SelectInput {
  request: TraceRequest;
  items: ItemResolver;
  /** The short records of every stored trace of the listed domains. */
  short: readonly TraceShortRecord[];
  contexts: ReadonlyMap<string, ContextEntry>;
  window: ResolvedWindow | null;
  /** Reads the extended records of the given traces (only the context lookup needs it here). */
  fetch: (refs: TraceRef[]) => Promise<TraceExtendedRecord[]>;
}

export interface Selection {
  shorts: TraceShortRecord[];
  /** Extended records already read while selecting, by run ID. */
  extended: Map<string, TraceExtendedRecord>;
  noRuns: NoRuns | null;
}

const startMicros = (record: TraceShortRecord): number =>
  parseIsoMicros(record.timestamp.start) as number;

const refOf = (record: TraceShortRecord): TraceRef => ({
  domain: record.domain as TraceDomain,
  item_id: record.item_id,
  run_id: record.run_id,
});

const byCodePoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Selects the traces a request asks for from what the instance stored (research R4, R14). */
export async function selectTraces(input: SelectInput): Promise<Selection> {
  const { request, items, short, contexts, window, fetch } = input;
  const extended = new Map<string, TraceExtendedRecord>();

  if (request.run !== undefined) {
    const found = short.find((record) => record.run_id === request.run);
    if (found === undefined) throw errors.runNotFound("run");
    return { shorts: [found], extended, noRuns: null };
  }

  if (request.context !== undefined) {
    const wanted = request.context;
    const entries = [...contexts]
      .filter(([id]) => sameContext(id, wanted))
      .map(([, entry]) => entry.run_id);
    if (entries.length === 0) throw errors.runNotFound("context");
    // The context map holds one trace per context. Reading it shows the context's full ID, and
    // so when it was created: no trace that started earlier can have run in it.
    const known = short.filter((record) => entries.includes(record.run_id));
    const firstRead = await fetch(known.map(refOf));
    for (const record of firstRead) extended.set(record.run_id, record);
    const created = firstRead
      .map((record) => contextTimeMs(record.context.id))
      .find((ms) => ms !== null);
    const rest = short.filter(
      (record) =>
        !extended.has(record.run_id) &&
        (created === undefined ||
          created === null ||
          startMicros(record) / 1000 >= created),
    );
    for (const record of await fetch(rest.map(refOf))) {
      extended.set(record.run_id, record);
    }
    const shorts = short.filter((record) => {
      const read = extended.get(record.run_id);
      return read !== undefined && sameContext(read.context.id, wanted);
    });
    if (shorts.length === 0) throw errors.runNotFound("context");
    return { shorts, extended, noRuns: null };
  }

  const inWindow = (record: TraceShortRecord): boolean =>
    window === null ||
    (startMicros(record) >= window.startMs * 1000 &&
      startMicros(record) <= window.endMs * 1000);

  const selectors = request.selectors;
  if (selectors === undefined) {
    return {
      shorts: short.filter(inWindow),
      extended,
      noRuns: null,
    };
  }

  const known = [...items.registered, ...items.untraceable];
  const keyOf = (record: TraceShortRecord): string =>
    items.keyOf(record.domain, record.item_id);
  const chosen = short.filter(
    (record) =>
      selectors.some((selector) => matches(selector, keyOf(record))) &&
      inWindow(record),
  );

  const matched = new Set<string>();
  const noMatch: string[] = [];
  for (const selector of selectors) {
    const hits = known.filter((id) => matches(selector, id));
    if (hits.length === 0) noMatch.push(selector);
    for (const id of hits) matched.add(id);
  }
  const selectedKeys = new Set(chosen.map(keyOf));
  const storedKeys = new Set(short.map(keyOf));
  const noStored: string[] = [];
  const noneInWindow: string[] = [];
  const untraceable: string[] = [];
  for (const id of [...matched].sort(byCodePoint)) {
    if (items.untraceable.has(id)) untraceable.push(id);
    else if (selectedKeys.has(id)) continue;
    else if (!storedKeys.has(id)) noStored.push(id);
    else noneInWindow.push(id);
  }
  const noRuns: NoRuns = {};
  if (noMatch.length > 0) noRuns.no_match = noMatch;
  if (noStored.length > 0) noRuns.no_stored_runs = noStored;
  if (noneInWindow.length > 0) noRuns.none_in_window = noneInWindow;
  if (untraceable.length > 0) noRuns.untraceable = untraceable;
  return {
    shorts: chosen,
    extended,
    noRuns: Object.keys(noRuns).length === 0 ? null : noRuns,
  };
}
