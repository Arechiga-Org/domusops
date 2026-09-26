import { snapshotJsonSchema } from "@domusops/schema";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { redact } from "../src/snapshot/redact.js";
import { encodeFull } from "../src/snapshot/encode-full.js";
import { encodeStandard } from "../src/snapshot/encode-standard.js";
import { encodeSummary } from "../src/snapshot/encode-summary.js";
import { project } from "../src/snapshot/project.js";
import { EMPTY, REFERENCE_500 } from "./fixtures/generate.js";

const validate = new Ajv({ allErrors: true, strict: false }).compile(snapshotJsonSchema);

function documents(fixture: typeof REFERENCE_500): Record<string, unknown> {
  const redacted = redact(fixture.records, "t");
  const v = fixture.haVersion;
  return {
    summary: encodeSummary(project(redacted, { omit: true }), v),
    standard: encodeStandard(project(redacted, { omit: true }), v),
    full: encodeFull(project(redacted, { omit: false }), v),
  };
}

describe("snapshotJsonSchema", () => {
  for (const [name, fixture] of [["reference", REFERENCE_500], ["empty", EMPTY]] as const) {
    for (const [detail, doc] of Object.entries(documents(fixture))) {
      it(`accepts the ${detail} document of the ${name} fixture`, () => {
        const parsed = JSON.parse(JSON.stringify(doc));
        expect(validate(parsed), JSON.stringify(validate.errors?.slice(0, 2))).toBe(true);
      });
    }
  }

  it("rejects a document with another format, a bad detail, or missing sections", () => {
    const standard = JSON.parse(JSON.stringify(documents(REFERENCE_500)["standard"]));
    expect(validate({ ...standard, format: "domusops.snapshot/9.9" })).toBe(false);
    expect(validate({ ...standard, detail: "verbose" })).toBe(false);
    const withoutTemplates = { ...standard };
    delete withoutTemplates.templates;
    expect(validate(withoutTemplates)).toBe(false);
    expect(validate({ ...standard, compression_ratio: -1 })).toBe(false);
  });
});
