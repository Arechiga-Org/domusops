import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig } from "../ha/config.js";
import { packageVersion } from "../package-info.js";
import { encodePing } from "../ping/encode.js";
import { measureRowsBytes } from "../snapshot/ratio.js";
import { isObject } from "../util/json.js";

export interface PingOptions {
  timeouts?: Partial<Timeouts>;
}

/**
 * The whole `ha_ping` pipeline: configuration, one connection that accepts any version, the
 * current user and the core configuration, and the encoding. Of those two answers only the
 * administrator flag, the time zone and the loaded integrations are kept (research R1). Resolves
 * with the minified document, or throws a `ToolError`.
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
    const haVersion = client.haVersion;
    const user = await client.command("auth/current_user");
    if (!isObject(user)) {
      throw errors.protocolError(
        "the current user was not an object",
        haVersion,
      );
    }
    const core = await client.command("get_config");
    if (!isObject(core)) {
      throw errors.protocolError(
        "the core config was not an object",
        haVersion,
      );
    }
    const timeZone = core["time_zone"];
    if (typeof timeZone !== "string" || timeZone === "") {
      throw errors.protocolError("the core config has no time zone", haVersion);
    }
    const components = core["components"];
    if (!Array.isArray(components)) {
      throw errors.protocolError(
        "the core config has no list of components",
        haVersion,
      );
    }
    return encodePing({
      serverVersion: packageVersion(),
      instanceVersion: haVersion,
      timeZone,
      admin: user["is_admin"] === true,
      components: components.filter(
        (name): name is string => typeof name === "string",
      ),
      rawBytes: measureRowsBytes([user, core]),
    });
  } finally {
    client.close();
  }
}
