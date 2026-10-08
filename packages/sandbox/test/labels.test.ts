import { describe, expect, it } from "vitest";
import {
  ID_RE,
  LABEL_MARKER,
  LABEL_OWNER_PID,
  buildLabels,
  containerName,
  newSandboxId,
  parseLabels,
  type SandboxLabels,
} from "../src/runtime/labels.js";

const tied: SandboxLabels = {
  id: "0123456789ab",
  mode: "tied",
  deadline: "2026-10-06T20:00:00.000Z",
  owner: { host: "build-1", pid: 4242 },
  release: "2026.10.1",
};

const background: SandboxLabels = {
  ...tied,
  mode: "background",
  owner: null,
};

describe("ids and names", () => {
  it("generates 12 lowercase hex characters", () => {
    for (let i = 0; i < 50; i++) expect(newSandboxId()).toMatch(ID_RE);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSandboxId()));
    expect(ids.size).toBe(200);
  });

  it("names the container after the id", () => {
    expect(containerName("0123456789ab")).toBe("domusops-sandbox-0123456789ab");
  });
});

describe("labels", () => {
  it("round-trips a tied instance", () => {
    expect(parseLabels(buildLabels(tied))).toEqual(tied);
  });

  it("round-trips a background instance and writes no owner labels", () => {
    const built = buildLabels(background);
    expect(Object.keys(built).some((k) => k.includes("owner"))).toBe(false);
    expect(parseLabels(built)).toEqual(background);
  });

  it("always carries the marker", () => {
    expect(buildLabels(tied)[LABEL_MARKER]).toBe("1");
  });

  it("ignores a container without the marker", () => {
    const rest = buildLabels(tied);
    delete rest[LABEL_MARKER];
    expect(parseLabels(rest)).toBeNull();
    expect(parseLabels({})).toBeNull();
    expect(parseLabels({ [LABEL_MARKER]: "0" })).toBeNull();
  });

  it.each([
    ["a bad id", { "io.domusops.sandbox.id": "nothex" }],
    ["a bad mode", { "io.domusops.sandbox.mode": "forever" }],
    ["a bad deadline", { "io.domusops.sandbox.deadline": "soon" }],
    ["a bad owner pid", { [LABEL_OWNER_PID]: "0" }],
    ["a non-numeric owner pid", { [LABEL_OWNER_PID]: "abc" }],
  ])("treats %s as not ours", (_name, override) => {
    expect(parseLabels({ ...buildLabels(tied), ...override })).toBeNull();
  });

  it("requires owner labels in tied mode", () => {
    const rest = buildLabels(tied);
    delete rest["io.domusops.sandbox.owner-host"];
    expect(parseLabels(rest)).toBeNull();
  });
});
