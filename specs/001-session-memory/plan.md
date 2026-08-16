# Plan — technical approach

Companion to [spec.md](spec.md). Phase 1 is deliberately small: one PR, shippable, and useful on its
own even if nothing after it is built.

Three design workflows (schema, summary layer, lesson promotion) were run in parallel; where their
synthesis contradicts anything here, the synthesis wins and this file gets updated rather than
quietly diverging.

---

## Architecture

```
/opt/data/.lens/all.db      2.68 GB   ATTACH ... AS lens (READ ONLY)   owned by jsonl-lens
oracle.db                    105 MB   the existing Oracle, unchanged in size
  └─ summaries + summary_log + lesson rows        small, mutable, backed up with the Oracle
```

The large corpus is **attached, never copied** (spec Q4). The Oracle's own file gains only small
rows. This is what keeps N2 (backup cost) and N3 (#2996 blast radius) true by construction rather
than by discipline.

### Why attach rather than import

Copying 1,031,567 beats duplicates 2.68 GB and creates a second source of truth that can drift.
`all.db` is a **rebuildable export** — if it is wrong, `just export-turso` fixes it. Attaching keeps
exactly one copy of the conversation data and makes a bad import unfixable-by-restore into
fixable-by-regenerate.

The cost is a coupling: the Oracle needs `all.db` present to answer session queries. Phase 1 handles
its absence by degrading — session tools report unavailable, everything else works.

---

## Phase 1 — read-only session search (one PR)

Ships R1, R2, R3. No writes, no summaries, no new tables in `oracle.db`.

| File | Purpose | Budget |
|---|---|---|
| `src/sessions/attach.ts` | open `all.db` read-only, health-check it, degrade cleanly when absent | ≤80 |
| `src/sessions/query.ts` | `bySession(id)`, `byTimeRange(from,to)`, `searchTurns(q)` | ≤120 |
| `src/tools/sessions.ts` | MCP tools + TypeBox params, matching `src/tools/*.ts` conventions | ≤150 |
| `src/tools/index.ts` | register (one line) | +1 |
| `src/sessions/__tests__/*.test.ts` | one behaviour per file | — |

**MCP surface (phase 1):**

- `oracle_session_get` — `{ sessionId, limit?, offset? }` → turns, ordered by `seq`
- `oracle_session_search` — `{ query, project?, from?, to?, limit? }` → matching turns with
  `session_id` + `ts`
- `oracle_session_list` — `{ project?, since?, limit? }` → sessions with beat counts

**The performance question that must be answered in this PR:** FTS5 over 1M beats is
**unproven** (proof.md is explicit about this). Before adding an index, measure `LIKE` on the
existing `beats_session_idx` / `beats_project_idx` paths. If a scoped query is fast enough, ship
without a new index; a 2.68 GB source does not obviously want a second full-text copy beside it.
`jsonl-lens` already offers `just search` (FTS5 from an export) — prefer wiring that to rebuilding it.

---

## Phase 2 — summaries with provenance

Ships R4–R9. Gated on spec **Q2** (is a summary an `oracle_document`?).

**If Q2 = yes** — the recommended path, and much smaller:

- a summary is a row in `oracle_documents` with the new type, `createdBy` = the summarising agent,
  and a pointer to `session_id`
- supersession, tenant scoping, FTS and the web UI come free via `schema.ts:19-21` and
  `src/routes/supersede/`
- new work reduces to: one MCP write tool, one list route, one UI page
- the "summarised?" flag becomes a **derived query** (does an active summary row exist for this
  session id?) rather than a stored column that can drift

**If Q2 = no** — the proof's shape becomes real tables (`summaries`, `summary_log`) in a sidecar,
and supersession/UI/tenant handling are re-implemented. Strictly more code for the same behaviour.

`created_by` must be a **required tool parameter** unless Q5 resolves — inferring an identity that
is not actually available would silently degrade R5 to "unknown".

---

## Phase 3 — trace → lesson promotion

Ships R10, R11.

The core change is small and specific: complete `distillTrace` (`src/trace/status.ts:6-16`) so it
creates a lesson document and returns the `learningId` its signature already promises, following the
working pattern at `src/huginn/capture.ts:210`.

Then the category (spec Q3). Two properties matter more than the name itself:

1. **An agent must guess it unprompted**, at the *start* of a task — a category discovered only
   after repeating a mistake has failed at its one job.
2. **It must be distinguishable from the 6,843 existing `learning` rows**, or it adds a dimension
   without adding an answer.

If the design cannot articulate what a lesson has that a learning lacks — a rule, a trigger, an
anti-pattern, evidence — then the honest outcome is *no new category*, and the work is better spent
making the existing 6,843 more findable.

---

## Sequencing and risk

Phase 1 is independent and safe: read-only, one new directory, no schema change, no migration.
Phases 2 and 3 each depend on a decision, not on each other — either can go first.

| Risk | Mitigation |
|---|---|
| FTS5 over 1M rows is slow or huge | measure before indexing; reuse `just search` |
| `all.db` missing on a machine | degrade: session tools report unavailable, Oracle unaffected |
| a live session is still being appended to | phase 1 is read-only, so a partial read is stale, never corrupt |
| the new category is never queried | decide Q3 on discoverability; be willing to conclude "no new category" |
| `created_by` unavailable over MCP | make it a required parameter (Q5) |

---

## Gate

Every PR: `bunx tsc --noEmit` clean · `bun test --isolate` on the touched directories ·
`tests/build/` (250-line ratchet + CI tier coverage) green. Schema changes via
`src/db/schema.ts` + `bun db:push` — never raw DDL.
