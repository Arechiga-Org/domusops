import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { Fixture } from "../fixtures/generate.js";

export interface FakeHaOptions {
  fixture: Fixture;
  /** Token the fake accepts. */
  token?: string;
  haVersion?: string;
  isAdmin?: boolean;
  /** Reply `success: false` to this command. */
  failCommand?: { type: string; code?: string; message?: string };
  /** Close the connection when this command is received, without replying. */
  dropAfter?: string;
  /** Never reply: "connect" (no auth_required), "auth" (no auth reply), or a command type. */
  stall?: string;
  /** Reply to this command with a result of the wrong shape. */
  malformed?: string;
}

export interface FakeHa {
  url: string;
  port: number;
  /** Command types received after authentication, in order. */
  received: string[];
  /** Whether an `auth` message (which carries the token) was ever received. */
  authReceived: boolean;
  close(): Promise<void>;
}

export const FAKE_TOKEN = "fake-test-token-0123456789";

function resultFor(type: string, options: FakeHaOptions): unknown {
  const { records } = options.fixture;
  switch (type) {
    case "auth/current_user":
      return { ...options.fixture.user, is_admin: options.isAdmin ?? true };
    case "get_config":
      return records.config;
    case "get_states":
      return records.states;
    case "config/entity_registry/list":
      return records.entity_registry;
    case "config/device_registry/list":
      return records.device_registry;
    case "config/area_registry/list":
      return records.area_registry;
    case "config_entries/get":
      return records.config_entries;
    default:
      return undefined;
  }
}

/** A `ws`-based fake instance on an ephemeral port that speaks the handshake and serves fixtures. */
export async function startFakeHa(options: FakeHaOptions): Promise<FakeHa> {
  const token = options.token ?? FAKE_TOKEN;
  const haVersion = options.haVersion ?? options.fixture.haVersion;
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  const fake: FakeHa = {
    url: `http://127.0.0.1:${port}`,
    port,
    received: [],
    authReceived: false,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };

  server.on("connection", (socket: ServerSocket) => {
    if (options.stall === "connect") return;
    socket.send(
      JSON.stringify({ type: "auth_required", ha_version: haVersion }),
    );
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as {
        id?: number;
        type?: string;
        access_token?: string;
      };
      if (message.type === "auth") {
        fake.authReceived = true;
        if (options.stall === "auth") return;
        if (message.access_token === token) {
          socket.send(
            JSON.stringify({ type: "auth_ok", ha_version: haVersion }),
          );
        } else {
          socket.send(
            JSON.stringify({
              type: "auth_invalid",
              message: "Invalid access token",
            }),
          );
          socket.close();
        }
        return;
      }
      const type = message.type ?? "";
      fake.received.push(type);
      if (options.dropAfter === type) {
        socket.terminate();
        return;
      }
      if (options.stall === type) return;
      if (options.failCommand?.type === type) {
        socket.send(
          JSON.stringify({
            id: message.id,
            type: "result",
            success: false,
            error: {
              code: options.failCommand.code ?? "unknown_error",
              message: options.failCommand.message ?? "simulated failure",
            },
          }),
        );
        return;
      }
      const result =
        options.malformed === type
          ? "not the expected shape"
          : resultFor(type, options);
      if (result === undefined) {
        socket.send(
          JSON.stringify({
            id: message.id,
            type: "result",
            success: false,
            error: {
              code: "unknown_command",
              message: `Unknown command ${type}`,
            },
          }),
        );
        return;
      }
      socket.send(
        JSON.stringify({
          id: message.id,
          type: "result",
          success: true,
          result,
        }),
      );
    });
  });

  return fake;
}
