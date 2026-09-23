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
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export const TOKEN_VARIABLE = "DOMUSOPS_HA_TOKEN";
export const URL_VARIABLE = "DOMUSOPS_HA_URL";

/**
 * A failed `ha_snapshot` invocation (data-model §9). It carries a cause and a next step, and must
 * never be constructed with the access token in either.
 */
export class SnapshotError extends Error {
  readonly kind: ErrorKind;
  readonly causeText: string;
  readonly nextStep: string;

  constructor(kind: ErrorKind, cause: string, nextStep: string) {
    super(`${cause}. ${nextStep}.`);
    this.name = "SnapshotError";
    this.kind = kind;
    this.causeText = cause;
    this.nextStep = nextStep;
  }

  /** The text returned to the MCP client (contracts/ha_snapshot.md). */
  toToolText(): string {
    return `ha_snapshot failed [${this.kind}]: ${this.message}`;
  }
}

const TOKEN_HELP =
  "In Home Assistant open your profile, then Security, then Long-lived access tokens, and create a token";

export const errors = {
  configMissing(variable: string): SnapshotError {
    const help =
      variable === TOKEN_VARIABLE
        ? `Set ${variable} to a long-lived access token of an administrator user. ${TOKEN_HELP}`
        : `Set ${variable} to the address of your instance, for example http://homeassistant.local:8123`;
    return new SnapshotError(
      "config_missing",
      `The environment variable ${variable} is not set`,
      help,
    );
  },

  configInvalid(value: string): SnapshotError {
    return new SnapshotError(
      "config_invalid",
      `${URL_VARIABLE} is not a valid instance address (got "${value}")`,
      `Use the form http://host[:port] or https://host[:port], with no path`,
    );
  },

  unreachable(address: string, detail: string): SnapshotError {
    return new SnapshotError(
      "unreachable",
      `Could not connect to ${address} (${detail})`,
      "Check that the host and port are correct, that the instance is running, and that this machine can reach it",
    );
  },

  timeout(address: string, phase: string): SnapshotError {
    return new SnapshotError(
      "timeout",
      `Timed out waiting for ${address} during ${phase}`,
      "Check the network path to the instance and whether it is under heavy load, then try again",
    );
  },

  versionUnsupported(detected: string, minimum: string): SnapshotError {
    return new SnapshotError(
      "version_unsupported",
      `The instance runs Home Assistant ${detected}, and the minimum version is ${minimum}`,
      "Upgrade the instance to the minimum version or later",
    );
  },

  authInvalid(): SnapshotError {
    return new SnapshotError(
      "auth_invalid",
      "The instance rejected the access token",
      `Create a new long-lived access token and set ${TOKEN_VARIABLE} to it. ${TOKEN_HELP}`,
    );
  },

  notAdmin(): SnapshotError {
    return new SnapshotError(
      "not_admin",
      "The token belongs to a user without administrator privileges",
      `Use a token of an administrator user. A non-administrator user can receive a filtered set of entity states, which would make the snapshot silently incomplete`,
    );
  },

  retrievalFailed(retrieval: string, detail: string): SnapshotError {
    return new SnapshotError(
      "retrieval_failed",
      `The retrieval "${retrieval}" failed (${detail})`,
      "No snapshot was produced. Check the instance logs and try again",
    );
  },

  protocolError(detail: string, haVersion?: string): SnapshotError {
    const version =
      haVersion === undefined ? "" : ` (Home Assistant ${haVersion})`;
    return new SnapshotError(
      "protocol_error",
      `The instance sent an unexpected response: ${detail}${version}`,
      "This is likely a bug in ha_snapshot; report it including the Home Assistant version",
    );
  },
};
