#!/usr/bin/env node
/**
 * @domusops/mcp — entrypoint.
 *
 * Real tool registration (ha_snapshot first — see 01-SEED.md §5) lands via
 * /speckit.implement. This stub exists so `pnpm build` and `npx @domusops/mcp`
 * have something to run against from commit one.
 */

console.error("[domusops-mcp] no tools registered yet — see specs/ha-snapshot/");
process.exit(1);
