import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig } from "../ha/config.js";
import { readCore, readCurrentUser } from "../ha/instance.js";
import { packageVersion } from "../package-info.js";
import { encodePing } from "../ping/encode.js";
import { measureRowsBytes } from "../snapshot/ratio.js";

export interface PingOptions {
  timeouts?: Partial<Timeouts>;
}

/**
 * The whole `ha_ping` pipeline: configuration, one connection that accepts any version, the
 * current user and the core configuration, and the encoding. Of those two answers only the
 * administrator flag, the time zone and the loaded integrations are kept (research R1). Unlike
 * the other tools it does not refuse a user who is not an administrator: that is a finding.
 * Resolves with the minified document, or throws a `ToolError`.
 */
export async function runPing(
  env: Readonly<Record<string, string | undefined>>,
  options: PingOptions = {},
): Promise<string> {
  const config = readConfig(env);
  // An old instance is a finding of the document, not an error (research R3).
  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    minVersion: null,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    const user = await readCurrentUser(client);
    const core = await readCore(client);
    const { components, timeZone, haVersion } = core.instance;
    // A list that is not of names would show every integration as missing.
    const names = components.filter(
      (name): name is string => typeof name === "string",
    );
    if (names.length !== components.length) {
      throw errors.protocolError(
        "the core config lists a component that is not a name",
        haVersion,
      );
    }
    return encodePing({
      serverVersion: packageVersion(),
      instanceVersion: haVersion,
      timeZone,
      admin: user.isAdmin,
      components: names,
      rawBytes: measureRowsBytes([user.raw, core.raw]),
    });
  } finally {
    client.close();
  }
}
