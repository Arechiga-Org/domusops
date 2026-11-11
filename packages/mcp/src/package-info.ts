import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The name the server reports in the handshake and in `ha_ping` (specs/009-ha-ping R11). */
export const SERVER_NAME = "domusops-mcp";

/**
 * Reads `version` from a `package.json`. There is no fallback: a server that cannot tell its
 * version refuses to start rather than report an invented one, and the error names the file.
 */
export function readVersion(file: URL): string {
  const path = fileURLToPath(file);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${path}: ${reason}`);
  }
  let version: unknown;
  try {
    version = (JSON.parse(text) as { version?: unknown } | null)?.version;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON: ${reason}`);
  }
  if (typeof version !== "string" || version === "")
    throw new Error(`${path} has no version`);
  return version;
}

let ownVersion: string | undefined;

/** The installed package's version, read once from its `package.json` (one level above both `src/` and `dist/`). */
export function packageVersion(): string {
  ownVersion ??= readVersion(new URL("../package.json", import.meta.url));
  return ownVersion;
}
