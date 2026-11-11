---
"@domusops/mcp": minor
---

Adds `ha_ping`, a cheap, read-only tool that tells an agent, before any real query, whether the server can work with the connected instance. It reads only the current user and the instance's core configuration, and returns a small `domusops.ping/0.1` document: the server's name and version; the instance's version, the least version the server supports, whether it is supported, and its time zone; whether the token's user is an administrator; which integrations the tools need are loaded; and, for every other tool, whether it is ready and why not, with the steps to fix it. An instance older than the minimum is reported in the document instead of as an error; an unreachable address, a refused token, a timeout or a missing configuration fail as in the other tools. The token, the instance's address and location, and user names are never returned. The other tools' outputs do not change.
