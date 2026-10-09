import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRuntime,
  RuntimeCommandError,
  TIMED_OUT,
} from "../src/runtime/docker.js";

const directories: string[] = [];

/** A `docker` on PATH that answers every call with the given exit code and message. */
function docker(status: number, stderr: string): void {
  const directory = mkdtempSync(join(tmpdir(), "domusops-docker-"));
  directories.push(directory);
  const program = join(directory, "docker");
  writeFileSync(
    program,
    `#!/bin/sh\necho "${stderr}" >&2\nexit ${String(status)}\n`,
  );
  chmodSync(program, 0o755);
  vi.stubEnv("PATH", `${directory}:${process.env["PATH"] ?? ""}`);
  vi.stubEnv("DOMUSOPS_CONTAINER", "docker");
}

/** A `docker` on PATH that never answers. */
function hangingDocker(): void {
  const directory = mkdtempSync(join(tmpdir(), "domusops-docker-"));
  directories.push(directory);
  const program = join(directory, "docker");
  writeFileSync(program, "#!/bin/sh\nexec sleep 60\n");
  chmodSync(program, 0o755);
  vi.stubEnv("PATH", `${directory}:${process.env["PATH"] ?? ""}`);
  vi.stubEnv("DOMUSOPS_CONTAINER", "docker");
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("removing a container", () => {
  it("succeeds when it is already gone", async () => {
    docker(1, "Error: No such container: abc");
    await expect(createRuntime().remove("abc")).resolves.toBeUndefined();
  });

  it("succeeds when its removal is already in progress", async () => {
    docker(
      1,
      "Error response from daemon: removal of container abc is already in progress",
    );
    await expect(createRuntime().remove("abc")).resolves.toBeUndefined();
  });

  it("still fails for any other error", async () => {
    docker(1, "Error response from daemon: permission denied");
    await expect(createRuntime().remove("abc")).rejects.toBeInstanceOf(
      RuntimeCommandError,
    );
  });
});

describe("pulling an image", () => {
  it("gives up when the registry never answers", async () => {
    hangingDocker();
    const started = Date.now();
    const result = await createRuntime({ pullTimeoutMs: 300 }).pull("image:1");
    expect(result.status).toBe(TIMED_OUT);
    expect(result.stderr).toContain("timed out");
    expect(result.stderr).not.toMatch(/\S(?=timed out)/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports the exit status of a pull that finishes", async () => {
    docker(1, "manifest unknown");
    const result = await createRuntime().pull("image:1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("manifest unknown");
  });
});
