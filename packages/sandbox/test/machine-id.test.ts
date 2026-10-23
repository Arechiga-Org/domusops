import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureMachineId,
  machineIdPath,
  readMachineId,
} from "../src/runtime/machine-id.js";

let state: string;
let previous: string | undefined;

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "domusops-machine-"));
  previous = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = state;
});

afterEach(() => {
  if (previous === undefined) delete process.env["XDG_STATE_HOME"];
  else process.env["XDG_STATE_HOME"] = previous;
  chmodSync(state, 0o700);
  rmSync(state, { recursive: true, force: true });
});

describe("the machine identifier", () => {
  it("lives under the state directory", () => {
    expect(machineIdPath()).toBe(join(state, "domusops", "machine-id"));
  });

  it("is 32 lowercase hex characters", () => {
    expect(ensureMachineId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is created once and reused", () => {
    const first = ensureMachineId();
    expect(ensureMachineId()).toBe(first);
    expect(readMachineId()).toBe(first);
    expect(readFileSync(machineIdPath(), "utf8").trim()).toBe(first);
  });

  it("is not created by reading it", () => {
    expect(readMachineId()).toBeNull();
    expect(existsSync(machineIdPath())).toBe(false);
  });

  it("agrees between two first uses", async () => {
    const ids = await Promise.all(
      Array.from({ length: 8 }, async () => ensureMachineId()),
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBeNull();
  });

  it.each(["", "not-hex", "ABCDEF0123456789ABCDEF0123456789", "abc123"])(
    "treats %j in the file as no identifier, and never overwrites it",
    (content) => {
      mkdirSync(join(state, "domusops"), { recursive: true });
      writeFileSync(machineIdPath(), content);
      expect(readMachineId()).toBeNull();
      expect(ensureMachineId()).toBeNull();
      expect(readFileSync(machineIdPath(), "utf8")).toBe(content);
    },
  );

  it("is null when the location cannot be written", () => {
    chmodSync(state, 0o500);
    // A user who can write anywhere (root) cannot make a location unwritable this way.
    if (process.getuid?.() === 0) return;
    expect(ensureMachineId()).toBeNull();
  });
});
