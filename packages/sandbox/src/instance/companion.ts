import { SandboxError } from "../errors.js";
import { HaSocket, WsCommandError } from "../ha/ws.js";

export const COMPANION_INFO = "domusops_sandbox/info";
export const COMPANION_ATTACH = "domusops_sandbox/attach";
export const DETACH = "domusops_sandbox/detach";

export interface CompanionInfo {
  id: string;
  mode: string;
  deadline: string;
  frozen: boolean;
}

/**
 * Asks the instance behind `socket` which sandbox it is. Anything that does not answer with
 * `expectedId` is not an instance this library created, and is never driven (FR-019).
 */
export async function verifyCompanion(
  socket: HaSocket,
  expectedId: string,
): Promise<CompanionInfo> {
  let info: Partial<CompanionInfo>;
  try {
    info = await socket.command<Partial<CompanionInfo>>({
      type: COMPANION_INFO,
    });
  } catch (error) {
    if (error instanceof WsCommandError) {
      throw new SandboxError(
        "not_a_sandbox",
        "The instance does not answer as a DomusOps sandbox.",
      );
    }
    throw error;
  }
  if (info.id !== expectedId) {
    throw new SandboxError(
      "not_a_sandbox",
      `The instance identifies as sandbox "${String(info.id)}", not "${expectedId}".`,
    );
  }
  return info as CompanionInfo;
}

/** Makes `socket` the owner connection: if it closes without a detach, the instance stops. */
export async function attachOwner(socket: HaSocket): Promise<void> {
  await socket.command({ type: COMPANION_ATTACH });
}
