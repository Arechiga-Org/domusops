import { LABEL_OWNER_PID } from "../../src/runtime/labels.js";
import type { Runtime } from "../../src/runtime/docker.js";

/**
 * The containers this process owns that did not exist in `before`. Test files run side by side,
 * each in its own process, so another file's containers must not count as a leak.
 */
export async function leftBehind(
  runtime: Runtime,
  before: readonly { id: string }[],
): Promise<string[]> {
  const known = new Set(before.map((container) => container.id));
  return (await runtime.list())
    .filter(
      (container) =>
        !known.has(container.id) &&
        container.labels[LABEL_OWNER_PID] === String(process.pid),
    )
    .map((container) => container.id);
}
