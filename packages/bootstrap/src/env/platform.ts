/**
 * Platform detection (research R14, plan FR-030). WSL reports `linux`, so it is treated exactly
 * like a native Linux install; only a native Windows process is stopped.
 */

export interface RunStop {
  reason: string;
  message: string;
  details?: string[];
}

export function isNativeWindows(): boolean {
  return process.platform === "win32";
}

export function nativeWindowsStop(): RunStop {
  return {
    reason: "native_windows",
    message:
      "domusops-bootstrap does not run on native Windows. Install WSL (Windows Subsystem for " +
      "Linux) and run the same command from inside it: your configuration directory is reachable " +
      "there under /mnt/c/... (or the drive letter that holds it).",
  };
}
