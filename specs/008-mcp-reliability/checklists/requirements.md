# Specification Quality Checklist: mcp reliability

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The users of this feature are agents and the people who set them up, so the spec names the
  toolkit's own tools, inputs and packages (`ha_trace`, `exclude`, `@domusops/schema`) as
  user-facing surface, as the specs of features 001 to 007 do. How each part is built is left to
  the plan.
- No clarification markers were needed. The one choice with a constitution impact, where the
  exclusion note and the trace warning travel, is recorded in Assumptions: next to the document,
  so no published format changes (§5).
- Scope comes from the maintainer's counter-proposal of 2026-11-04 (phase 1 of the roadmap);
  `ha_ping` moved to the 0.2.0 phase because a new tool is not a patch.
- Audit after the 0.1.2 release (T037), against pull requests #29 (US1), #31 (US2), #32 (US3),
  #33 (US4) and #30 (Version Packages):
  - FR-001 to FR-018 are met. FR-001 and FR-002 by #29; FR-003 to FR-006 by #31; FR-007 to
    FR-010 by #32, with FR-008 clarified in review (a kept event or run is returned whole);
    FR-011 to FR-014 by #33, counting runs only after review; FR-015 to FR-018 across all four,
    with four patch changesets for `@domusops/mcp` and none for any other package.
  - SC-006: four test files that predate the feature were edited, none in an output
    expectation: the contract paths moved to the 008 contracts (`logbook-contract.test.ts`,
    `trace-tool.test.ts`), the advertised input properties gained `exclude`
    (`trace-errors.test.ts`), the command table gained `automation/config` and `script/config`
    (`client.test.ts`), and `cli.test.ts` gained the handshake assertion.
  - SC-007 was wrong as written: `@domusops/sandbox` depends on `@domusops/mcp` through
    `workspace:*`, which is published as an exact version, so the release also took it to 0.1.2
    with a dependency-only patch. The maintainer accepted that, and SC-007 now says so.
  - `@domusops/mcp@0.1.2` and `@domusops/sandbox@0.1.2` are on npm with provenance;
    `@domusops/schema` and `@domusops/bootstrap` stay at 0.1.1. The installed package reports
    `0.1.2` in the handshake (SC-001). SC-002 and the phase gate, a Claude Code session on the
    README's recommended setup reporting 0.1.2, wait for the maintainer's confirmation.
