import type { StateDetailLevel } from "@domusops/schema";
import { errors } from "../errors.js";

/** The most entries one list may carry. The advertised input schema uses the same number. */
export const MAX_ENTRIES = 100;
/** The longest state value, as the instance itself limits it. */
export const MAX_STATE_LENGTH = 255;
export const MAX_ATTRIBUTE_LENGTH = 128;
/** An entity domain. The advertised input schema uses the same expression. */
export const DOMAIN = /^[a-z0-9_]{1,64}$/;

/**
 * The length of `text` in characters (code points), as the instance counts a state's length, not
 * in UTF-16 units: a character outside the Basic Multilingual Plane, such as an emoji, counts once.
 */
export const characterCount = (text: string): number => [...text].length;

export interface StateInputs {
  domains?: string[];
  states?: string[];
  attributes?: string[];
  detail: StateDetailLevel;
}

/** Checks the list's size, each entry with `valid`, and removes duplicates, keeping the first. */
function parseList(
  list: readonly string[] | undefined,
  name: string,
  valid: (entry: string) => string | null,
): string[] | undefined {
  if (list === undefined) return undefined;
  if (list.length === 0) throw errors.inputInvalid(`${name} is empty`);
  if (list.length > MAX_ENTRIES) {
    throw errors.inputInvalid(
      `${name} has ${list.length} entries, and the limit is ${MAX_ENTRIES}`,
    );
  }
  for (const entry of list) {
    const problem = valid(entry);
    if (problem !== null) throw errors.inputInvalid(`${name} ${problem}`);
  }
  return [...new Set(list)];
}

const lengthBetween =
  (max: number) =>
  (entry: string): string | null => {
    const length = characterCount(entry);
    return length === 0
      ? "has an empty entry"
      : length > max
        ? `has an entry of ${length} characters, and the limit is ${max}`
        : null;
  };

/**
 * Validates `domain`, `state`, `attributes` and `detail` before anything is read
 * (specs/010-ha-state research R3). `entities` and `exclude` go through `parseSelectors`.
 */
export function parseStateInputs(input: {
  domain?: readonly string[];
  state?: readonly string[];
  attributes?: readonly string[];
  detail?: StateDetailLevel;
}): StateInputs {
  const detail = input.detail ?? "standard";
  const domains = parseList(input.domain, "domain", (entry) =>
    DOMAIN.test(entry)
      ? null
      : `has "${entry.slice(0, 80)}", which is not 1 to 64 characters of a-z, 0-9 and _`,
  );
  const states = parseList(
    input.state,
    "state",
    lengthBetween(MAX_STATE_LENGTH),
  );
  const attributes = parseList(
    input.attributes,
    "attributes",
    lengthBetween(MAX_ATTRIBUTE_LENGTH),
  );
  if (attributes !== undefined && detail === "summary") {
    throw errors.inputInvalid(
      "attributes cannot be combined with detail=summary, which carries no attributes",
    );
  }
  return {
    ...(domains === undefined ? {} : { domains }),
    ...(states === undefined ? {} : { states }),
    ...(attributes === undefined ? {} : { attributes }),
    detail,
  };
}
