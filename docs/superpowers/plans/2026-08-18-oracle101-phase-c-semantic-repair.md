# Oracle101 Phase-C Semantic Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore 62 incorrectly superseded Oracle101 facts with a fail-closed, backed-up migration and prevent source-file-only semantic dedup from recurring unnoticed.

**Architecture:** Add a pure planner that reconciles the committed Phase-C JSONL artifacts with DB metadata and FTS, then a transactional applier guarded by a verified SQLite backup and plan fingerprint. Add a consolidation regression using real distinct same-source facts.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Bun test, SQLite FTS5.

**Spec:** `docs/superpowers/specs/2026-08-18-oracle101-phase-c-semantic-repair-design.md`

## Global Constraints

- No new dependencies.
- Dry-run is the default.
- Apply must fail closed on any artifact, metadata, FTS, count, pointer, or fingerprint drift.
- The live mutation may change only `superseded_by`, `superseded_at`, and `superseded_reason` for the frozen 62 IDs.
- No vector, entity, pointer, source-file, or document-content writes.

---

### Task 1: Lock the consolidation regression

**Files:**
- Modify: `tests/workers/consolidation-worker.test.ts`

**Interfaces:**
- Consumes: `runConsolidationWorker(db, sqlite, { dryRun: true })`
- Produces: regression coverage that distinct facts sharing one source never produce a consolidation plan.

- [ ] Add a test that inserts the real `Nothing is Deleted` and `Cold God / Warm God` bodies with the same type, tenant, and source file.
- [ ] Run `bun test tests/workers/consolidation-worker.test.ts` and confirm the new test passes against current similarity-based consolidation.
- [ ] Temporarily alter the fixture bodies to be identical and confirm the test fails because one plan appears; restore the distinct fixture and re-run green.

### Task 2: Build the fail-closed repair planner

**Files:**
- Create: `src/maintenance/oracle101-phase-c-repair.ts`
- Create: `tests/maintenance/oracle101-phase-c-repair.test.ts`

**Interfaces:**
- Produces: `buildOracle101PhaseCRepairPlan(sqlite: Database, artifactDir: string): Oracle101PhaseCRepairPlan`
- Produces: `Oracle101PhaseCRepairDenied` with a list of failed invariants.

- [ ] Write fixture helpers that seed 85 artifact records, matching document/FTS rows, and 62 historical supersede edges.
- [ ] Write a failing test expecting a deterministic 62-ID plan with artifact and DB fingerprints.
- [ ] Implement JSONL loading, SHA-256 canonical fingerprints, metadata/FTS reconciliation, exact-count checks, active-target checks, and inbound-pointer denial.
- [ ] Add failing cases for modified artifact content, missing FTS, wrong historical reason, candidate count drift, and an inbound pointer; implement only the validation needed to pass each case.
- [ ] Run `bun test tests/maintenance/oracle101-phase-c-repair.test.ts` with zero failures.

### Task 3: Add verified backup and transactional apply

**Files:**
- Modify: `src/maintenance/oracle101-phase-c-repair.ts`
- Modify: `tests/maintenance/oracle101-phase-c-repair.test.ts`

**Interfaces:**
- Produces: `createVerifiedSqliteBackup(sqlite: Database, backupPath: string): BackupReceipt`
- Produces: `applyOracle101PhaseCRepair(sqlite: Database, plan: Oracle101PhaseCRepairPlan, artifactDir: string): Oracle101PhaseCRepairResult`

- [ ] Write a failing test that apply refuses a missing or pre-existing backup target.
- [ ] Implement consistent SQLite backup creation to a new path and verify `PRAGMA integrity_check = ok` plus document/FTS counts.
- [ ] Write a failing test that plan drift aborts before mutation.
- [ ] Implement live-plan recomputation and fingerprint equality before `BEGIN IMMEDIATE`.
- [ ] Write a failing test that apply restores 62 rows while metadata, FTS content, and total counts remain byte-equivalent.
- [ ] Implement the three-column update and postconditions in one transaction; roll back on any failure.
- [ ] Run the maintenance test file and confirm all cases pass.

### Task 4: Add the operator CLI

**Files:**
- Create: `scripts/repair-oracle101-phase-c.ts`
- Modify: `package.json`
- Create: `tests/maintenance/oracle101-phase-c-cli.test.ts`

**Interfaces:**
- Consumes: planner, backup, and applier from Task 2/3.
- Produces: `bun run repair:oracle101-phase-c -- --db ... --artifacts ... [--apply --backup ...]`.

- [ ] Write CLI tests proving default read-only dry-run, required apply backup, refusal of unknown flags, and JSON result shape.
- [ ] Implement strict argument parsing and open SQLite with `readwrite: false` for dry-run.
- [ ] Add `repair:oracle101-phase-c` to `package.json`.
- [ ] Run CLI tests and the maintenance module tests.

### Task 5: Rehearse and apply to the live owner DB

**Files:**
- Runtime artifact only: a new `oracle.db.backup-oracle101-phase-c-<timestamp>` beside the live DB.

**Interfaces:**
- Consumes: Zhuge artifacts at `~/tt3p/agent-hub/zhuge-oracle/data` and live DB at `~/.arra-oracle-v2/oracle.db`.
- Produces: 85 active Phase-C rows and a verified rollback database.

- [ ] Run the CLI dry-run against live DB and require `candidates=62`, `phaseC=85`, `ftsMatched=85`.
- [ ] Apply once with a new explicit backup path.
- [ ] Re-run dry-run and require it to report an already-repaired state with zero historical bad rows, not attempt a second mutation.
- [ ] Query document/FTS parity, active counts, bad-reason count, and SQLite integrity directly.
- [ ] Search three restored principles and require no superseded marker.
- [ ] Compare vector pending count before/after and require no increase caused by this metadata-only repair.

### Task 6: Full verification and review

**Files:**
- Review all files changed in Tasks 1-4.

**Interfaces:**
- Produces: evidence that source, tests, build, and live state satisfy the spec.

- [ ] Run targeted maintenance and consolidation tests.
- [ ] Run `bun run build`.
- [ ] Run the repository unit test command with the live data/vector environment isolated as required by the test harness.
- [ ] Review the diff for mutation scope, error semantics, comments, naming, and rollback accuracy.
- [ ] Confirm the working tree contains no generated DB, backup, or artifact files.
