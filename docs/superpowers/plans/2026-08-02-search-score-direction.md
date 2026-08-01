# Search Score-Direction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore descending relevance order across FTS, vector, and hybrid Oracle search.

**Architecture:** Preserve a single higher-is-better score contract at the fusion boundary. Prove
the contract first with focused regressions, make two surgical production edits, then validate a
copied real corpus and audit every downstream score conversion.

**Tech Stack:** Bun 1.3, TypeScript, `bun:test`, SQLite FTS5, LanceDB.

## Global Constraints

- Work only on `fix/search-score-direction` in the isolated worktree.
- Point every `ORACLE_*` test path at `/tmp`; never mutate live SQLite, Lance, config, or index.
- Do not push, apply, deploy, or restart any process.
- Keep each changed source, test, and documentation file at or below 250 lines.

---

### Task 1: Lock score direction with fast regressions

**Files:**
- Modify: `src/tools/__tests__/search.test.ts`
- Create: `src/tools/__tests__/search-ranking-direction.test.ts`

**Interfaces:**
- Consumes: `normalizeFtsScore`, `handleSearch`, `combineResults`, `attachSearchEvidence`.
- Produces: executable assertions for FTS order, vector order, fusion arithmetic, and confidence.

- [ ] Correct the existing BM25 assertion so `-10` scores above `-5`, above `-1`.
- [ ] Build a two-row in-memory FTS5 corpus and assert mapped order equals `ORDER BY rank`.
- [ ] Mock vector distances `[0.1, 0.7]` through `handleSearch` and assert the near result wins
  with `cosineDistanceToSimilarity(0.1)` in provenance.
- [ ] Assert one hybrid result has exact score `0.73` from FTS `0.5`, vector `0.7`, and pointer
  `0.2`, and exposes high confidence.
- [ ] Run the focused file before production edits and preserve the failing output as RED.

### Task 2: Correct the two inversions

**Files:**
- Modify: `src/tools/search/helpers.ts`
- Modify: `src/tools/search/handler.ts`

**Interfaces:**
- Consumes: raw SQLite FTS5 rank and vector-leg similarity.
- Produces: bounded higher-is-better values for `combineResults`.

- [ ] Change `normalizeFtsScore` to `1 - exp(-0.3 * max(0, -rank))`, returning zero for
  non-finite input.
- [ ] Pass `vecResults` directly into `combineResults` without `1 - score`.
- [ ] Run the fast regressions and existing search helper suite until GREEN.

### Task 3: Add and run the copied-corpus golden regression

**Files:**
- Create: `src/tools/__tests__/search-ranking-golden.test.ts`

**Interfaces:**
- Consumes: `ORACLE_GOLDEN_DATA_DIR`, copied `oracle.db`, copied `lancedb`, and `handleSearch`.
- Produces: English/Thai target top-k evidence on the real corpus snapshot.

- [ ] Reject unset or non-temp snapshot paths; skip only when the opt-in env is absent.
- [ ] Open copied SQLite and the `oracle_knowledge_bge_m3` Lance table.
- [ ] Read the target vector from the copied table and use it as the deterministic query embedding.
- [ ] Assert the target is top-5 for `exit-loop playbook` and
  `บังคับปลายทางให้ automation capture` in hybrid mode.
- [ ] Copy the live DB and Lance directory to a fresh `/tmp` root, run the test there, and retain
  the command/output as golden GREEN evidence.

### Task 4: Sweep invariants, verify, and stage the handoff

**Files:**
- Create: workspace report under `ψ/outbox/` outside the source worktree.

**Interfaces:**
- Consumes: final diff, tests, typecheck, pointer/entity/confidence/rerank source sites.
- Produces: disposition table, deploy/rollback proposal, local commit SHA, and CROO callback.

- [ ] Audit each score/distance conversion and record whether it changed or is already correct.
- [ ] Run scoped new/existing tests, `bun run build`, file-length checks, and diff/debug scans.
- [ ] Commit locally with no push, then verify live checkout HEAD/status remain unchanged.
- [ ] Write the acceptance report with RED/GREEN transcripts and `lesson_candidate`.
- [ ] Send the exact `maw hey` RETURN line with status, branch, SHA, and report path.
