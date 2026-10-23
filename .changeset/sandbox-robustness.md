---
"@domusops/sandbox": patch
---

The sandbox holds up across processes and releases. A handle from `attachSandbox` can now add virtual devices to an instance that was started with `devices`, and says why when it cannot. Tied instances record a random identifier of the machine that started them, so cleanup no longer mistakes a live owner for gone, or an orphan for alive, when the host name changes; instances started by 0.1.0 are handled as before. On a Home Assistant release that lacks what time control replaces, `time.freeze` and `time.advance` fail with the new `time_unavailable` error and the smoke check reports that release as failed, instead of failing with an obscure error. The virtual-device integration is now fetched by an exact commit and checked against a digest of its files before it is installed. The smoke check keeps the instance's token across steps, so a message written after the instance is stopped cannot leak it.
