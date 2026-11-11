---
"@domusops/schema": minor
---

Adds the `domusops.ping/0.1` format: `PING_FORMAT`, the `PingDocument` types (`PingInstance`, `PingToolReadiness`, `PingReason`) and `pingJsonSchema`. It describes the document `ha_ping` returns: the server's identity, the instance's version, support and time zone, whether the token's user is an administrator, which integrations are loaded, and each tool's readiness with its reasons. The document is read as it is, so there is no decoder, and its `tools` and `integrations` maps are open to names a reader does not know. No existing format changes.
