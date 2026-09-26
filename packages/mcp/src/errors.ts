export const ERROR_KINDS = [
  "config_missing",
  "config_invalid",
  "unreachable",
  "timeout",
  "version_unsupported",
  "auth_invalid",
  "not_admin",
  "retrieval_failed",
  "protocol_error",
  "window_invalid",
  "selector_invalid",
  "history_unavailable",
  "too_large",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export const TOKEN_VARIABLE = "DOMUSOPS_HA_TOKEN";
export const URL_VARIABLE = "DOMUSOPS_HA_URL";

/**
 * A failed tool invocation (`ha_snapshot` data-model §9, `ha_logbook_query` data-model §8). It
 * carries a cause and a next step, and must never be constructed with the access token in either.
 * The tool that failed is named only when the text is rendered, so both tools share the errors.
 */
export class ToolError extends Error {
  readonly kind: ErrorKind;
  readonly causeText: string;
  readonly nextStep: string;

  constructor(kind: ErrorKind, cause: string, nextStep: string) {
    super(`${cause}. ${nextStep}.`);
    this.name = "ToolError";
    this.kind = kind;
    this.causeText = cause;
    this.nextStep = nextStep;
  }

  /** The text returned to the MCP client (contracts/ha_snapshot.md, contracts/ha_logbook_query.md). */
  toToolText(tool: string): string {
    return `${tool} failed [${this.kind}]: ${this.message}`;
  }
}

const TOKEN_HELP =
  "In Home Assistant open your profile, then Security, then Long-lived access tokens, and create a token";

export const errors = {
  configMissing(variable: string): ToolError {
    const help =
      variable === TOKEN_VARIABLE
        ? `Set ${variable} to a long-lived access token of an administrator user. ${TOKEN_HELP}`
        : `Set ${variable} to the address of your instance, for example http://homeassistant.local:8123`;
    return new ToolError(
      "config_missing",
      `The environment variable ${variable} is not set`,
      help,
    );
  },

  configInvalid(value: string): ToolError {
    return new ToolError(
      "config_invalid",
      `${URL_VARIABLE} is not a valid instance address (got "${value}")`,
      `Use the form http://host[:port] or https://host[:port], with no path`,
    );
  },

  configInvalidValue(
    variable: string,
    value: string,
    expected: string,
  ): ToolError {
    return new ToolError(
      "config_invalid",
      `${variable} is not valid (got "${value}")`,
      `Set ${variable} to ${expected}`,
    );
  },

  unreachable(address: string, detail: string): ToolError {
    return new ToolError(
      "unreachable",
      `Could not connect to ${address} (${detail})`,
      "Check that the host and port are correct, that the instance is running, and that this machine can reach it",
    );
  },

  timeout(address: string, phase: string, nextStep?: string): ToolError {
    return new ToolError(
      "timeout",
      `Timed out waiting for ${address} during ${phase}`,
      nextStep ??
        "Check the network path to the instance and whether it is under heavy load, then try again",
    );
  },

  versionUnsupported(detected: string, minimum: string): ToolError {
    return new ToolError(
      "version_unsupported",
      `The instance runs Home Assistant ${detected}, and the minimum version is ${minimum}`,
      "Upgrade the instance to the minimum version or later",
    );
  },

  authInvalid(): ToolError {
    return new ToolError(
      "auth_invalid",
      "The instance rejected the access token",
      `Create a new long-lived access token and set ${TOKEN_VARIABLE} to it. ${TOKEN_HELP}`,
    );
  },

  notAdmin(): ToolError {
    return new ToolError(
      "not_admin",
      "The token belongs to a user without administrator privileges",
      `Use a token of an administrator user. A non-administrator user can receive a filtered set of entity states, which would make the snapshot silently incomplete`,
    );
  },

  retrievalFailed(retrieval: string, detail: string): ToolError {
    return new ToolError(
      "retrieval_failed",
      `The retrieval "${retrieval}" failed (${detail})`,
      "No snapshot was produced. Check the instance logs and try again",
    );
  },

  protocolError(detail: string, haVersion?: string): ToolError {
    const version =
      haVersion === undefined ? "" : ` (Home Assistant ${haVersion})`;
    return new ToolError(
      "protocol_error",
      `The instance sent an unexpected response: ${detail}${version}`,
      "This is likely a bug in the DomusOps server; report it including the Home Assistant version",
    );
  },

  windowInvalid(problem: string): ToolError {
    return new ToolError(
      "window_invalid",
      `The time window is not valid: ${problem}`,
      "Use ISO 8601 timestamps such as 2026-09-26T03:00 or 2026-09-26T03:00:00-06:00 (without an offset the instance's time zone applies), with the end after the start and the start not in the future",
    );
  },

  selectorInvalid(selector: string): ToolError {
    return new ToolError(
      "selector_invalid",
      `The entity selector "${selector}" is not valid`,
      "Use an entity ID or a pattern made of lowercase letters, digits, underscores, dots, and * (for example light.hallway, light.*, or *_motion)",
    );
  },

  historyUnavailable(): ToolError {
    return new ToolError(
      "history_unavailable",
      "The instance does not provide logbook history",
      "Enable the logbook and recorder integrations in Home Assistant (both are part of default_config), then try again",
    );
  },

  tooLarge(events: number, bytes: number, limit: number): ToolError {
    return new ToolError(
      "too_large",
      `The result has ${events} events and would be ${bytes} bytes, above the limit of ${limit} bytes`,
      "Use detail=summary to see where the activity is, or narrow the query with a shorter window or fewer entities; to allow larger results, raise DOMUSOPS_LOGBOOK_MAX_BYTES",
    );
  },
};
