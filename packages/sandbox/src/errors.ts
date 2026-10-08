export type SandboxErrorCode =
  | "runtime_missing"
  | "channel_unresolved"
  | "no_beta_in_progress"
  | "image_unavailable"
  | "not_ready"
  | "config_invalid"
  | "config_dir_invalid"
  | "virtual_unavailable"
  | "unsupported_device_kind"
  | "not_a_sandbox"
  | "instance_gone"
  | "time_control_failed";

// A long-lived access token is a JWT; a bearer header carries one. Both are scrubbed even when
// the caller did not name the secret.
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /(Bearer\s+)[^\s"']+/gi;

/** Removes every named secret and anything shaped like an access token from `text`. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out.replace(JWT, "[redacted]").replace(BEARER, "$1[redacted]");
}

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  /** The last 50 log lines of the instance; set for `not_ready` only. */
  readonly logs: string[] | undefined;

  constructor(
    code: SandboxErrorCode,
    message: string,
    options: { logs?: string[]; secrets?: readonly string[] } = {},
  ) {
    super(redact(message, options.secrets));
    this.name = "SandboxError";
    this.code = code;
    this.logs = options.logs?.map((line) => redact(line, options.secrets));
  }
}
