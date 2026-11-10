---
"@domusops/mcp": patch
---

The server reports its real version during the connection handshake instead of `0.0.0`, so a client can tell which release answered. The version is read from the installed package; a server that cannot read it refuses to start.
