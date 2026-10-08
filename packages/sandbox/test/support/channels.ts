export type TestChannel = "stable" | "previous-stable" | "beta";

const ALL: readonly TestChannel[] = ["stable", "previous-stable", "beta"];

function selected(): readonly TestChannel[] {
  const one = process.env["DOMUSOPS_SANDBOX_CHANNEL"];
  if (one === undefined || one === "") return ALL;
  const match = ALL.find((c) => c === one);
  if (match === undefined) {
    throw new Error(
      `DOMUSOPS_SANDBOX_CHANNEL must be one of ${ALL.join(", ")}; got "${one}"`,
    );
  }
  return [match];
}

/** The channels a container test runs on: one CI matrix leg, or all three locally. */
export const CHANNELS: readonly TestChannel[] = selected();

/**
 * What to start for `channel`. `DOMUSOPS_SANDBOX_RELEASE` pins an exact release instead, for runs
 * where only one image is available locally.
 */
export function startTarget(
  channel: TestChannel,
): { release: string } | { channel: TestChannel } {
  const release = process.env["DOMUSOPS_SANDBOX_RELEASE"];
  return release !== undefined && release !== "" ? { release } : { channel };
}
