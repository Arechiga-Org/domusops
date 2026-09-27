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

function readLimit(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  fallback: number,
): number {
  const raw = env[variable]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const limit = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw errors.configInvalidValue(
      variable,
      raw,
      "a positive whole number of bytes, for example 100000",
    );
  }
  return limit;
}

/**
 * Size limit of a `standard` logbook result, in bytes (spec FR-019). Read on every invocation. It
 * is configuration only, never a tool parameter. An unset or empty variable means the default; any
 * other value must be a positive integer.
 */
export function readLogbookLimit(
  env: Readonly<Record<string, string | undefined>>,
): number {
  return readLimit(env, LOGBOOK_LIMIT_VARIABLE, DEFAULT_LOGBOOK_LIMIT);
}

export const TRACE_LIMIT_VARIABLE = "DOMUSOPS_TRACE_MAX_BYTES";
export const DEFAULT_TRACE_LIMIT = 100_000;

/**
 * Size limit of a trace result at either detail level, in bytes (spec FR-020). Its own setting,
 * separate from the logbook limit. Read on every invocation; configuration only, never a tool
 * parameter.
 */
export function readTraceLimit(
  env: Readonly<Record<string, string | undefined>>,
): number {
  return readLimit(env, TRACE_LIMIT_VARIABLE, DEFAULT_TRACE_LIMIT);
}
