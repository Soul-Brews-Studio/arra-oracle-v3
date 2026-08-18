# Oracle101 Phase-C Semantic Repair Design

## Goal

Restore the 62 independent Oracle101 Phase-C facts that were incorrectly marked
superseded solely because they shared a `source_file`, and make that failure mode
detectable before it can be applied again.

## Evidence and root cause

- The Phase-C source artifacts contain 85 distinct records: 80 Oracle101 facts
  and 5 global rules.
- FTS content has already been restored and matches the committed extraction
  artifacts. Document/FTS parity is healthy.
- Exactly 62 rows carry the historical reason
  `Phase 2 chunk dedup: same source_file, keeping primary chunk`.
- Those rows span 11 source references and point to 11 surviving rows. Their
  bodies are distinct; for example, `Nothing is Deleted` and `Cold God / Warm
  God` express different principles.
- No current production code performs source-file-only dedup. The supported
  consolidation worker requires high lexical cosine and FTS overlap. The bad
  state came from a historical direct maintenance operation.

## Chosen approach

Use a narrow, reversible repair command in the arra owner repository.

1. Dry-run is the default and builds a deterministic plan from the committed
   Phase-C JSONL artifacts plus the connected database.
2. The plan fails closed unless all 85 artifacts match the 85 Phase-C rows and
   FTS bodies, and unless the bad set is exactly 62 rows with the known reason.
3. Apply requires an explicit `--apply` and a new backup path. It creates and
   integrity-checks a consistent SQLite backup before opening the transaction.
4. One transaction clears only `superseded_by`, `superseded_at`, and
   `superseded_reason` for the frozen 62-row set.
5. Postconditions require 85 active Phase-C rows, zero rows with the historical
   reason, unchanged document/FTS counts, and unchanged FTS content hashes.
6. A regression test feeds distinct same-source Oracle101 facts to the shipped
   consolidation worker and requires zero consolidation plans.

Direct ad-hoc SQL is rejected because it has no artifact reconciliation,
backup gate, drift check, or reusable regression proof. A full corpus rebuild is
also rejected because the content and FTS rows are already correct and a rebuild
would expand the mutation surface to IDs, vectors, entities, and pointers.

## Interfaces

`buildOracle101PhaseCRepairPlan(sqlite, artifactDir)` returns a deterministic
plan containing the 62 IDs, database fingerprint, artifact fingerprint, and
pre-repair counts. It performs no writes.

`applyOracle101PhaseCRepair(sqlite, plan, artifactDir)` re-builds the live plan,
requires its fingerprints to match, applies the update in one transaction, and
returns the verified postconditions.

The CLI accepts:

```text
bun scripts/repair-oracle101-phase-c.ts \
  --db <oracle.db> \
  --artifacts <directory> \
  [--apply --backup <new-backup.db>]
```

## Safety and rollback

- Dry-run opens the database read-only.
- Apply refuses an existing backup target.
- Backup integrity and the 85-row artifact/FTS match are mandatory.
- Candidate drift between planning and apply aborts before mutation.
- The transaction changes only the three supersede columns.
- Rollback is replacement of the database with the verified pre-apply backup.

## Acceptance criteria

- RED/GREEN regression proves same-source distinct facts are not consolidation
  candidates.
- Planner fixture reports 62 candidates and refuses altered artifacts, wrong
  counts, wrong reasons, missing FTS, inbound supersede pointers, or active
  targets that drifted.
- Apply fixture restores 62 rows and preserves all other row fields and FTS.
- Live dry-run reports exactly 62 candidates before apply.
- Live apply creates a valid backup and reports 85 active Phase-C rows.
- Fresh searches return `Nothing is Deleted`, `External Brain`, and
  `scope restart to failure` without a superseded marker.
- FTS remains 1:1 with `oracle_documents`; vector drift does not increase.

## Out of scope

- Adding missing CH06B content; that is a separate source-refresh operation.
- Vector rebuild or drain.
- MAW identity/inventory repair.
- General-purpose unsupersede functionality.
