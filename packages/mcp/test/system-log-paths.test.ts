import { describe, expect, it } from "vitest";
import { rootPaths } from "../src/system-log/paths.js";

/** The three roots of an installation's paths (specs/012-ha-system-log FR-009, research R7). */

describe("rootPaths in the container image", () => {
  const roots = rootPaths("/config");

  it.each([
    [
      "/usr/src/homeassistant/homeassistant/components/mqtt/client.py",
      "{ha}/components/mqtt/client.py",
    ],
    [
      "/config/custom_components/acme_cloud/api.py",
      "{config}/custom_components/acme_cloud/api.py",
    ],
    ["/usr/local/lib/python3.14/asyncio/tasks.py", "{python}/asyncio/tasks.py"],
    [
      "/usr/local/lib/python3.14/site-packages/aiohttp/client.py",
      "{python}/site-packages/aiohttp/client.py",
    ],
  ])("re-roots %s", (path, expected) => {
    expect(roots(path)).toBe(expected);
  });

  it("re-roots every frame of a traceback and leaves the rest", () => {
    const text = [
      "Traceback (most recent call last):",
      '  File "/usr/src/homeassistant/homeassistant/helpers/update_coordinator.py", line 380, in _async_refresh',
      "    self.data = await self._async_update_data()",
      '  File "/config/custom_components/acme_cloud/__init__.py", line 88, in _async_update_data',
      '  File "/usr/local/lib/python3.14/site-packages/aiohttp/client.py", line 703, in _request',
      "aiohttp.ClientError: boom",
    ].join("\n");
    expect(roots(text)).toBe(
      [
        "Traceback (most recent call last):",
        '  File "{ha}/helpers/update_coordinator.py", line 380, in _async_refresh',
        "    self.data = await self._async_update_data()",
        '  File "{config}/custom_components/acme_cloud/__init__.py", line 88, in _async_update_data',
        '  File "{python}/site-packages/aiohttp/client.py", line 703, in _request',
        "aiohttp.ClientError: boom",
      ].join("\n"),
    );
  });

  it("re-roots a path inside a message", () => {
    expect(
      roots("Error loading /config/packages/heating.yaml: bad indentation"),
    ).toBe("Error loading {config}/packages/heating.yaml: bad indentation");
  });

  it.each([
    ["a relative source", "components/mqtt/client.py"],
    ["a template frame", "<template>"],
    ["a path outside the roots", "/opt/vendor/tool.py"],
    ["a configuration-like prefix", "/configuration/x.py"],
    ["a word that is not a path", "homeassistant/ is a folder"],
  ])("leaves %s as it is", (_, text) => {
    expect(roots(text)).toBe(text);
  });
});

describe("rootPaths under a host user's home directory", () => {
  it("re-roots a virtual environment's package and libraries", () => {
    const roots = rootPaths("/home/someone/.homeassistant");
    expect(
      roots(
        "/home/someone/venv/lib/python3.13/site-packages/homeassistant/components/hue/light.py",
      ),
    ).toBe("{ha}/components/hue/light.py");
    expect(
      roots(
        "/home/someone/venv/lib/python3.13/site-packages/aiohttp/client.py",
      ),
    ).toBe("{python}/site-packages/aiohttp/client.py");
    expect(roots("/home/someone/.homeassistant/custom_components/x/y.py")).toBe(
      "{config}/custom_components/x/y.py",
    );
  });

  it.each([
    [
      "/srv/homeassistant/lib/python3.13/site-packages/homeassistant/core.py",
      "{ha}/core.py",
    ],
    [
      "/srv/homeassistant/lib/python3.13/site-packages/aiohttp/client.py",
      "{python}/site-packages/aiohttp/client.py",
    ],
    [
      "/home/homeassistant/.pyenv/versions/3.13.0/lib/python3.13/asyncio/tasks.py",
      "{python}/asyncio/tasks.py",
    ],
  ])(
    "re-roots %s of a virtual environment in a homeassistant directory",
    (path, expected) => {
      expect(rootPaths("/home/homeassistant/.homeassistant")(path)).toBe(
        expected,
      );
    },
  );

  it("re-roots a configuration directory with a trailing slash and a homeassistant segment", () => {
    const roots = rootPaths("/home/someone/homeassistant/");
    expect(roots("/home/someone/homeassistant/custom_components/x/y.py")).toBe(
      "{config}/custom_components/x/y.py",
    );
  });

  it("never names the host user in what it re-roots", () => {
    const roots = rootPaths("/home/someone/.homeassistant");
    const text = [
      '  File "/home/someone/venv/lib/python3.13/site-packages/homeassistant/core.py", line 1, in run',
      '  File "/home/someone/.homeassistant/custom_components/x/y.py", line 2, in go',
      '  File "/home/someone/venv/lib/python3.13/asyncio/tasks.py", line 3, in wait',
    ].join("\n");
    expect(roots(text)).not.toContain("someone");
  });
});
