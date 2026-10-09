---
"@domusops/sandbox": minor
---

Reach a sandbox instance with the tools you already use. `sandbox.connection()` returns the instance's URL, WebSocket URL and administrator token, and `sandbox.mcpEnv()` returns exactly the two variables `@domusops/mcp` reads (`DOMUSOPS_HA_URL` and `DOMUSOPS_HA_TOKEN`), so an MCP server or any WebSocket client can be pointed at the instance with no change to either. `domusops-sandbox env <id>` prints those two variables as `KEY=value` lines for `eval` or a `.env` file; it is the only command that prints the token. After the instance is stopped, the URL and token no longer work.
