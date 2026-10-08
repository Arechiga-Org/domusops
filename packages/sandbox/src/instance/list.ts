import type { Runtime } from "../runtime/docker.js";
import { parseLabels, type Mode } from "../runtime/labels.js";

export interface SandboxListing {
  id: string;
  containerId: string;
  mode: Mode;
  release: string;
  /** `null` when the instance is not running. */
  url: string | null;
  deadline: string;
  owner: { host: string; pid: number } | null;
}

/** Every sandbox instance the runtime knows of: labelled containers only. */
export async function listSandboxes(
  runtime: Runtime,
): Promise<SandboxListing[]> {
  const listings: SandboxListing[] = [];
  for (const container of await runtime.list()) {
    const labels = parseLabels(container.labels);
    if (labels === null) continue;
    let url: string | null = null;
    if (container.running) {
      try {
        url = `http://127.0.0.1:${await runtime.hostPort(container.id, 8123)}`;
      } catch {
        // A container that is going away has no port to report.
      }
    }
    listings.push({
      id: labels.id,
      containerId: container.id,
      mode: labels.mode,
      release: labels.release,
      url,
      deadline: labels.deadline,
      owner: labels.owner,
    });
  }
  return listings;
}
