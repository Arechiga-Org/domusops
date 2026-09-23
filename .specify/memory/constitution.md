# DomusOps Constitution

Non-negotiable. An agent may not waive, reinterpret, or scope-limit any
article below. Source of truth: `01-SEED.md` §3 in the bootstrap package.

## §1 — English-only artifacts

Every artifact committed to this repository is written in English: source
code, identifiers, comments, commit messages, branch names, pull request
titles and bodies, specifications, plans, tasks, documentation, README files,
CHANGELOG entries, error messages, log strings, test names, and issue text.

Spanish is the conversational language between the maintainer and the coding
agent. It is never the language of an artifact.

Enforced mechanically by `.claude/hooks/guard-language.sh` (PreToolUse). The
hook is the authority; this article explains why it exists.

## §2 — Specification precedes implementation

No implementation begins without a spec in `specs/`, a plan, and a task list.
`/speckit.analyze` runs before `/speckit.implement`, always. Drift between
spec, plan, and tasks is a blocking defect.

## §3 — The MCP holds no procedure

Tools in `@domusops/mcp` expose capabilities. Workflow, sequencing, and
judgement live in skills. Conditional workflow logic in an MCP tool is
rejected on principle.

## §4 — Compression is a contract, not an optimisation

Every tool returning data from a live instance returns it sized for an
agent's context window. Raw passthrough of Home Assistant API responses is a
defect. Each tool documents its compression ratio; CI asserts a floor.

## §5 — Public schema, private judgement

`@domusops/schema` is public and stable. Paid packages depend on it; it
never depends on them.

## §6 — Trademark hygiene

DomusOps never uses the Home Assistant name or logo in its own branding,
package names, logos, or domains. Compatibility is expressed nominatively
only: "for Home Assistant".

## §7 — Destructive operations are opt-in

`ha_call` and any mutating tool default to `dry_run: true`. No global
override.

## §8 — Version support is proven, not claimed

CI runs the sandbox against current stable, previous stable, and current
beta. The supported-version matrix in the README is generated from CI
results, never hand-written.

## §9 — Trunk-based, always releasable

`main` is always releasable. Feature branches live under three days. Every
user-visible change carries a changeset. Packages version independently.

## §10 — Sell convenience, not secrecy

Paid distribution is access and continuous updates, not obfuscation. If a
feature's value depends on the source never leaking, it is the wrong
feature.
