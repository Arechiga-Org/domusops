import { SandboxError } from "../errors.js";
import {
  RELEASE_RE,
  compareReleases,
  compareSeries,
  parseRelease,
  type Channel,
  type ParsedRelease,
  type ResolvedRelease,
} from "./versions.js";

export const PACKAGE_INDEX_URL = "https://pypi.org/pypi/homeassistant/json";

export interface ResolveOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface IndexDocument {
  releases?: Record<string, { yanked?: boolean }[] | undefined>;
}

async function fetchReleases(options: ResolveOptions): Promise<ParsedEntry[]> {
  const doFetch = options.fetch ?? fetch;
  let document: IndexDocument;
  try {
    const response = await doFetch(PACKAGE_INDEX_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response.ok) {
      throw new Error(`the package index answered ${response.status}`);
    }
    document = (await response.json()) as IndexDocument;
  } catch (error) {
    throw new SandboxError(
      "channel_unresolved",
      `Could not read the list of Home Assistant releases: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (typeof document.releases !== "object" || document.releases === null) {
    throw new SandboxError(
      "channel_unresolved",
      "The package index answered without a list of releases.",
    );
  }
  const entries: ParsedEntry[] = [];
  for (const [release, files] of Object.entries(document.releases)) {
    const parsed = parseRelease(release);
    if (parsed === null) continue;
    // A release with no files, or only yanked ones, cannot be installed or imaged.
    if (!Array.isArray(files) || files.every((file) => file.yanked === true)) {
      continue;
    }
    entries.push({ release, parsed });
  }
  return entries;
}

interface ParsedEntry {
  release: string;
  parsed: ParsedRelease;
}

function newest(entries: ParsedEntry[]): ParsedEntry | undefined {
  let best: ParsedEntry | undefined;
  for (const entry of entries) {
    if (best === undefined || compareReleases(entry.parsed, best.parsed) > 0) {
      best = entry;
    }
  }
  return best;
}

/** Turns a channel into a concrete release, from the package index's list of releases. */
export async function resolveChannel(
  channel: Channel,
  options: ResolveOptions = {},
): Promise<ResolvedRelease> {
  const entries = await fetchReleases(options);
  const finals = entries.filter((entry) => entry.parsed.beta === null);
  const stable = newest(finals);
  if (stable === undefined) {
    throw new SandboxError(
      "channel_unresolved",
      "The package index lists no stable Home Assistant release.",
    );
  }

  if (channel === "stable") {
    return { channel, release: stable.release, beta: false };
  }

  if (channel === "previous-stable") {
    const previous = newest(
      finals.filter((entry) => compareSeries(entry.parsed, stable.parsed) < 0),
    );
    if (previous === undefined) {
      throw new SandboxError(
        "channel_unresolved",
        "The package index lists no stable release before the current one.",
      );
    }
    return { channel, release: previous.release, beta: false };
  }

  const beta = newest(entries.filter((entry) => entry.parsed.beta !== null));
  if (beta === undefined || compareReleases(beta.parsed, stable.parsed) <= 0) {
    throw new SandboxError(
      "no_beta_in_progress",
      `No beta is in progress: the newest release, ${stable.release}, is a stable one.`,
    );
  }
  return { channel, release: beta.release, beta: true };
}

/** A release the caller named. Rejects anything that is not a release string. */
export function exactRelease(release: string): ResolvedRelease {
  if (!RELEASE_RE.test(release)) {
    throw new TypeError(
      `"${release}" is not a Home Assistant release such as 2026.10.1 or 2026.11.0b2.`,
    );
  }
  return {
    channel: "exact",
    release,
    beta: parseRelease(release)?.beta !== null,
  };
}
