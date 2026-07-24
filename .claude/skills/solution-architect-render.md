# Solution Architect Render Skill

Turn a filled-in `constraints.yaml` into a reviewable architecture design doc
with a real rendered diagram — no manual diagram editing required for V1.

## Trigger Phrases

- "design the architecture for..."
- "draft a solution architecture doc"
- "render the diagram" / "render the design"
- "new AWS design for..."

## Workflow

### 1. Constraint capture

Either the human hands over a filled `constraints.yaml`, or the
`solution-architect` persona (Yasmin Al-Rashid) runs a short conversational
intake and writes the same file. Either path produces one authoritative file:

```
projects/solution-architect-studio/output/<slug>/constraints.yaml
```

`<slug>` is a short kebab-case name for the workload (e.g. `public-web-app-rds`).

### 2. Draft the design (agent step, not scripted)

Invoke the `solution-architect` subagent with the constraints file. It writes:

- `output/<slug>/design.md` — topology decision + explicit trade-offs
  (must cite at least two AWS Well-Architected pillars by name)
- `output/<slug>/diagram.mmd` — a Mermaid diagram of the topology

This step is agent judgment — don't template or auto-generate it mechanically.

### 3. Render the diagram (mechanical step)

```bash
cd projects/solution-architect-studio
bun run render <slug>
```

Produces `output/<slug>/diagram.svg` from `diagram.mmd` via `mmdc`
(`@mermaid-js/mermaid-cli`). If `mmdc` can't fetch its bundled Chromium
(no network), `src/render.ts` falls back to a local system Chrome/Chromium
install via `PUPPETEER_EXECUTABLE_PATH`.

Same rendering also available over HTTP for local tooling integration:
`POST http://127.0.0.1:<port>/render/<slug>` (localhost-only, no auth — see
`src/server.ts`).

### 4. Review

Everything lives in this monorepo under `projects/solution-architect-studio/`.
Open a PR against this repo like any other change — a human reviews the diff
(`design.md` + `diagram.mmd` + `diagram.svg`) and approves before merge.
Never auto-merge.

### 5. Revising a design

If constraints change, supersede — write `design-v2.md` (next available
version), never overwrite `design.md` in place. Old versions stay, per this
repo's Oracle/Shadow "nothing is deleted" philosophy.

## Critical Rules

1. **Never skip step 4** — a generated design doc is a draft until a human
   reviews the PR diff, same as any other change to this repo.
2. **Never overwrite a design doc** — supersede with a new version file.
3. **The render step is mechanical** — don't let the agent hand-edit
   `diagram.svg` directly; it's always regenerated from `diagram.mmd`.
