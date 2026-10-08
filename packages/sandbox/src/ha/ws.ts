/** A command the instance answered with `success: false`. */
export class WsCommandError extends Error {
  readonly code: string;
  constructor(command: string, code: string, message: string) {
    super(`${command} failed (${code}): ${message}`);
    this.name = "WsCommandError";
    this.code = code;
  }
}

/** The connection could not be opened, authenticated, or was lost. */
export class WsConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WsConnectionError";
  }
}

interface Pending {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ConnectOptions {
  /** Covers the open and the authentication handshake. Default 10 s. */
  connectTimeoutMs?: number;
  /** Per command. Default 30 s. */
  commandTimeoutMs?: number;
}

/**
 * A minimal client for the instance's WebSocket API: authenticate, send id-correlated commands,
 * read their results. It is the sandbox's own; `@domusops/mcp`'s client allows read-only commands
 * only, on purpose, and stays that way.
 */
export class HaSocket {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private isClosed = false;
  private readonly closeListeners: (() => void)[] = [];

  private constructor(
    private readonly socket: WebSocket,
    private readonly commandTimeoutMs: number,
  ) {
    socket.addEventListener("message", (event: MessageEvent) => {
      this.onMessage(String(event.data));
    });
    const gone = (): void => this.markClosed();
    socket.addEventListener("close", gone);
    socket.addEventListener("error", gone);
  }

  static connect(
    url: string,
    token: string,
    options: ConnectOptions = {},
  ): Promise<HaSocket> {
    const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
    return new Promise<HaSocket>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(
          new WsConnectionError(
            `Could not open ${url}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return;
      }
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // already unusable
        }
        reject(new WsConnectionError(message));
      };
      const timer = setTimeout(
        () => fail(`Timed out connecting to ${url}.`),
        connectTimeoutMs,
      );
      socket.addEventListener("error", () =>
        fail(`Could not connect to ${url}.`),
      );
      socket.addEventListener("close", () =>
        fail(`The connection to ${url} closed during the handshake.`),
      );
      socket.addEventListener("message", (event: MessageEvent) => {
        if (settled) return;
        let message: { type?: unknown };
        try {
          message = JSON.parse(String(event.data)) as typeof message;
        } catch {
          fail("The instance sent a message that is not JSON.");
          return;
        }
        if (message.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (message.type === "auth_ok") {
          settled = true;
          clearTimeout(timer);
          resolve(new HaSocket(socket, commandTimeoutMs));
        } else if (message.type === "auth_invalid") {
          fail("The instance rejected the access token.");
        } else {
          fail(
            `Unexpected "${String(message.type)}" message during authentication.`,
          );
        }
      });
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Called once when the connection ends, however it ends. */
  onClose(listener: () => void): void {
    if (this.isClosed) listener();
    else this.closeListeners.push(listener);
  }

  command<T = unknown>(
    payload: { type: string } & Record<string, unknown>,
    timeoutMs: number = this.commandTimeoutMs,
  ): Promise<T> {
    if (this.isClosed) {
      return Promise.reject(
        new WsConnectionError(`The connection is closed (${payload.type}).`),
      );
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new WsConnectionError(
            `Timed out waiting for the reply to ${payload.type}.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        command: payload.type,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        this.socket.send(JSON.stringify({ ...payload, id }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new WsConnectionError(
            `Could not send ${payload.type}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  /** Closes the connection and rejects every command still waiting for a reply. */
  close(): void {
    try {
      this.socket.close();
    } catch {
      // already closed
    }
    this.markClosed();
  }

  private onMessage(raw: string): void {
    let message: {
      id?: unknown;
      type?: unknown;
      success?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
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
      const code =
        typeof message.error?.code === "string"
          ? message.error.code
          : "unknown_error";
      const text =
        typeof message.error?.message === "string"
          ? message.error.message
          : "no message";
      pending.reject(new WsCommandError(pending.command, code, text));
    }
  }

  private markClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(
        new WsConnectionError(
          `The connection closed before a reply to ${pending.command} arrived.`,
        ),
      );
    }
    for (const listener of this.closeListeners.splice(0)) listener();
  }
}
