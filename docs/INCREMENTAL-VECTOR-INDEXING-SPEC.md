# Incremental vector indexing

**Status:** implemented on the `fix/indexer-has-indexing-jobs-table` branch. The branch is under upstream review; this document describes the shipped design and its verification contract.

## Objective

Keep vector indexing incremental, retry-safe, and bounded:

- An unchanged reconciliation creates no jobs and performs no LanceDB write.
- A changed active chunk creates one versioned `upsert` job per embedding model.
- A canonical chunk that becomes inactive creates one durable `delete` job per model.
- SQLite/FTS is canonical; LanceDB and `vector_index_manifest` are derived and rebuildable.
- Crashes may retry a job but cannot create duplicate logical vector rows.

## Ownership and flow

```text
vault / inbox
  -> CLI or API source sync (SQLite + FTS)
  -> canonical-vector reconciliation
  -> indexing_jobs (durable SQLite queue)
  -> daemon (only normal LanceDB writer)
  -> LanceDB + vector_index_manifest receipt
```

`src/scripts/index-model.ts` is queue reconciliation only. It never embeds or writes LanceDB directly; it reports `writer: "daemon"`. Cron and learn-watcher may produce canonical content and reconcile jobs, but the daemon owns vector writes.

## Canonical payload and identity

`src/indexer/vector-source.ts` builds one canonical vector payload for reconciliation and daemon work. The content hash covers the exact embedded text and stable metadata.

A queue identity is unique by:

```text
(model_key, doc_id, content_hash, operation)
```

`operation` is `upsert` or `delete`. A unique SQLite index is authoritative; repeated or concurrent reconciliation cannot insert duplicate logical jobs. Claimed jobs have a finite lease so a replacement daemon can reclaim work after a crash.

## Reconciliation rules

1. Load the complete active canonical vector set for each configured model.
2. If a manifest hash equals the canonical hash, skip it.
3. If it differs, enqueue/reactivate an `upsert` for that exact hash.
4. If a manifest receipt is outside the complete active set, enqueue a durable `delete`.
5. The daemon reloads canonical source before embedding. A missing source or hash mismatch becomes obsolete work and is not written.

Step 4 is intentionally part of full-scope `index-model.ts` reconciliation. It also sweeps historical supersessions created before delete-aware queueing existed. It does not delete LanceDB storage directly.

## Worker behavior

The daemon claims a small FIFO batch atomically. It separates `upsert` and `delete` work:

- **Upsert:** batch embed canonical text, then batch-upsert full documents with precomputed vectors.
- **Delete:** remove the LanceDB row for each chunk.
- Only after the LanceDB operation succeeds does one SQLite transaction update/delete manifest receipts and mark jobs done.
- A retry after a process crash is safe because writes use a stable document identity and the vector adapter is idempotent.

A transient SQLite `SQLITE_BUSY` while CLI reindex overlaps queue claiming is logged as a deferred poll; it must not terminate the daemon.

## Operations

Use the lifecycle wrapper or equivalent service manager:

```bash
arra-oracle-ctl reindex       # disk -> SQLite/FTS, then full vector reconciliation
arra-oracle-ctl index         # full vector reconciliation only
arra-oracle-ctl index --repair # explicit durable re-upsert of every active chunk after vector-store recovery
arra-oracle-ctl daemon status
```

A production supervisor (systemd, launchd, supervisord, or a container restart policy) is responsible for immediate process restart. The daemon's durable queue/lease design makes restart safe.

For a no-change corpus, expected reconciliation output is:

```json
{"queued":0,"failed":0,"writer":"daemon"}
```

and queue status should have no `pending`, `claimed`, or `error` jobs. `skipped` equals the number of active canonical vector chunks when all manifests match.

## Safety boundaries

- Do not recreate the SQLite database for normal recovery.
- Do not manually delete LanceDB internal files or transaction/version directories.
- Do not mark a job done before its LanceDB operation succeeds.
- Use the Drizzle migration path for schema changes; back up before applying migrations.

## Verification contract

Required regression coverage:

1. Unchanged source rerun queues zero jobs.
2. Changed chunk queues one versioned `upsert`.
3. Repeated/concurrent reconciliation preserves one job identity.
4. A historical manifest outside the active canonical set queues one durable `delete` and does not duplicate it on rerun.
5. A stale claimed payload is not embedded.
6. Repeated Lance upsert remains one current vector row.
7. A crash between LanceDB and SQLite receipt retry is safe.
8. Delete completion removes both LanceDB row and manifest receipt.
9. A SQLite lock during daemon claim defers polling rather than stopping the daemon.

Before operational rollout, verify `PRAGMA integrity_check`, daemon health, queue state, and manifest/live-chunk counts against the configured database. Historical cleanup is complete only when manifests for inactive chunks are zero after the daemon drains the queued deletes.
