// Writes the JSON Schema files shipped for editors from the two constants in `dist/`.
// Run `pnpm --filter @domusops/schema build` first, then `pnpm --filter @domusops/schema write-schemas`;
// `test/scenario-json-schema.test.ts` fails when a file differs from its constant.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { scenarioJsonSchema, scenarioReportJsonSchema } from "../dist/index.js";

const files = {
  "scenario.schema.json": scenarioJsonSchema,
  "scenario-report.schema.json": scenarioReportJsonSchema,
};

for (const [name, schema] of Object.entries(files)) {
  const target = fileURLToPath(new URL(`../schema/${name}`, import.meta.url));
  const text = await format(JSON.stringify(schema), { parser: "json" });
  writeFileSync(target, text);
  console.log(`wrote schema/${name}`);
}
