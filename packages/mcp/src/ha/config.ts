import { errors, TOKEN_VARIABLE, URL_VARIABLE } from "../errors.js";

export interface HaConfig {
  baseUrl: string;
  wsUrl: string;
  token: string;
}

/** Reads the instance address and token. Called on every invocation, never at startup. */
export function readConfig(
  env: Readonly<Record<string, string | undefined>>,
): HaConfig {
  const rawUrl = env[URL_VARIABLE]?.trim();
  if (!rawUrl) throw errors.configMissing(URL_VARIABLE);
  const token = env[TOKEN_VARIABLE]?.trim();
  if (!token) throw errors.configMissing(TOKEN_VARIABLE);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errors.configInvalid(rawUrl);
  }
  const validProtocol = url.protocol === "http:" || url.protocol === "https:";
  const bare =
    url.host !== "" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === "";
  if (!validProtocol || !bare) throw errors.configInvalid(rawUrl);

  const socketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    wsUrl: `${socketProtocol}//${url.host}/api/websocket`,
    token,
  };
}
