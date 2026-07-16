# Incremental vector indexing specification

**Status:** approved for local implementation on 2026-07-16. No upstream PR or push is authorized.

## Objective

Make vector indexing truly incremental, retry-safe, and bounded in disk growth.

- An unchanged second reindex creates no vector jobs and performs no LanceDB write.
- A changed chunk creates exactly one versioned job per embedding model.
- Crashes may retry work but cannot create duplicate logical vector rows.
- SQLite remains canonical; LanceDB remains derived and rebuildable.

## Current facts

The live database is `/home/dump/.arra-oracle-v2/oracle.db`. It is healthy (`PRAGMA integrity_check = ok`) and currently has 1,700 chunk rows, 1,452 live rows, and 1,700 bge-m3 manifest rows.

The current architecture has two unsynchronised LanceDB writers:

1. `src/scripts/index-model.ts` embeds canonical FTS text directly, writes LanceDB, then writes `vector_index_manifest`.
2. `src/indexer/daemon.ts` consumes `indexing_jobs`, embeds and writes LanceDB, but does not update the manifest. Its former implementation discarded computed vectors and used `addDocuments`; a local patch passes the vector but still does delete-then-add with empty text and reduced metadata.

`src/indexer/reindex-state.ts` currently compares raw parser content to `GROUP_CONCAT(oracle_fts.content)`. Stored FTS content is enriched with search expansions, so unchanged documents can be marked changed. `GROUP_CONCAT` also lacks a stable per-document identity/order.

## Non-goals

- Do not recreate `oracle.db`.
- Do not delete LanceDB internal directories.
- Do not introduce Redis, Temporal, or an external queue.
- Do not change search API contracts or embedding models.

## Target ownership

```text
vault/inbox -> SQLite + FTS sync -> vector job reconciliation -> indexing_jobs
                                                               -> daemon -> LanceDB
                                                                          -> manifest
```

The daemon is the **only normal LanceDB writer**. Cron and learn-watcher only sync canonical content and reconcile jobs. `index-model.ts` becomes enqueue/reconcile-only, or recovery-only and excluded from cron.

## Canonical vector source

Create `src/indexer/vector-source.ts` with one source builder used by reconciliation, daemon, and repair tooling:

```ts
type CanonicalVectorSource = {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
  contentHash: string;
};
```

It must join current `oracle_documents` and canonical FTS content for one active, vector-eligible chunk; include the existing canonical metadata (`type`, `source_file`, `concepts`, `tenant_id`, optional `project`); and compute the existing `vectorContentHash` over exactly the embedded payload. It must not use `GROUP_CONCAT`.

## Durable job identity

Migrate `indexing_jobs` to add:

```sql
content_hash TEXT NOT NULL,
operation TEXT NOT NULL DEFAULT 'upsert', -- upsert | delete
lease_expires_at INTEGER,
available_at INTEGER NOT NULL
```

Add:

```sql
CREATE UNIQUE INDEX idx_indexing_jobs_identity
ON indexing_jobs(model_key, doc_id, content_hash, operation);

CREATE INDEX idx_indexing_jobs_claim
ON indexing_jobs(model_key, status, available_at, lease_expires_at, created_at);

CREATE UNIQUE INDEX idx_vector_manifest_model_chunk
ON vector_index_manifest(model_key, chunk_id);
```

The deterministic job ID is SHA-256 of `modelKey + operation + chunkId + contentHash`. The composite unique index is authoritative.

Migration requirements:

1. Create a Drizzle migration; do not execute raw schema DDL from runtime code.
2. Back up the live DB before applying it.
3. Give historical rows non-equivalent `legacy:<id>` hashes so history is preserved without claiming that an old job matches current content.
4. Confirm there are no duplicate `(model_key, chunk_id)` manifest rows before its unique index.

## Reconciliation

Replace `DocSnapshot`, `snapshotActiveIndexerDocs`, `changedDocumentIds`, and `needsVectorJob(... changed)` in `reindex-state.ts` with desired-state reconciliation after SQLite/FTS writes commit.

For each active canonical vector source and model:

1. Calculate its current canonical hash.
2. Compare it with the manifest row for `(model, chunk)`.
3. If equal, create no job.
4. If different, insert or reactivate a pending `upsert` job for that exact hash.
5. For manifest chunks no longer active, queue a `delete` job.

A content sequence `h1 -> h2 -> h1` must reactivate `h1` if the manifest currently records `h2`; plain `INSERT OR IGNORE` is insufficient.

## Worker and LanceDB behavior

A worker atomically claims available or expired-lease jobs. Before embedding, it reloads the canonical source.

- Missing source or hash mismatch: mark the job obsolete; do not write.
- Upsert: embed canonical text, then batch-write full canonical documents with precomputed vectors.
- Delete: delete the Lance row for the chunk.
- After LanceDB succeeds, one SQLite transaction updates/deletes manifest state and marks the job done.

Use LanceDB `mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll()` in batches, not delete-then-add. This avoids a missing-vector window and makes retry idempotent. Do not mark a job done before the Lance write. If a crash occurs after LanceDB but before SQLite completion, retrying the same stable identity is safe.

Run LanceDB `optimize` only via a supported scheduled/threshold maintenance path, never by manually deleting `_versions`, `_transactions`, or `_deletions`.

## File plan

| File | Change |
| --- | --- |
| `src/db/schema.ts` + new Drizzle migration | durable-job columns and indexes |
| `src/indexer/vector-source.ts` | canonical payload and hash |
| `src/indexer/reindex-state.ts` | desired-state reconciliation |
| `src/indexer/index.ts` | reconcile after SQLite/FTS sync |
| `src/indexer/jobs.ts`, `worker.ts`, `daemon.ts` | leases, obsolete state, batch worker |
| `src/indexer/vector-index-manifest.ts` | manifest commit after worker success |
| `src/vector/adapters/lancedb.ts` | batch `upsertDocuments` using mergeInsert |
| `src/scripts/index-model.ts`, `~/.hermes/scripts/oracle-index.sh` | eliminate direct cron LanceDB writes |

## Required regression tests

1. FTS enrichment: unchanged source rerun queues zero jobs.
2. One changed chunk queues one job; unchanged chunks do not queue.
3. Repeated/concurrent reconcile has one job identity.
4. `h1 -> h2 -> h1` reactivates the correct job.
5. Claimed stale hash becomes obsolete without embedding.
6. Same Lance upsert twice yields one row with current payload and no second embedding.
7. Crash after Lance write but before SQLite completion retries safely.
8. Supersession/deletion removes both Lance row and manifest row.
9. Two unchanged cron runs produce zero new jobs and zero Lance writes on run two.

## Verification evidence

- 2026-07-16: `bun run build` passed.
- 2026-07-16: focused queue, worker, daemon-dispatch, hardening, and reconciliation tests passed (33 assertions suites; 0 failures).
- 2026-07-16: `0041_incremental_vector_jobs` was first tested on a disposable DB copy, then applied to the live canonical DB after a timestamped pre-migration backup; `PRAGMA integrity_check = ok`.
- 2026-07-16: two live `index-model.ts bge-m3` reconciliation runs each reported `queued: 0`, `skipped: 1700`, and `failed: 0`; the queue stayed `done:1452` and no daemon was started.
- The repository-wide test command has unrelated environment failures because spawned child tests cannot resolve `bun` in PATH; the focused acceptance suite is clean.

## Work protocol and recovery

Work in small verified milestones. At each milestone: update this spec's status/checkpoint, run scoped tests plus `bun run tsc --noEmit`, save a Hermes Oracle handoff, and commit only after tests pass. If context compacts, resume from this file first, then inspect `git status`, the migration state, and `TODO` checklist below.

## Checklist

- [ ] Baseline captured; no migration applied
- [ ] Schema migration and migration tests
- [ ] Canonical source and desired-state reconciliation
- [ ] Idempotent daemon/Lance batch upsert
- [ ] Cron changed to queue-only
- [ ] End-to-end unchanged-twice proof
- [ ] Local commit, no push or PR
