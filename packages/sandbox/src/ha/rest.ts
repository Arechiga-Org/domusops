/** An HTTP exchange with the instance that did not return a usable answer. */
export class HttpError extends Error {
  readonly status: number;
  constructor(method: string, path: string, status: number, detail: string) {
    super(`${method} ${path} answered ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface RequestOptions {
  token?: string;
  timeoutMs?: number;
}

type Body = { json: unknown } | { form: Record<string, string> } | undefined;

async function send(
  method: "GET" | "POST",
  baseUrl: string,
  path: string,
  body: Body,
  options: RequestOptions,
): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token !== undefined) {
    headers["authorization"] = `Bearer ${options.token}`;
  }
  let payload: string | undefined;
  if (body !== undefined && "json" in body) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body !== undefined) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body.form).toString();
  }
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  };
  if (payload !== undefined) init.body = payload;
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  if (!response.ok) {
    // The reply body can echo request fields; keep only a short slice, never the request.
    throw new HttpError(method, path, response.status, text.slice(0, 200));
  }
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<unknown> {
  return send("POST", baseUrl, path, { json: body }, options);
}

export function postForm(
  baseUrl: string,
  path: string,
  form: Record<string, string>,
  options: RequestOptions = {},
): Promise<unknown> {
  return send("POST", baseUrl, path, { form }, options);
}

export function getJson(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return send("GET", baseUrl, path, undefined, options);
}
