import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig } from "../ha/config.js";
import { retrieve } from "../ha/retrieve.js";
import { encodeStandard } from "../snapshot/encode-standard.js";
import { project } from "../snapshot/project.js";
import { redact } from "../snapshot/redact.js";
import { finalize, measureRawBytes } from "../snapshot/ratio.js";

export interface RunOptions {
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
    const projected = project(redacted, { omit: true });
    const document = encodeStandard(projected, retrieved.haVersion);
    return finalize(document, rawBytes);
  } finally {
    client.close();
  }
}
