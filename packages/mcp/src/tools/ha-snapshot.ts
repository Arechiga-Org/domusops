import type { DetailLevel } from "@domusops/schema";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig } from "../ha/config.js";
import { retrieve } from "../ha/retrieve.js";
import { encodeFull } from "../snapshot/encode-full.js";
import { encodeStandard } from "../snapshot/encode-standard.js";
import { encodeSummary } from "../snapshot/encode-summary.js";
import { project } from "../snapshot/project.js";
import { redact } from "../snapshot/redact.js";
import { finalize, measureRawBytes } from "../snapshot/ratio.js";

export interface RunOptions {
  /** Defaults to `standard`. */
  detail?: DetailLevel;
  timeouts?: Partial<Timeouts>;
}

/**
 * The whole `ha_snapshot` pipeline: configuration, connection, all-or-nothing retrieval, and
 * encoding. Resolves with the minified snapshot document, or throws a `SnapshotError`.
 */
export async function runSnapshot(
  env: Readonly<Record<string, string | undefined>>,
  options: RunOptions = {},
): Promise<string> {
  const config = readConfig(env);
  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    const retrieved = await retrieve(client);
    // The raw size is measured on the data as returned; everything after this point is redacted.
    const rawBytes = measureRawBytes(retrieved.records);
    const redacted = redact(retrieved.records, config.token);
    const detail = options.detail ?? "standard";
    const projected = project(redacted, { omit: detail !== "full" });
    const document =
      detail === "summary"
        ? encodeSummary(projected, retrieved.haVersion)
        : detail === "full"
          ? encodeFull(projected, retrieved.haVersion)
          : encodeStandard(projected, retrieved.haVersion);
    return finalize(document, rawBytes);
  } finally {
    client.close();
  }
}
