import { errors, SnapshotError } from "../errors.js";
import { isSupported, MIN_VERSION } from "./version.js";

/**
 * The only commands this client will ever send. Every one is a read (spec FR-018): anything else is
 * rejected before it reaches the socket, so mutation is structurally impossible.
 */
export const ALLOWED_COMMANDS = [
  "auth/current_user",
  "get_config",
  "get_states",
  "config/entity_registry/list",
  "config/device_registry/list",
  "config/area_registry/list",
  "config_entries/get",
] as const;

export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

export interface Timeouts {
  /** Connecting and authenticating. */
  connectMs: number;
  /** Each command. */
  commandMs: number;
  /** The whole call. */
  totalMs: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  connectMs: 10_000,
  commandMs: 10_000,
  totalMs: 30_000,
};

export interface ClientOptions {
  wsUrl: string;
  token: string;
  timeouts?: Partial<Timeouts>;
  minVersion?: string;
}

interface Pending {
  command: AllowedCommand;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isAllowed(type: string): type is AllowedCommand {
  return (ALLOWED_COMMANDS as readonly string[]).includes(type);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HaClient {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private failure: SnapshotError | null = null;

  private constructor(
    private readonly socket: WebSocket,
    private readonly wsUrl: string,
    private readonly timeouts: Timeouts,
    private readonly deadline: number,
    readonly haVersion: string,
  ) {}

  /** Connects, checks the version before sending the token, and authenticates. */
  static async connect(options: ClientOptions): Promise<HaClient> {
    const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    const started = Date.now();
    const deadline = started + timeouts.totalMs;
    const minVersion = options.minVersion ?? MIN_VERSION;
    const { wsUrl, token } = options;

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      throw errors.unreachable(wsUrl, describe(error));
    }

    return new Promise<HaClient>((resolve, reject) => {
      let settled = false;
      let phase = "connecting";
      let haVersion = "unknown";
      const fail = (error: SnapshotError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // The socket is already unusable; the error above is what matters.
        }
        reject(error);
      };
      const budget = Math.min(timeouts.connectMs, timeouts.totalMs);
      const timer = setTimeout(
        () => fail(errors.timeout(wsUrl, phase)),
        budget,
      );

      socket.addEventListener("error", () => {
        fail(errors.unreachable(wsUrl, "connection error"));
      });
      socket.addEventListener("close", () => {
        fail(
          errors.unreachable(wsUrl, "connection closed during the handshake"),
        );
      });
      socket.addEventListener("open", () => {
        phase = "authenticating";
      });
      socket.addEventListener("message", (event: MessageEvent) => {
        if (settled) return;
        let message: { type?: unknown; ha_version?: unknown };
        try {
          message = JSON.parse(String(event.data)) as typeof message;
        } catch {
          fail(errors.protocolError("a message that is not JSON"));
          return;
        }
        if (message.type === "auth_required") {
          if (typeof message.ha_version === "string")
            haVersion = message.ha_version;
          try {
            if (!isSupported(haVersion, minVersion)) {
              fail(errors.versionUnsupported(haVersion, minVersion));
              return;
            }
          } catch (error) {
            fail(
              error instanceof SnapshotError
                ? error
                : errors.protocolError(describe(error)),
            );
            return;
          }
          socket.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (message.type === "auth_ok") {
          settled = true;
          clearTimeout(timer);
          const client = new HaClient(
            socket,
            wsUrl,
            timeouts,
            deadline,
            haVersion,
          );
          client.attach();
          resolve(client);
        } else if (message.type === "auth_invalid") {
          fail(errors.authInvalid());
        } else {
          fail(
            errors.protocolError(
              `unexpected "${String(message.type)}" message during authentication`,
            ),
          );
        }
      });
    });
  }

  private attach(): void {
    this.socket.addEventListener("message", (event: MessageEvent) => {
      let message: {
        id?: unknown;
        type?: unknown;
        success?: unknown;
        result?: unknown;
        error?: unknown;
      };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        this.abort(
          errors.protocolError("a message that is not JSON", this.haVersion),
        );
        return;
      }
      if (message.type !== "result" || typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success === true) {
        pending.resolve(message.result);
      } else {
        const details = (message.error ?? {}) as {
          code?: unknown;
          message?: unknown;
        };
        const code =
          typeof details.code === "string" ? details.code : "unknown_error";
        const text =
          typeof details.message === "string" ? details.message : "no message";
        pending.reject(
          errors.retrievalFailed(pending.command, `${code}: ${text}`),
        );
      }
    });
    const onGone = (): void => {
      const alreadyClosed = this.closed;
      this.closed = true;
      if (!alreadyClosed) this.abort(null);
    };
    this.socket.addEventListener("close", onGone);
    this.socket.addEventListener("error", onGone);
  }

  /** Rejects every pending command; `error` null means the connection dropped. */
  private abort(error: SnapshotError | null): void {
    this.failure ??= error;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(
        error ??
          errors.retrievalFailed(
            pending.command,
            "the connection closed before a reply arrived",
          ),
      );
    }
  }

  /** Sends one allowlisted command and resolves with its `result`. */
  command(type: AllowedCommand): Promise<unknown> {
    if (!isAllowed(type)) {
      return Promise.reject(
        errors.protocolError(
          `command "${String(type)}" is not allowed`,
          this.haVersion,
        ),
      );
    }
    if (this.closed || this.failure !== null) {
      return Promise.reject(
        this.failure ??
          errors.retrievalFailed(type, "the connection is already closed"),
      );
    }
    const id = this.nextId++;
    const remaining = this.deadline - Date.now();
    const budget = Math.min(this.timeouts.commandMs, remaining);
    return new Promise<unknown>((resolve, reject) => {
      const overall = remaining <= this.timeouts.commandMs;
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            errors.timeout(
              this.wsUrl,
              overall
                ? `the ${type} retrieval (overall limit)`
                : `the ${type} retrieval`,
            ),
          );
        },
        Math.max(budget, 0),
      );
      this.pending.set(id, { command: type, resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, type }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(errors.retrievalFailed(type, describe(error)));
      }
    });
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
}
