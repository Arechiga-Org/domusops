import { readFileSync, writeFileSync } from "node:fs";

// Pins that name a package's current minor (`@domusops/<name>@~X.Y`), rewritten on every release.
const PINS = [
  { name: "bootstrap", file: "skills/ha-bootstrap/SKILL.md" },
  { name: "mcp", file: "packages/mcp/README.md" },
];

for (const { name, file } of PINS) {
  const pkg = JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8"));
  const [major, minor] = pkg.version.split(".");
  const before = readFileSync(file, "utf8");
  const after = before.replace(
    new RegExp(`@domusops/${name}@~\\d+\\.\\d+`, "g"),
    `@domusops/${name}@~${major}.${minor}`,
  );
  if (after !== before) writeFileSync(file, after);
  console.log(`${file} pins @domusops/${name}@~${major}.${minor}`);
}
