import type { HistoryDetailLevel } from "@domusops/schema";
import { errors } from "../errors.js";
import {
  characterCount,
  MAX_ATTRIBUTE_LENGTH,
  MAX_ENTRIES,
} from "../state/inputs.js";

export interface HistoryInputs {
  attributes?: string[];
  significantOnly: boolean;
  detail: HistoryDetailLevel;
}

/**
 * Validates the inputs besides `entities`, `exclude`, `start` and `end` before anything is read
 * (specs/011-ha-history research R4).
 */
export function parseHistoryInputs(input: {
  attributes?: readonly string[];
  significant_only?: boolean;
  detail?: HistoryDetailLevel;
}): HistoryInputs {
  const detail = input.detail ?? "standard";
  const attributes = parseAttributes(input.attributes);
  if (attributes !== undefined && detail === "summary") {
    throw errors.inputInvalid(
      "attributes cannot be combined with detail=summary, which carries no attributes",
      "history",
    );
  }
  if (detail !== "standard" && detail !== "summary") {
    throw errors.inputInvalid(
      `detail is "${String(detail)}", not summary or standard`,
      "history",
    );
  }
  const significantOnly = input.significant_only ?? false;
  if (typeof significantOnly !== "boolean") {
    throw errors.inputInvalid("significant_only is not a boolean", "history");
  }
  return {
    ...(attributes === undefined ? {} : { attributes }),
    significantOnly,
    detail,
  };
}

/**
 * 1 to 100 names of 1 to 128 characters, counted as the instance counts them; duplicates are
 * removed, keeping the first (research R4).
 */
function parseAttributes(
  list: readonly string[] | undefined,
): string[] | undefined {
  if (list === undefined) return undefined;
  const invalid = (problem: string): Error =>
    errors.inputInvalid(`attributes ${problem}`, "history");
  if (list.length === 0) throw invalid("is empty");
  if (list.length > MAX_ENTRIES) {
    throw invalid(
      `has ${list.length} entries, and the limit is ${MAX_ENTRIES}`,
    );
  }
  for (const entry of list) {
    const length = characterCount(entry);
    if (length === 0) throw invalid("has an empty entry");
    if (length > MAX_ATTRIBUTE_LENGTH) {
      throw invalid(
        `has an entry of ${length} characters, and the limit is ${MAX_ATTRIBUTE_LENGTH}`,
      );
    }
  }
  return [...new Set(list)];
}
