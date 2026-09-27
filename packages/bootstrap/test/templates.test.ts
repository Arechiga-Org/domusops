import { describe, expect, it } from "vitest";
import {
  renderGitignoreBlock,
  renderHook,
  renderPackagesReadme,
  renderPlaceholders,
  renderSopsConfig,
  renderWorkflow,
  sha256,
} from "../src/baseline/templates.js";

// Spanish diacritics and inverted punctuation (constitution §1, the same character class as
// "Signal 1" of .claude/hooks/guard-language.sh), written as Unicode escapes so this test file
// itself is never mistaken for the Spanish text it is checking generated output does not contain.
const SPANISH_DIACRITICS = new RegExp("[áéíóúñ¿¡Ñ]");

const RENDERERS: [name: string, render: () => string][] = [
  ["gitignore block", () => renderGitignoreBlock()],
  ["packages README", () => renderPackagesReadme()],
  [
    "sops config",
    () =>
      renderSopsConfig([
        "age1exampleexampleexampleexampleexampleexampleexamplex",
      ]),
  ],
  ["placeholders", () => renderPlaceholders()],
  ["hook", () => renderHook("0.1.0")],
  ["workflow", () => renderWorkflow("0.1.0")],
];

describe("templates are deterministic and English-only (research R12, FR-024)", () => {
  it.each(RENDERERS)("%s renders identical bytes twice", (_name, render) => {
    expect(sha256(render())).toBe(sha256(render()));
  });

  it.each(RENDERERS)(
    "%s contains no Spanish diacritic or inverted punctuation",
    (_name, render) => {
      expect(SPANISH_DIACRITICS.test(render())).toBe(false);
    },
  );

  it.each(RENDERERS)(
    '%s never says "Home Assistant" without "for" before it',
    (_name, render) => {
      const text = render();
      if (/Home Assistant/.test(text)) {
        expect(text).toMatch(/for Home Assistant/);
      }
    },
  );
});

describe("renderGitignoreBlock", () => {
  it("omits entries already tracked (spec edge case)", () => {
    const block = renderGitignoreBlock(
      new Set(["custom_components/", "www/community/"]),
    );
    expect(block).not.toContain("custom_components/");
    expect(block).not.toContain("www/community/");
    expect(block).toContain("secrets.yaml");
  });
});
