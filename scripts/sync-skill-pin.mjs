import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("packages/bootstrap/package.json", "utf8"));
const [major, minor] = pkg.version.split(".");
const path = "skills/ha-bootstrap/SKILL.md";
const before = readFileSync(path, "utf8");
const after = before.replace(
  /@domusops\/bootstrap@~\d+\.\d+/g,
  `@domusops/bootstrap@~${major}.${minor}`,
);
if (after !== before) writeFileSync(path, after);
console.log(`SKILL.md pins @domusops/bootstrap@~${major}.${minor}`);
