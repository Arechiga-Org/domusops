import { errors, ToolError } from "../errors.js";
import { isSupported, MIN_VERSION } from "./version.js";

/** What the client knows about one command it may send. */
interface CommandSpec {
  /**
   * The only parameter keys the command may carry, `null` when it is sent bare. A command with
   * parameters must carry every required key, and only those: no caller can smuggle anything else
   * onto the socket.
   */
  params: {
    required: readonly string[];
    optional: readonly string[];
  } | null;
  /**
   * `overall`: the command may use the whole remaining budget, because its duration grows with the
   * window it reads. `command`: it keeps the per-command limit.
   */
  budget: "command" | "overall";
  /** What to try when the command times out at the overall limit. */
  timeoutHint?: string;
}

/**
 * The only commands this client will ever send. Every one is a read (spec FR-018): anything else is
 * rejected before it reaches the socket, so mutation is structurally impossible.
 */
const COMMANDS = {
  "auth/current_user": { params: null, budget: "command" },
  get_config: { params: null, budget: "command" },
  get_states: { params: null, budget: "command" },
  "config/entity_registry/list": { params: null, budget: "command" },
  "config/device_registry/list": { params: null, budget: "command" },
  "config/area_registry/list": { params: null, budget: "command" },
  "config_entries/get": { params: null, budget: "command" },
  "logbook/get_events": {
    params: { required: ["start_time", "end_time"], optional: ["entity_ids"] },
    budget: "overall",
    timeoutHint: "Use a shorter window or fewer entities, then try again",
  },
  "trace/list": {
    params: { required: ["domain"], optional: [] },
    budget: "command",
  },
  "trace/get": {
    params: { required: ["domain", "item_id", "run_id"], optional: [] },
    budget: "command",
  },
  "trace/contexts": { params: null, budget: "command" },
} as const satisfies Record<string, CommandSpec>;

export type AllowedCommand = keyof typeof COMMANDS;

export const ALLOWED_COMMANDS: readonly AllowedCommand[] = Object.freeze(
  Object.keys(COMMANDS) as AllowedCommand[],
);

/** Parameters of `logbook/get_events` (feature 002). */
export interface LogbookParams {
  start_time: string;
  end_time: string;
  entity_ids?: string[];
}

/** Parameters of `trace/list`: the domain whose stored traces are listed (feature 003). */
export interface TraceListParams {
  domain: "automation" | "script";
}

/** Parameters of `trace/get`: one stored trace (feature 003). */
export interface TraceGetParams {
  domain: "automation" | "script";
  item_id: string;
  run_id: string;
}

export type CommandParams = LogbookParams | TraceListParams | TraceGetParams;

const TRACE_DOMAIN_VALUES: readonly unknown[] = ["automation", "script"];

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
  return Object.hasOwn(COMMANDS, type);
}

/** Why `params` may not accompany `type`, or `null` when they may (and must). */
function paramProblem(
  type: AllowedCommand,
  params: CommandParams | undefined,
): string | null {
  const spec: CommandSpec = COMMANDS[type];
  const keys = spec.params;
  if (keys === null) {
    return params === undefined
      ? null
      : `command "${type}" does not take parameters`;
  }
  const given = Object.keys(params ?? {});
  const stray = given.find(
    (key) => !keys.required.includes(key) && !keys.optional.includes(key),
  );
  if (stray !== undefined) return `parameter "${stray}" is not allowed`;
  const missing = keys.required.find((key) => !given.includes(key));
  if (missing !== undefined) return `parameter "${missing}" is required`;
  if (
    "domain" in (params ?? {}) &&
    !TRACE_DOMAIN_VALUES.includes((params as TraceListParams).domain)
  ) {
    return 'parameter "domain" must be "automation" or "script"';
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HaClient {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private failure: ToolError | null = null;

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
      const fail = (error: ToolError): void => {
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
              error instanceof ToolError
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
        const haCode = typeof details.code === "string" ? details.code : null;
        const code = haCode ?? "unknown_error";
        const text =
          typeof details.message === "string" ? details.message : "no message";
        pending.reject(
          errors.retrievalFailed(pending.command, `${code}: ${text}`, haCode),
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
  private abort(error: ToolError | null): void {
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

  /**
   * Sends one allowlisted command and resolves with its `result`. `params` is accepted for
   * `logbook/get_events` only. That command may use the whole remaining overall budget, because
   * its duration grows with the window; every other command keeps the per-command limit.
   */
  command(type: AllowedCommand, params?: CommandParams): Promise<unknown> {
    if (!isAllowed(type)) {
      return Promise.reject(
        errors.protocolError(
          `command "${String(type)}" is not allowed`,
          this.haVersion,
        ),
      );
    }
    const problem = paramProblem(type, params);
    if (problem !== null) {
      return Promise.reject(errors.protocolError(problem, this.haVersion));
    }
    if (this.closed || this.failure !== null) {
      return Promise.reject(
        this.failure ??
          errors.retrievalFailed(type, "the connection is already closed"),
      );
    }
    const id = this.nextId++;
    const remaining = this.deadline - Date.now();
    const spec: CommandSpec = COMMANDS[type];
    const budget =
      spec.budget === "overall"
        ? remaining
        : Math.min(this.timeouts.commandMs, remaining);
    return new Promise<unknown>((resolve, reject) => {
      const overall =
        spec.budget === "overall" || remaining <= this.timeouts.commandMs;
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            errors.timeout(
              this.wsUrl,
              overall
                ? `the ${type} retrieval (overall limit)`
                : `the ${type} retrieval`,
              spec.timeoutHint,
            ),
          );
        },
        Math.max(budget, 0),
      );
      this.pending.set(id, { command: type, resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, type, ...params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(errors.retrievalFailed(type, describe(error)));
      }
    });
  }

  close(): void {
    this.closed = true;
    // Every command still waiting ends with an error, never in silence.
    this.abort(null);
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
}
