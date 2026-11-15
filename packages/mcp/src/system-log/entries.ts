import { SYSTEM_LOG_LEVELS, type SystemLogLevel } from "@domusops/schema";
import type { RawLogEntry } from "../ha/system-log.js";
import { exclusion, matcher } from "../logbook/selectors.js";

/** The integration an entry belongs to, and where it was found (research R3). */
export interface Attribution {
  domain: string;
  custom: boolean;
  /** The logger names no integration; the source path gave it. */
  bySource: boolean;
}

/** A raw entry with its level and integration. */
export interface LogEntry {
  raw: RawLogEntry;
  level: SystemLogLevel;
  integration: Attribution | null;
}

/** An entry ready to encode: messages, traceback and an absolute source re-rooted and redacted. */
export interface PreparedEntry extends LogEntry {
  messages: string[];
  /** The traceback text, `null` when the entry has none. */
  traceback: string | null;
  sourcePath: string;
}

/** `homeassistant.components.<domain>` or `custom_components.<domain>`, then a dot or the end. */
const LOGGER =
  /^(homeassistant\.components|custom_components)\.([^.]+)(?:\.|$)/;
/**
 * A source path that begins with `components/<domain>/` or `custom_components/<domain>/`. Matched
 * at the start, so the first form is never found inside the second.
 */
const SOURCE = /^(components|custom_components)\/([^/]+)\//;

/**
 * The integration of an entry: from its logger, or, when the logger names none, from its source
 * path; `null` when neither gives one (research R3). Helpers and the core keep no integration.
 */
export function integrationOf(
  entry: Pick<RawLogEntry, "name" | "source">,
): Attribution | null {
  const logger = LOGGER.exec(entry.name);
  if (logger !== null) {
    return {
      domain: logger[2] as string,
      custom: logger[1] === "custom_components",
      bySource: false,
    };
  }
  const source = SOURCE.exec(entry.source[0]);
  if (source !== null) {
    return {
      domain: source[2] as string,
      custom: source[1] === "custom_components",
      bySource: true,
    };
  }
  return null;
}

const severity = (level: SystemLogLevel): number =>
  SYSTEM_LOG_LEVELS.indexOf(level);

export function classify(raw: RawLogEntry): LogEntry {
  return {
    raw,
    level: raw.level.toLowerCase() as SystemLogLevel,
    integration: integrationOf(raw),
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Last occurrence, oldest first, then logger, then source path and line (research R5). */
export function byOccurrence(a: LogEntry, b: LogEntry): number {
  return (
    a.raw.timestamp - b.raw.timestamp ||
    compare(a.raw.name, b.raw.name) ||
    compare(a.raw.source[0], b.raw.source[0]) ||
    a.raw.source[1] - b.raw.source[1]
  );
}

/**
 * The entries that pass every filter, in the order of research R5 (research R4). With
 * `integrations`, an entry without an integration is left out; `exclude` never removes one. An
 * entry is kept for `start` when its last occurrence, to the second, is at or after it.
 */
export function selectEntries(
  entries: readonly LogEntry[],
  filters: {
    integrations?: readonly string[];
    exclude?: readonly string[];
    level?: SystemLogLevel;
    startMs?: number;
  },
): LogEntry[] {
  const included =
    filters.integrations === undefined ? null : matcher(filters.integrations);
  const excluded = exclusion(filters.exclude);
  const minimum = filters.level === undefined ? 0 : severity(filters.level);
  return entries
    .filter((entry) => {
      const domain = entry.integration?.domain;
      if (included !== null && (domain === undefined || !included(domain))) {
        return false;
      }
      if (domain !== undefined && excluded(domain)) return false;
      if (severity(entry.level) < minimum) return false;
      if (
        filters.startMs !== undefined &&
        Math.floor(entry.raw.timestamp) * 1000 < filters.startMs
      ) {
        return false;
      }
      return true;
    })
    .sort(byOccurrence);
}

/**
 * Applies the root markers, then the redaction rules, to every message and to the traceback, and
 * the root markers to an absolute source path (research R7, R8). File paths and line numbers are
 * never redacted.
 */
export function prepareEntry(
  entry: LogEntry,
  roots: (text: string) => string,
  redact: (text: string) => string,
): PreparedEntry {
  const { raw } = entry;
  return {
    ...entry,
    messages: raw.message.map((message) => redact(roots(message))),
    traceback: raw.exception === "" ? null : redact(roots(raw.exception)),
    sourcePath: raw.source[0].startsWith("/")
      ? roots(raw.source[0])
      : raw.source[0],
  };
}

/** The custom integrations the entries name, in name order (research R6). */
export function customIntegrations(entries: readonly LogEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.integration?.custom === true) names.add(entry.integration.domain);
  }
  return [...names].sort(compare);
}
