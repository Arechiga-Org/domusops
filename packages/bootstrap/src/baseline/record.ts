import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256 } from "./templates.js";

/** The generation record's own format id (data-model §2). */
export const RECORD_FORMAT = "domusops.bootstrap/0.1";

export const RECORD_PATH = ".domusops/generated.json";

export interface RecordEntry {
  path: string;
  sha256: string;
  release: string;
}

export interface GenerationRecord {
  format: typeof RECORD_FORMAT;
  release: string;
  elements: Record<string, RecordEntry>;
}

function isRecordEntry(value: unknown): value is RecordEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["path"] === "string" &&
    typeof v["sha256"] === "string" &&
    typeof v["release"] === "string"
  );
}

/**
 * Reads `.domusops/generated.json`. Returns `null` on a missing file, invalid JSON, an
 * unexpected `format`, or any malformed entry — the record is then unusable as a whole (spec
 * FR-029), and every differing skill-owned element is treated as edited by `elementState` below.
 */
export function readRecord(dir: string): GenerationRecord | null {
  const path = join(dir, RECORD_PATH);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["format"] !== RECORD_FORMAT) return null;
  if (typeof record["release"] !== "string") return null;
  const elements = record["elements"];
  if (typeof elements !== "object" || elements === null) return null;
  for (const value of Object.values(elements as Record<string, unknown>)) {
    if (!isRecordEntry(value)) return null;
  }
  return {
    format: RECORD_FORMAT,
    release: record["release"],
    elements: elements as Record<string, RecordEntry>,
  };
}

/** Pretty-printed, sorted keys, trailing newline: a re-run with nothing to do writes identical bytes. */
export function writeRecord(dir: string, record: GenerationRecord): void {
  const sortedElements: Record<string, RecordEntry> = {};
  for (const key of Object.keys(record.elements).sort()) {
    const entry = record.elements[key];
    if (entry !== undefined) sortedElements[key] = entry;
  }
  const sorted: GenerationRecord = {
    format: record.format,
    release: record.release,
    elements: sortedElements,
  };
  const path = join(dir, RECORD_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

/**
 * A subset of `elements.ts`'s `ElementState`: `elementState` below never returns `"blocked"`
 * (that state only arises from an element-scope stop check, outside the record's concern).
 */
export type RecordState = "missing" | "current" | "outdated" | "edited";

/**
 * Data-model §1.1: `missing` when the file is absent; otherwise, with no usable record entry for
 * this element, `current` when its content matches the current template and `edited` when it
 * does not; with a record entry, `outdated` when the content's hash matches the recorded hash but
 * the current template has changed, and `edited` whenever the content's hash no longer matches
 * the recorded hash at all.
 */
export function elementState(
  entry: RecordEntry | undefined,
  currentTemplate: string,
  actualContent: string | null,
): RecordState {
  if (actualContent === null) return "missing";
  const actualHash = sha256(actualContent);
  if (entry === undefined) {
    return actualHash === sha256(currentTemplate) ? "current" : "edited";
  }
  if (actualHash !== entry.sha256) return "edited";
  return actualHash === sha256(currentTemplate) ? "current" : "outdated";
}
