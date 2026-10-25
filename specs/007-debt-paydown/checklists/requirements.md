# Specification Quality Checklist: debt paydown

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-22
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

- The users of this feature are developers, maintainers and agents, so the spec names the
  toolkit's own commands, tools and files (`ha_trace`, `.sops.yaml`, add-key) as user-facing
  surface, as the specs of features 001 to 005 do. How each fix is built is left to the plan.
- The "Source debt inventory" names code locations on purpose: it traces each requirement back
  to the review finding it closes and is marked as non-normative.
- The user settled scope before the spec was written (one spec, six stories; OIDC migration in
  scope), so no clarification markers were needed. Remaining choices (source maps carried or
  shipped, minor or patch bumps, the ownership identifier) are recorded as planning decisions in
  Assumptions.

## Final audit (T073)

Checked on 2026-10-25 against `main` after the six stories merged (US1 #19, US2 #20, US3 #22,
US4 #23, US5 #24, US6 #25) and the follow-up fix #26. Each requirement is covered by merged code
and tests unless listed below.

Open or not verifiable from the repository:

- **FR-007, FR-008, SC-005**: the trusted publisher per package on npmjs.com, the first publish
  through it (registry provenance on each version), deleting `NPM_TOKEN` and revoking the token
  are maintainer steps (T025 to T028). They stay open until "Version Packages" is merged and its
  `release` run has published.
- **SC-007 (README on the registry)**: `packages/schema/README.md` ships and the package-contents
  test passes; the registry page can only be seen after that first publish.
- **SC-006**: the latest `ci` and `release` runs on `main` carry no deprecated-runtime warning
  (only runner-image notices); this is re-checked on the publishing run.
- **FR-023, one deliberate exception**: the escape-shape check exists twice, once in
  `@domusops/schema` (`isEscape`, decoder) and once in `@domusops/mcp` (`isEscapeShaped`,
  encoder). Sharing it would add an export to the schema, which §5 forbids for this feature
  (FR-032). Each carries a comment naming the other, and the round-trip tests fail if they drift.
- **FR-032**: since `@domusops/schema@0.1.0` the schema changed only by shipping `src` in
  `files` (FR-011) and that comment; no format changed.
- **FR-030, SC-013**: six stories merged as six pull requests, each with the gate green. US1
  needed two (#18 into the spec branch by mistake, then #19 into `main`), and #26 fixed two
  faults found afterwards: Changesets CLI v2 against `changesets/action` v2 (the release workflow
  failed on every push to `main` after #20), and an `init` test that rewrote the bootstrap
  `package.json` and raced with parallel tests.
- **FR-031**: changesets exist for US1 (mcp), US2 (all four), US3 (sandbox) and US4 (bootstrap);
  US5 and US6 added none.
- **FR-033**: tests use simulated instances or the sandbox; the only `homeassistant.local` URL
  is a configuration-parsing input that is never connected to.

Follow-up found by the post-merge review and fixed with this audit: deleting a cache entry that
fails the digest check is now best effort in `readCached`, so a cache that cannot be written no
longer surfaces a raw file-system error instead of `virtual_unavailable`.

Left as they are, by decision: `ha/trace.ts` still classifies `unknown_command`, `unauthorized`
and `not_found` by message text; `packageVersion()` falls back to `0.0.0` without a message;
`secrets add-key` with no `.sops.yaml` creates one; an old `hass-virtual-<version>.tar.gz` stays in
the sandbox cache directory.

## Maintainer notes (T074)

- The SEED section 7 articles for backlog items 3, 4 and 5 are drafted outside this repository
  and remain there.
- The question of whether hass-virtual device names are unique only within a kind stays open in
  `research.md` R15; nothing in the code depends on the answer.
