# DomusOps — Project Seed

> Input document for `/speckit.constitution` and the first `/speckit.specify`.
>
> Feed this file to Claude Code when initialising the Spec Kit pipeline. It is
> the single source of truth for what DomusOps is, what it refuses to be, and
> the rules that govern every artifact in the repository.

---

## 1. Product definition

**DomusOps is a GitOps toolkit for Home Assistant.**

It treats a Home Assistant installation the way a platform team treats
production infrastructure: declared in version control, validated in CI, tested
against an ephemeral replica, and migrated deliberately rather than by hand.

### What it is for

The Home Assistant user who has accumulated three years of hand-edited YAML,
cannot safely upgrade, has no test environment, and has no idea what would break
if they did.

### What it is not

- Not a Home Assistant fork, distribution, or replacement.
- Not a hosted service. Everything runs on the user's machine.
- Not a device integration. DomusOps never talks to hardware.
- Not affiliated with, endorsed by, or branded after Home Assistant or Nabu Casa.

### Positioning statement

> GitOps toolkit **for** Home Assistant.

Nominative use only. The Home Assistant name and logo are registered trademarks
and must never appear in DomusOps branding, package names, logos, or domain
names.

---

## 2. Architecture — three planes

The separation is the core design decision. Collapsing these planes is the
failure mode to avoid.

### 2.1 Capability plane — the MCP server

`@domusops/mcp`. Verbs against a live Home Assistant instance. Boring, stable,
opinion-free. Reusable from Claude Code, Cursor, Codex, or any MCP client.

| Tool | Contract |
|---|---|
| `ha_snapshot` | Full inventory — entities, devices, integrations, areas, HACS components, core version — returned in a compressed, templated form rather than raw JSON. |
| `ha_logbook_query` | Filtered, compacted history over a time window and entity set. |
| `ha_trace` | Automation trace retrieval, compacted. |
| `ha_config_check` | Invokes Home Assistant's own configuration validation. |
| `ha_diff` | Snapshot versus desired repository state, or instance A versus instance B. |
| `ha_call` | Service call. `dry_run` defaults to true. |

**Compression is the differentiator, not a nice-to-have.** A raw snapshot of a
mature instance blows the context window. A templated one does not. This is
where prior work on log compression transfers directly.

The MCP holds no procedure. Adding workflow logic here is how projects end up
with forty tools nobody understands.

### 2.2 Judgement plane — skills

Markdown plus scripts. Cheap to iterate. This is where expertise lives.

**Free (public repo):**

- `ha-bootstrap` — zero to an opinionated baseline: repository layout,
  `packages/`, secrets via SOPS/age, correct `.gitignore` for HA, pre-commit
  hooks, CI.

**Paid (`domusops-pro`):**

- `ha-migrate` — inventory an existing hand-built instance, generate the
  equivalent GitOps repository, and **verify parity** against the original.
  This is the flagship. Nobody has solved it well.
- `ha-upgrade-audit` — check for breaking changes against release notes before
  upgrading.
- `ha-secrets-audit` — scan git history for leaked credentials.

### 2.3 Verification plane — the sandbox

`@domusops/sandbox`. Ephemeral Home Assistant in Docker, plus virtual devices,
plus seeded scenarios.

**Do not rebuild the virtual-device layer.** It exists and works:

- `twrecked/hass-virtual` — virtual entities via config flow.
- Virtual Test Devices — creates virtual devices for testing automations without
  touching hardware, and can clone a real device's capabilities. Verified
  against the HA 2026.8 beta.
- `pytest-homeassistant-custom-component` — extracts HA core's testing plugins,
  updated daily against each release, for component-level unit tests.
- `presence_simulation` — replays historical entity states with a configurable
  day delta.

**The differentiated layer sits on top:** scenario seeding (weekday morning,
empty house, power outage), time control, and declarative assertions:

```yaml
scenario: hallway_night_motion
given:
  time: "03:00"
  presence.house: away
when:
  binary_sensor.hallway_motion: on
then:
  - light.hallway: { state: on, brightness_pct: 15 }
  - media_player.living_room: { state: off }
```

That assertion DSL is what does not exist anywhere. It lives in
`@domusops/schema`, public, as an open contract.

---

## 3. Constitution — non-negotiable principles

These are the articles to encode via `/speckit.constitution`. They are
non-negotiable: an agent may not waive, reinterpret, or scope-limit them.

### §1 — English-only artifacts

Every artifact committed to this repository is written in English. This covers
source code, identifiers, comments, commit messages, branch names, pull request
titles and bodies, specifications, plans, tasks, documentation, README files,
CHANGELOG entries, error messages, log strings, test names, and issue text.

Spanish is the conversational language between the maintainer and the coding
agent. It is **never** the language of an artifact.

This principle is enforced mechanically by a `PreToolUse` hook
(`guard-language.sh`), which blocks the write and returns the reason. The hook
is the authority; this article explains why it exists.

**Rationale:** the project is distributed internationally, accepts external
contributions, and is indexed by search engines in English. A bilingual
codebase is a defect.

### §2 — Specification precedes implementation

No implementation begins without a spec in `specs/`, a plan, and a task list.
`/speckit.analyze` runs before `/speckit.implement`, always. Drift between
spec, plan, and tasks is a blocking defect, not a nuisance.

### §3 — The MCP holds no procedure

Tools in `@domusops/mcp` expose capabilities. Workflow, sequencing, and
judgement live in skills. A pull request that adds conditional workflow logic to
an MCP tool is rejected on principle.

### §4 — Compression is a contract, not an optimisation

Every tool that returns data from a live instance returns it in a form sized for
an agent's context window. Raw passthrough of Home Assistant API responses is a
defect. Each tool documents its compression ratio, and CI asserts a floor.

### §5 — Public schema, private judgement

`@domusops/schema` is public and stable. Paid packages depend on it; it never
depends on them. This direction is what allows modules to be opened or closed
later without a refactor.

### §6 — Trademark hygiene

DomusOps never uses the Home Assistant name or logo in its own branding, package
names, logos, or domains. Compatibility is expressed nominatively only:
"for Home Assistant". Marketing copy avoids the home-network-monitoring framing
occupied by Domotz.

### §7 — Destructive operations are opt-in

`ha_call` and any tool that mutates a live instance default to `dry_run: true`.
A user must explicitly opt out, per call. There is no global override.

### §8 — Version support is proven, not claimed

CI runs the sandbox against the current stable Home Assistant release, the
previous stable, and the current beta. The supported-version matrix in the
README is generated from CI results, never hand-written.

### §9 — Trunk-based, always releasable

`main` is always releasable. Feature branches live under three days. Every
user-visible change carries a changeset. Packages version independently.

### §10 — Sell convenience, not secrecy

Paid distribution is access and continuous updates, not obfuscation. No
anti-tamper, no obfuscated builds, no telemetry. If a feature's value depends on
the source never leaking, it is the wrong feature.

---

## 4. Technical constraints

| Constraint | Value |
|---|---|
| Language | TypeScript, strict mode, ES2023 target |
| Runtime | Node 22 LTS minimum |
| Package manager | pnpm, workspace protocol for internal deps |
| Test runner | Vitest |
| Versioning | Changesets, independent per package, `0.x` until the MCP surface stabilises |
| Licence (public) | Apache-2.0 |
| Licence (pro) | Commercial, non-redistributable |
| Node API surface | MCP TypeScript SDK; no direct HTTP to HA outside the client module |
| Secrets | SOPS + age. Plaintext secrets never reach the repository. |

---

## 5. First feature — input for `/speckit.specify`

Feed this section directly. Everything else in the backlog waits.

### Feature: `ha-snapshot`

**Problem.** An agent asked to reason about a Home Assistant installation has no
efficient way to see its current state. Fetching entity, device, and integration
registries produces tens of thousands of tokens of repetitive JSON, most of it
structurally identical across entities. The context window fills before any work
begins.

**Outcome.** A single MCP tool returns a complete, structurally faithful
inventory of a live instance in a form an agent can hold alongside a real task.

**User story.** As a Home Assistant user working with a coding agent, I invoke
one tool and the agent gains a full picture of my installation — every entity,
device, integration, area, and version — without exhausting its context.

**Functional requirements.**

1. Connect to a Home Assistant instance over the WebSocket API using a
   long-lived access token supplied by environment variable.
2. Retrieve the entity registry, device registry, area registry, config entries,
   and core version.
3. Emit a compressed representation that:
   - groups entities by integration and domain rather than listing each flatly;
   - factors repeated attribute structures into referenced templates;
   - elides default-valued fields;
   - preserves every entity ID, so nothing is lost.
4. Accept a `detail` parameter: `summary` (counts and topology only), `standard`
   (default), `full` (no compression, escape hatch).
5. Emit a `compression_ratio` field comparing the serialised raw payload against
   the emitted payload.
6. Never emit secrets: tokens, passwords, API keys, or coordinates. Redaction is
   applied before serialisation, not after.

**Non-functional requirements.**

- Completes in under five seconds against an instance with 1,000 entities.
- `standard` detail achieves at least a 10× compression ratio on a 500-entity
  instance. CI asserts this floor against a fixture.
- Read-only. The tool performs no mutation under any parameter combination.
- Fails loudly with an actionable message on auth failure, version mismatch, or
  unreachable host. Never returns a partial snapshot silently.

**Out of scope for this feature.** Diffing, writing, service calls, log
retrieval, the sandbox, and anything in `domusops-pro`.

**Acceptance criteria.**

- `npx @domusops/mcp` starts and registers `ha_snapshot` on a clean machine with
  only Node 22 installed.
- Against the maintainer's live instance, `ha_snapshot` returns a complete
  inventory with a recorded compression ratio.
- Round-trip test: every entity ID present in the raw registries is present in
  the compressed output.
- Redaction test: a fixture containing a token in an attribute produces output
  containing no substring of that token.

---

## 6. Backlog — after the first feature ships

Ordered. Each item is also an article.

1. `ha_logbook_query` and `ha_trace` — the same compression thesis applied to
   history and automation traces.
2. `ha-bootstrap` skill — the free funnel.
3. `@domusops/sandbox` — ephemeral HA plus the assertion DSL.
4. `ha_diff` — the GitOps core.
5. `ha-migrate` — the flagship paid skill. Ships only once the sandbox can prove
   parity.
6. `ha-upgrade-audit`, `ha-secrets-audit`.

---

## 7. Content pairing

Every merged feature ships with its article. Nothing merges without one. Drafts
live outside this repository; only the code and specs are committed here.

Publication is bilingual with Spanish first, and this is the **only** context in
which Spanish appears anywhere in the project. It never enters the repository.
