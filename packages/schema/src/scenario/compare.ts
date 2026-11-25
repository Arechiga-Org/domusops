import { deepEqual } from "../util.js";
import type { Comparison, Json } from "./format.js";

export type CompareResult =
  { ok: true } | { ok: false; reason?: "not_a_number" };

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A double keeps 15 significant decimal digits exactly; a longer string would lose some. */
const MAX_SIGNIFICANT_DIGITS = 15;

function significantDigits(text: string): number {
  const mantissa = text.replace(/^[+-]/, "").split(/[eE]/)[0] ?? "";
  const digits = mantissa.replace(".", "").replace(/^0+/, "");
  return (mantissa.includes(".") ? digits.replace(/0+$/, "") : digits).length;
}

/**
 * The finite number a value is or reads as, else `null` (research R10). Text with more than 15
 * significant digits is not read as a number: it would lose digits, so two different long
 * identifiers could compare equal. It is compared as text instead.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    DECIMAL.test(value) &&
    significantDigits(value) <= MAX_SIGNIFICANT_DIGITS
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** Equality by research R10: one rule for states and attributes. */
function same(expected: Json, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (actual === null || actual === undefined) return false;
  const left = asNumber(expected);
  const right = asNumber(actual);
  if (left !== null && right !== null) return left === right;
  if (isScalar(expected) && isScalar(actual)) {
    return String(expected) === String(actual);
  }
  if (isScalar(expected) || isScalar(actual)) return false;
  return deepEqual(expected, actual);
}

/**
 * Compares an expected value with an actual one by the rule of research R10: `null` matches an
 * absent or null value; numbers, and text that reads as a finite decimal number, are compared as
 * numbers; anything else as text, booleans as `true` and `false`; lists and objects as JSON.
 * `at_least`, `at_most` and `between` need numbers on both sides and otherwise fail with
 * `not_a_number`.
 */
export function compareValue(
  expected: Comparison,
  actual: unknown,
): CompareResult {
  if ("eq" in expected) return same(expected.eq, actual) ? ok : miss;
  if ("not" in expected) return same(expected.not, actual) ? miss : ok;
  if ("in" in expected) {
    return expected.in.some((candidate) => same(candidate, actual)) ? ok : miss;
  }
  const value = asNumber(actual);
  if (value === null) return { ok: false, reason: "not_a_number" };
  if ("at_least" in expected) return value >= expected.at_least ? ok : miss;
  if ("at_most" in expected) return value <= expected.at_most ? ok : miss;
  const [low, high] = expected.between;
  return value >= low && value <= high ? ok : miss;
}

const ok: CompareResult = { ok: true };
const miss: CompareResult = { ok: false };
