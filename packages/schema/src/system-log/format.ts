/** System log format identifier. Every emitted document declares it (specs/012-ha-system-log FR-016). */
export const SYSTEM_LOG_FORMAT = "domusops.system_log/0.1" as const;

export const SYSTEM_LOG_DETAIL_LEVELS = ["summary", "standard"] as const;
export type SystemLogDetailLevel = (typeof SYSTEM_LOG_DETAIL_LEVELS)[number];

/** The levels the instance records, in severity order (research R1). */
export const SYSTEM_LOG_LEVELS = ["warning", "error", "critical"] as const;
export type SystemLogLevel = (typeof SYSTEM_LOG_LEVELS)[number];

export interface SystemLogEnvelope {
  format: typeof SYSTEM_LOG_FORMAT;
  detail: SystemLogDetailLevel;
  ha_version: string;
  compression_ratio: number;
  time_zone: string;
  /** `±HH:MM`, the offset at the time of the call; the default for every local time. */
  utc_offset: string;
  /** `integrations` as parsed, when given. */
  integrations?: string[];
  /** The minimum level, when given. */
  level?: SystemLogLevel;
  /** `start` as resolved, local ISO 8601 with offset, to the second, when given. */
  start?: string;
  /** The custom integrations named by the listed entries, in name order, when there are any. */
  custom?: string[];
}

/**
 * A frame of a traceback: `[file, line, function]`, or `[file, line, function, code]` with the
 * frame's indented lines below its `File` line, verbatim. `file` is an index into `files`.
 */
export type SystemLogFrame =
  [number, number, string] | [number, number, string, string];

/** A part: a frame, or a traceback line the document uses more than once (data-model §3). */
export type SystemLogPart = string | SystemLogFrame;

/**
 * One entry, positional, trailing `null` values dropped (data-model §3):
 * `[time, level, logger, integration, source, count, messages, first, traceback, by_source]`.
 * A traceback item is an index into `parts` or a string of lines that appear once.
 */
export type SystemLogEntryRow =
  | [
      string,
      SystemLogLevel,
      string,
      string | null,
      [number, number],
      number,
      string[],
    ]
  | [
      string,
      SystemLogLevel,
      string,
      string | null,
      [number, number],
      number,
      string[],
      string | null,
    ]
  | [
      string,
      SystemLogLevel,
      string,
      string | null,
      [number, number],
      number,
      string[],
      string | null,
      (number | string)[] | null,
    ]
  | [
      string,
      SystemLogLevel,
      string,
      string | null,
      [number, number],
      number,
      string[],
      string | null,
      (number | string)[] | null,
      1,
    ];

export interface SystemLogStandardDocument extends SystemLogEnvelope {
  detail: "standard";
  /** Paths of the sources and of the frames in `parts`, each once, in order of first use. */
  files: string[];
  /** Every distinct frame, and the traceback lines used more than once, in order of first use. */
  parts: SystemLogPart[];
  /** local date `YYYY-MM-DD` -> entries, in order of last occurrence. */
  entries: Record<string, SystemLogEntryRow[]>;
}

/** `[entries, occurrences]`. */
export type SystemLogCount = [number, number];

export interface SystemLogSummaryDocument extends SystemLogEnvelope {
  detail: "summary";
  counts: { entries: number; occurrences: number };
  /** domain -> level -> `[entries, occurrences]`, domains in name order, levels by severity. */
  by_integration: Record<
    string,
    Partial<Record<SystemLogLevel, SystemLogCount>>
  >;
  /** level -> `[entries, occurrences]` of the entries with no integration, when there are any. */
  without_integration?: Partial<Record<SystemLogLevel, SystemLogCount>>;
}

export type SystemLogDocument =
  SystemLogStandardDocument | SystemLogSummaryDocument;

/** One entry as `expandSystemLog` returns it (data-model §5). */
export interface SystemLogRecord {
  level: SystemLogLevel;
  logger: string;
  integration: string | null;
  /** Where the integration came from; `null` without an integration. */
  integration_from: "logger" | "source" | null;
  /** The integration is a custom one. */
  custom: boolean;
  source: { file: string; line: number };
  count: number;
  /** Local ISO 8601 with offset, to the second. */
  first_occurred: string;
  /** Local ISO 8601 with offset, to the second. */
  last_occurred: string;
  messages: string[];
  /** The traceback text, or `null` when the entry has none. */
  traceback: string | null;
}
