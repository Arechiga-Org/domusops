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
    include: ["packages/*/test/**/*.test.ts"],
    // The bootstrap package's container-based validation test needs a real
    // container runtime and a network pull of a pinned Home Assistant image;
    // it runs only in the `bootstrap-validate` CI job (specs/004-ha-bootstrap).
    exclude: process.env["DOMUSOPS_CONTAINER_TESTS"]
      ? ["**/node_modules/**", "**/dist/**"]
      : ["**/node_modules/**", "**/dist/**", "**/*.container.test.ts"],
  },
});
