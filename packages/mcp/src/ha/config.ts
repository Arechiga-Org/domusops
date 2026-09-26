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

export const LOGBOOK_LIMIT_VARIABLE = "DOMUSOPS_LOGBOOK_MAX_BYTES";
export const DEFAULT_LOGBOOK_LIMIT = 100_000;

/**
 * Size limit of a `standard` logbook result, in bytes (spec FR-019). Read on every invocation. It
 * is configuration only, never a tool parameter. An unset or empty variable means the default; any
 * other value must be a positive integer.
 */
export function readLogbookLimit(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env[LOGBOOK_LIMIT_VARIABLE]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_LOGBOOK_LIMIT;
  const limit = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw errors.configInvalidValue(
      LOGBOOK_LIMIT_VARIABLE,
      raw,
      "a positive whole number of bytes, for example 100000",
    );
  }
  return limit;
}
