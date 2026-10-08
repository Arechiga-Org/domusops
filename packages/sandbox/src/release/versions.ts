export type Channel = "stable" | "previous-stable" | "beta";

export const CHANNEL_NAMES: readonly Channel[] = [
  "stable",
  "previous-stable",
  "beta",
];

export function isChannel(value: string): value is Channel {
  return (CHANNEL_NAMES as readonly string[]).includes(value);
}

/** `channel` is `exact` when the caller named the release. */
export interface ResolvedRelease {
  channel: Channel | "exact";
  release: string;
  beta: boolean;
}

export const RELEASE_RE = /^\d{4}\.\d{1,2}\.\d+(b\d+)?$/;

export interface ParsedRelease {
  year: number;
  month: number;
  patch: number;
  /** The `bN` number, or null for a final release. */
  beta: number | null;
}

export function parseRelease(release: string): ParsedRelease | null {
  if (!RELEASE_RE.test(release)) return null;
  const match = /^(\d{4})\.(\d{1,2})\.(\d+)(?:b(\d+))?$/.exec(release);
  if (match === null) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    patch: Number(match[3]),
    beta: match[4] === undefined ? null : Number(match[4]),
  };
}

/** Negative when `a` is older than `b`; a beta sorts before its final release. */
export function compareReleases(a: ParsedRelease, b: ParsedRelease): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

/** `YYYY.M` series ordering: negative when `a`'s month series is before `b`'s. */
export function compareSeries(a: ParsedRelease, b: ParsedRelease): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}
