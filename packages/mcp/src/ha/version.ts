import { errors } from "../errors.js";

/**
 * Refusal threshold, not a support claim (constitution §8): below this version the tool refuses to
 * run. Which versions actually work is proven by the sandbox CI, not by this constant.
 */
export const MIN_VERSION = "2025.1.0";

type Triple = readonly [number, number, number];

/**
 * Parses `YEAR.MONTH.PATCH`. Beta (`2026.10.0b3`) and dev (`2026.10.0.dev20260915`) builds parse
 * as their base version.
 */
export function parseVersion(version: string): Triple | null {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?![\d])/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when `version` is at least the minimum. An unparseable version is a protocol error. */
export function isSupported(
  version: string,
  minimum: string = MIN_VERSION,
): boolean {
  const parsed = parseVersion(version);
  const floor = parseVersion(minimum);
  if (parsed === null || floor === null) {
    throw errors.protocolError(
      `unrecognised Home Assistant version "${version}"`,
    );
  }
  return compare(parsed, floor) >= 0;
}
