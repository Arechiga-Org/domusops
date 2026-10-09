#!/usr/bin/env node
// Builds the supported-versions table from run results; nothing in it is written by hand.
//   --run <id>     download the results of a CI run (needs the GitHub CLI) and apply them
//   --from <dir>   apply the result files found in a directory
//   --gate <dir>   check the results in a directory for the merge gate; prints the table
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  SUPPORTED_VERSIONS_FORMAT,
  applyResults,
  emptySupportedVersions,
  gateVerdict,
  readResult,
  renderSupportedVersions,
  replaceTableBlock,
} from "../dist/index.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const jsonPath = join(root, "docs", "supported-versions.json");
const readmePath = join(root, "README.md");

function resultFiles(directory) {
  let names;
  try {
    names = readdirSync(directory, { recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => String(name).endsWith(".json"))
    .map((name) => join(directory, String(name)));
}

function readResults(directory) {
  return resultFiles(directory).map((file) => readResult(file));
}

function currentDocument() {
  try {
    const doc = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (doc.format !== SUPPORTED_VERSIONS_FORMAT) {
      throw new Error(
        `${jsonPath} is not a ${SUPPORTED_VERSIONS_FORMAT} file.`,
      );
    }
    return doc;
  } catch (error) {
    if (error.code === "ENOENT") return emptySupportedVersions();
    throw error;
  }
}

function apply(results) {
  const doc = applyResults(currentDocument(), results);
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  const readme = readFileSync(readmePath, "utf8");
  writeFileSync(
    readmePath,
    replaceTableBlock(readme, renderSupportedVersions(doc)),
  );
  process.stdout.write(`${renderSupportedVersions(doc)}\n`);
}

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    from: { type: "string" },
    gate: { type: "string" },
  },
  strict: true,
});
const chosen = [values.run, values.from, values.gate].filter(
  (value) => value !== undefined,
);
if (chosen.length !== 1) {
  process.stderr.write(
    "Give exactly one of --run <id>, --from <dir> or --gate <dir>.\n",
  );
  process.exit(2);
}

if (values.gate !== undefined) {
  const results = readResults(resolve(values.gate));
  const { ok, problems } = gateVerdict(results);
  process.stdout.write(
    `${renderSupportedVersions(
      applyResults(
        emptySupportedVersions(),
        results.filter(
          (r) => r.channel !== "exact" && r.ciRunUrl !== undefined,
        ),
      ),
    )}\n`,
  );
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(ok ? 0 : 1);
} else if (values.from !== undefined) {
  apply(readResults(resolve(values.from)));
} else {
  if (!/^\d+$/.test(values.run)) {
    process.stderr.write("--run needs a numeric run id.\n");
    process.exit(2);
  }
  const directory = mkdtempSync(join(tmpdir(), "domusops-results-"));
  try {
    execFileSync(
      "gh",
      [
        "run",
        "download",
        values.run,
        "--pattern",
        "sandbox-result-*",
        "-D",
        directory,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    apply(readResults(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
