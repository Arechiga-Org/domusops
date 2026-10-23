---
"@domusops/schema": patch
"@domusops/mcp": patch
"@domusops/sandbox": patch
"@domusops/bootstrap": patch
---

Every package now ships its TypeScript sources next to `dist`, so the source maps and declaration maps in a package resolve from the package alone. `@domusops/schema` gains a README that says what the package is, how to install it, which formats it exports, and what stability it promises.
