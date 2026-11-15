import type {
  SystemLogPart,
  SystemLogRecord,
  SystemLogStandardDocument,
} from "./format.js";

const WITH_OFFSET = /[+-]\d{2}:\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2})?$/;

/**
 * Reference decoder of the `standard` system log document (data-model §5, research R13). It returns
 * the entries in the document's order, each with its integration and where it came from, its
 * source file and line, its first and last occurrence in local ISO 8601 with their offset, its
 * messages, and its traceback text rebuilt from `parts` and the inline strings, joined by
 * newlines. Paths keep the `{ha}/`, `{config}/` and `{python}/` markers. A `summary` document has
 * no entries and is refused.
 */
export function expandSystemLog(
  document: SystemLogStandardDocument,
): SystemLogRecord[] {
  if ((document.detail as string) !== "standard") {
    throw new Error(
      `expandSystemLog decodes detail=standard documents, not detail=${String(document.detail)}`,
    );
  }
  const custom = new Set(document.custom ?? []);
  const withOffset = (text: string): string =>
    WITH_OFFSET.test(text) ? text : `${text}${document.utc_offset}`;
  const file = (index: number): string => {
    const path = document.files[index];
    if (path === undefined) throw new Error(`no file at index ${index}`);
    return path;
  };
  const partText = (part: SystemLogPart): string => {
    if (typeof part === "string") return part;
    const [at, line, fn, code] = part;
    const head = `  File "${file(at)}", line ${line}, in ${fn}`;
    return code === undefined ? head : `${head}\n${code}`;
  };
  const item = (value: number | string): string => {
    if (typeof value === "string") return value;
    const part = document.parts[value];
    if (part === undefined) throw new Error(`no part at index ${value}`);
    return partText(part);
  };

  const records: SystemLogRecord[] = [];
  for (const [date, rows] of Object.entries(document.entries)) {
    for (const row of rows) {
      const [time, level, logger, integration, source, count, messages] = row;
      const first = row[7] ?? null;
      const traceback = row[8] ?? null;
      const bySource = row[9] === 1;
      const last = withOffset(`${date}T${time}`);
      records.push({
        level,
        logger,
        integration,
        integration_from:
          integration === null ? null : bySource ? "source" : "logger",
        custom: integration !== null && custom.has(integration),
        source: { file: file(source[0]), line: source[1] },
        count,
        first_occurred:
          first === null
            ? last
            : TIME_ONLY.test(first)
              ? withOffset(`${date}T${first}`)
              : withOffset(first),
        last_occurred: last,
        messages: [...messages],
        traceback: traceback === null ? null : traceback.map(item).join("\n"),
      });
    }
  }
  return records;
}
