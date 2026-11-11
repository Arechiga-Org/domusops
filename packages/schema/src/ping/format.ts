/** Ping format identifier. Every emitted document declares it (specs/009-ha-ping FR-012). */
export const PING_FORMAT = "domusops.ping/0.1" as const;

/** What the instance is, as far as the server can work with it (data-model §1). */
export interface PingInstance {
  /** As the handshake gave it, beta and development suffixes included. */
  version: string;
  /** The least version the server supports. */
  minimum: string;
  supported: boolean;
  /** IANA name; the logbook and trace documents carry the same value. */
  time_zone: string;
}

/**
 * Why a tool is not ready: `version_unsupported`, `not_admin`, or `integration_missing:<name>`
 * with the integration's name (data-model §2).
 */
export type PingReason =
  "version_unsupported" | "not_admin" | `integration_missing:${string}`;

/** Whether one tool will work against the instance. */
export interface PingToolReadiness {
  ready: boolean;
  /** Present only when `ready` is false. */
  reasons?: PingReason[];
}

/**
 * The `ha_ping` document (data-model §1). `tools` and `integrations` are open: a reader ignores
 * names it does not know, since later tools add theirs without a new format version (FR-019).
 */
export interface PingDocument {
  format: typeof PING_FORMAT;
  server: { name: string; version: string };
  instance: PingInstance;
  admin: boolean;
  integrations: Record<string, boolean>;
  tools: Record<string, PingToolReadiness>;
  /** Present only when some tool is not ready. */
  next_steps?: string[];
  compression_ratio: number;
}
