# Solution Architect Studio — Rough Plan

Status: **draft scoping, no implementation yet**
Owner persona: Yasmin Al-Rashid (`.claude/agents/solution-architect.md`)

## Goal

Give an engineer (or a PM sketching a proposal) a tool where the `solution-architect`
agent can turn a loose set of requirements and constraints into an architecture
design doc *with diagrams as first-class output* — not prose that happens to
mention a diagram. Input is a conversation or a short brief; output is a
versioned design doc (Markdown + rendered diagrams) an engineer can hand to a
reviewer or use as the starting point for actual Terraform/network work. The
tool is the harness around the agent — it doesn't replace Yasmin's judgment,
it gives her a place to capture constraints, generate diagrams reliably, and
keep prose and diagram in sync as the design evolves.

## V1 Scope: AWS only, single-region, greenfield

Pick **AWS Well-Architected designs** as the wedge, not a thin slice of all
three (Network / AWS / On-prem):

- AWS has the most standardized vocabulary (Well-Architected six pillars, VPC
  reference architectures) — easiest to build structured prompts and diagram
  templates against.
- Network and on-prem design require a much wider variety of unstated
  physical/organizational constraints (existing hardware, carrier contracts,
  compliance regimes) that are harder to capture with a generic input form.
- AWS-only still forces us to solve the hard parts generically: constraint
  capture, diagram generation, doc structure, review loop. Those generalize
  to Network/On-prem in V2 without rework.

V1 nails: single AWS account, single region, greenfield workload (not a
migration), producing a VPC/network diagram + a short Well-Architected
trade-off doc.

## Explicitly Out of Scope for V1

- Multi-region / multi-account AWS Organizations designs
- On-premise or hybrid topologies (no VPN/Direct Connect modeling)
- Non-AWS clouds (GCP, Azure)
- Cost estimation / pricing calculators
- Terraform/IaC code generation from the design (design doc only, not
  executable infra)
- Auth/multi-user review workflow (single-user, local-first for V1)

Note: **live canvas editing of diagrams is *not* out of scope indefinitely** —
it's promoted to V1.1 (see below), shipped immediately after V1's regenerate
-from-text loop is working. It's not V1 itself because it adds a second
editing surface (canvas), a JSON round-trip parser, and a reconciliation step
between edited-diagram and prose — that's a distinct chunk of work from "agent
drafts + mechanically renders," and V1's own milestone is explicitly defined
as "no manual diagram editing." Landing V1 first keeps the smallest useful
slice honest; V1.1 keeps the human-drew-it feedback loop from becoming a
someday-maybe.

## Core Components

1. **Constraint capture** — a short structured intake (compliance, budget
   ceiling, expected scale/RTO-RPO, existing constraints) as a Markdown/YAML
   frontmatter file the user fills in or dictates to the agent. This is the
   input Yasmin's persona already says she writes down before proposing a
   topology — the tool just gives it a durable, diffable home instead of
   living only in chat.
2. **Design generation step** — the agent (using the `solution-architect`
   persona) reads the constraints file and drafts: (a) a component list and
   topology decision, (b) explicit trade-off notes ("chose X over Y because
   Z"), (c) a diagram source (see below). This step is a prompt/skill, not
   new infra — no new service needed to "run" it beyond invoking the agent.
3. **Diagram rendering step** — turns diagram source text into a rendered
   artifact. Kept as a separate, mechanical step (not agent judgment) so
   diagrams stay reproducible and diffable in git.
4. **Output/review step** — assembles rendered diagram(s) + trade-off prose
   into one design doc, saved to the project's `docs/` (or wherever the
   consuming repo keeps ADRs), with a stable naming scheme so revisions are
   append-only-friendly (matches Oracle/Shadow "nothing is deleted"
   philosophy — supersede, don't overwrite).

Rough flow: `constraints.yaml` → agent drafts `design.md` (topology + trade-offs)
+ `diagram.mmd` → render step produces `diagram.svg`/`.png` → both assembled
into the final doc. Each artifact is plain text or a static image, so the
whole thing is diffable in git with no server/database needed for V1.

## Diagram Approach

**Mermaid**, rendered via `mmdc` (mermaid-cli) or the `Mermaid_Chart` MCP tool
already available in this environment — one line reason: Mermaid source is
plain text (diffable, agent-writable, no drawing UI needed) and this repo
already has a Mermaid rendering path wired up via MCP, so V1 needs zero new
rendering infrastructure. C4-model *conventions* (context/container/component
levels) inform how we structure the Mermaid diagrams, but C4-specific tooling
(PlantUML C4, Structurizr) is not adopted for V1 — Mermaid's `C4Context`
diagram type covers the first level well enough.

## V1.1: Canvas Round-Trip Editing

Ships immediately after V1. Purpose: when a human doesn't like part of a
generated diagram, they redraw it directly instead of writing prose feedback
and hoping the regeneration reproduces their intent.

**Canvas**: Excalidraw. One-line reason — it already has an open-source
`@excalidraw/mermaid-to-excalidraw` conversion path, so `diagram.mmd` becomes
an editable scene with zero new renderer to build; we're not evaluating other
canvas tools because this one removes the exact gap (Mermaid text has no
native drag-and-drop surface) at no new-infra cost, matching the same
"don't build what already exists" reasoning used to pick Mermaid itself.

**Round-trip mechanism**: a mechanical conversion step (not the LLM) reads the
edited Excalidraw scene JSON and extracts a normalized structured node/edge
list (labels, shape-to-shape connections, resolved bound text) — the same
"rendering/parsing is a deterministic step, not agent judgment" split already
used for Mermaid rendering. That structured list is written back out as the
new `diagram.mmd`, which stays the single authoritative, diffable diagram
source (per Diagram Approach above). The agent never parses raw Excalidraw
JSON directly — that JSON carries pixel coordinates, styling, and internal
element-version fields that are noise for semantic reasoning; feeding the
agent a regenerated Mermaid text keeps its input identical in shape to what
it already knows how to reason about, and avoids forking "diagram truth"
into two competing formats (canvas JSON vs `.mmd`).

**Trigger**: automatic, but only on committed edits, not on every mouse-drag
pixel movement. "Automatic" means the *mechanical* JSON-to-Mermaid extraction
and the diff/reconciliation-proposal computation both run on every discrete
edit-commit event (element deselect, edit-session end, or an equivalent
discrete state change the canvas already exposes) — never mid-drag or
per-frame. This is cheap and deterministic (same mechanical step described
above), so there's no reason to gate it behind a manual button. What stays
explicitly human-gated is the *acceptance* of any proposed `design.md` prose
change (see Prose reconciliation below) — the human never clicks "re-sync,"
but they still click "accept" before prose actually changes.

**Conflict resolution**: the human's edit always wins. If the reconciliation
diff finds that the edited diagram contradicts a stated constraint in
`constraints.yaml` or an existing trade-off note in `design.md` (e.g. moving
the DB out of the private subnet when a Security trade-off note assumed it
stayed there), the system does not block, reject, or auto-revert the edit —
the human is the final authority on the diagram. The contradiction is
surfaced visibly in the reconciliation proposal ("this moves the DB out of
the private subnet, which the Security trade-off note assumed") so it isn't
silently lost, but the flag is informational only and never a gate.

**Prose reconciliation**: editing the canvas alone does *not* silently
rewrite `design.md`. On every automatic reconciliation run, the agent diffs
old `diagram.mmd` vs regenerated `diagram.mmd`, identifies which topology/
trade-off statements in `design.md` reference a changed or removed component
(surfacing any conflicts per above), and proposes an updated trade-off
section for the human to accept — never an automatic silent overwrite,
because `design.md` is the ADR-like record of *why*, and only a human
confirms whether a moved component still honors the original reasoning.

**Edit history**: append-only, per Oracle/Shadow "nothing is deleted." Every
edit-commit event appends one line to `diagram-history.jsonl`, sitting
alongside `diagram.mmd` in the same design's output directory. One JSON
object per line:
`{"timestamp": "<ISO8601>", "diagram_diff": "<nodes/edges added, removed, or moved>", "conflicts_flagged": ["<contradicted constraint or trade-off note, if any>"], "prose_reconciliation_status": "proposed|accepted|rejected"}`.
Earlier entries are never rewritten or removed — a later edit appends a new
line, it doesn't touch prior ones. `diagram.mmd` itself stays a single
live file that's overwritten in place each time (it's the current
authoritative source, not a version chain), but `diagram-history.jsonl` is
the durable, queryable timeline of every edit and what the agent proposed
or the human accepted/rejected in response.

## Key Open Questions (need a human decision before building further)

- Where does a design doc "live" once produced — inside this monorepo (e.g.
  `projects/solution-architect-studio/output/`), or does the tool write into
  the *target* repo the design is for? This changes whether V1 needs any
  multi-repo write capability at all.
- Is this a CLI (`bun run design ...`) invoked ad hoc, a slash-command/skill
  layered on the existing agent, or a small HTTP service with its own
  routes? Affects whether Bun/Elysia conventions apply at all, or whether
  this is closer to a skill + agent persona with no server.
- Should constraint capture be a form (structured file the human edits) or a
  conversational intake the agent runs and then serializes? Affects whether
  V1 needs any UI at all.
- Does "review" mean a human just reads the Markdown, or do we need any diff/
  approval mechanism (e.g. PR-based) for V1?
- Version/naming scheme for design docs as constraints change — supersede
  files (`design-v2.md`) or single evolving file with a changelog section?

(Conflict resolution, edit history, and reconciliation-trigger granularity
for V1.1 canvas editing were open questions here — all three are now
resolved; see the V1.1 mechanism section above for the decisions.)

## First Milestone ("done" for the smallest useful slice)

Given a filled-in `constraints.yaml` describing one greenfield AWS workload
(e.g. "public web app + RDS, must be HA within one region, budget-conscious"),
running the tool produces, with no manual diagram editing:

1. `design.md` — topology decision + a trade-offs section citing at least the
   Reliability and Cost Optimization pillars explicitly.
2. `diagram.mmd` — a Mermaid VPC/network diagram (subnets, AZs, key managed
   services) referenced by `design.md`.
3. A rendered `diagram.svg` from that source, viewable without opening a
   Mermaid editor.

Success = a second person unfamiliar with the request can read `design.md` +
diagram and understand what was decided and why, without needing to ask the
agent follow-up questions about the topology itself (open questions about
process/tooling are fine to leave outstanding).

## V1.1 Milestone ("done" for the smallest useful canvas-editing slice)

Given a V1 output (`design.md` + `diagram.mmd` + `diagram.svg`) already on
disk, a human opens the diagram in Excalidraw, moves one box (e.g. relocates
the RDS instance out of the private subnet group) and/or edits its label,
then deselects it (ends the edit — no manual re-sync click needed). Success:

1. `diagram.mmd` is regenerated automatically from the edited scene and
   reflects the moved component with no other nodes/edges lost or corrupted.
2. A new line is appended to `diagram-history.jsonl` recording the edit's
   timestamp and diff summary.
3. `design.md`'s trade-off section gets a proposed update (not silently
   applied) referencing the moved component's new placement — it does not
   sit silently stale pointing at the old topology, and the human must
   accept before the prose actually changes.
4. If the move contradicts a stated constraint or an existing trade-off
   note, that contradiction shows up in the proposal — it does not block
   the edit itself.
5. Nothing else in `design.md` changes — the reconciliation step touches
   only the prose tied to the edited component, not an unrelated
   regeneration of the whole doc.
