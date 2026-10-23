import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@domusops/schema": fileURLToPath(
        new URL("./packages/schema/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Tests that start a sandbox keep its per-user machine identifier here, not in the real home
    // directory of whoever runs them.
    env: { XDG_STATE_HOME: join(tmpdir(), "domusops-vitest-state") },
    include: ["packages/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
    // The bootstrap package's container-based validation test needs a real
    // container runtime and a network pull of a pinned Home Assistant image;
    // it runs only in the `bootstrap-validate` CI job (specs/004-ha-bootstrap).
    exclude: process.env["DOMUSOPS_CONTAINER_TESTS"]
      ? ["**/node_modules/**", "**/dist/**"]
      : ["**/node_modules/**", "**/dist/**", "**/*.container.test.ts"],
  },
});
