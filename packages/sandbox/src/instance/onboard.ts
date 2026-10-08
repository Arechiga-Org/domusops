import { randomBytes } from "node:crypto";
import { SandboxError } from "../errors.js";
import { postForm, postJson } from "../ha/rest.js";
import { HaSocket } from "../ha/ws.js";
import type { Runtime } from "../runtime/docker.js";

export const ONBOARDING_CLIENT_ID = "http://domusops-sandbox/";
export const TOKEN_CLIENT_NAME = "domusops-sandbox";
export const TOKEN_PATH = "/config/.domusops-sandbox/token";

interface AuthCodeResponse {
  auth_code?: unknown;
}

interface TokenResponse {
  access_token?: unknown;
}

function field(value: unknown, name: string, step: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${step} did not return ${name}`);
  }
  return value;
}

/**
 * Finishes onboarding over the instance's own HTTP API, the one its web frontend uses, then asks
 * the WebSocket API for a long-lived access token. The user's password is random and discarded.
 */
export async function onboard(
  baseUrl: string,
  wsUrl: string,
  deadline: number,
): Promise<string> {
  const password = randomBytes(24).toString("hex");
  // Each exchange gets what is left of the readiness limit, but never less than a few seconds.
  const budget = (): number => Math.max(5_000, deadline - Date.now());
  try {
    const created = (await postJson(
      baseUrl,
      "/api/onboarding/users",
      {
        client_id: ONBOARDING_CLIENT_ID,
        name: "Sandbox",
        username: "sandbox",
        password,
        language: "en",
      },
      { timeoutMs: budget() },
    )) as AuthCodeResponse;
    const code = field(created.auth_code, "an auth_code", "onboarding/users");

    const session = (await postForm(
      baseUrl,
      "/auth/token",
      {
        grant_type: "authorization_code",
        code,
        client_id: ONBOARDING_CLIENT_ID,
      },
      { timeoutMs: budget() },
    )) as TokenResponse;
    const accessToken = field(
      session.access_token,
      "an access_token",
      "auth/token",
    );

    for (const step of ["core_config", "analytics"] as const) {
      await postJson(
        baseUrl,
        `/api/onboarding/${step}`,
        {},
        { token: accessToken, timeoutMs: budget() },
      );
    }
    await postJson(
      baseUrl,
      "/api/onboarding/integration",
      {
        client_id: ONBOARDING_CLIENT_ID,
        redirect_uri: `${ONBOARDING_CLIENT_ID}?auth_callback=1`,
      },
      { token: accessToken, timeoutMs: budget() },
    );

    const socket = await HaSocket.connect(wsUrl, accessToken, {
      connectTimeoutMs: budget(),
    });
    try {
      const longLived = await socket.command<unknown>(
        {
          type: "auth/long_lived_access_token",
          client_name: TOKEN_CLIENT_NAME,
          lifespan: 1,
        },
        budget(),
      );
      return field(longLived, "a token", "auth/long_lived_access_token");
    } finally {
      socket.close();
    }
  } catch (error) {
    throw new SandboxError(
      "not_ready",
      `Onboarding the instance failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { secrets: [password] },
    );
  }
}

/** Keeps the token inside the container (mode 0600), never in a host file. */
export async function storeToken(
  runtime: Runtime,
  containerId: string,
  token: string,
): Promise<void> {
  const result = await runtime.exec(
    containerId,
    [
      "sh",
      "-c",
      `umask 077 && mkdir -p "$(dirname ${TOKEN_PATH})" && cat > ${TOKEN_PATH}`,
    ],
    { input: token },
  );
  if (result.status !== 0) {
    throw new SandboxError(
      "not_ready",
      "Could not store the access token inside the instance.",
      { secrets: [token] },
    );
  }
}

/** Reads the token back from the container, for a background instance. */
export async function readToken(
  runtime: Runtime,
  containerId: string,
): Promise<string> {
  const result = await runtime.exec(containerId, ["cat", TOKEN_PATH]);
  const token = result.stdout.trim();
  if (result.status !== 0 || token === "") {
    throw new SandboxError(
      "instance_gone",
      "The instance has no stored access token; it may have been stopped.",
    );
  }
  return token;
}
