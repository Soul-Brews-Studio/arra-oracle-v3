# Thai FTS acceptance — 2026-10-02

Implementation is based on `fix/indexer-bulk-store` at `210ec01e`.
No push was performed. No commit SHA exists: branch creation failed because the
sandbox marks `.git` read-only. Changes are uncommitted on the base branch, per the
requested fallback. `bun.lock` was already modified and is excluded from this work.

```text
fatal: cannot lock ref 'refs/heads/fix/fts-thai-segmentation': Unable to create '/Users/admin/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3-alpha/.git/refs/heads/fix/fts-thai-segmentation.lock': Operation not permitted
```

## Build and tests (verbatim summaries)

Build command: `ORACLE_DATA_DIR=/private/tmp/fts-thai-acceptance/dev-data bun run build`
Exit status: 0.

```text
$ tsc --noEmit
```

Full suite command on each version: `env -u ORACLE_DISABLE_LOCAL_VECTOR ORACLE_DATA_DIR=<isolated-temp-dir> bun test src`.
The baseline was exported directly with `git archive fix/indexer-bulk-store` and
uses the same installed dependencies. The temp data override protects live data.

Base:

```text
 1052 pass
 22 skip
 29 fail
 2 errors
 1 snapshots, 2987 expect() calls
Ran 1103 tests across 218 files. [83.68s]
```

Changed version:

```text
 1061 pass
 22 skip
 29 fail
 2 errors
 1 snapshots, 3043 expect() calls
Ran 1112 tests across 221 files. [77.78s]
```

Failure names are identical; no new failures. The 0-fail acceptance requirement
is **not met** in this environment. Failures include forbidden localhost listeners,
proxy/server tests, watcher events, and existing vault/config checks. Both versions
also report two errors. Full logs are in `/private/tmp/fts-thai-acceptance/`.

Focused command: `bun test src/search/ src/indexer/__tests__/storage- src/server/__tests__/search-fts-query.test.ts src/server/__tests__/vector-indexer-source.test.ts tests/workers/entity-backfill.test.ts tests/vector/bge-m3-drift-benchmark.test.ts`
(with isolated `ORACLE_DATA_DIR`). It covers the nine added Thai/original-text tests,
English stemming, token boundaries, bulk equivalence/rollback and read-only loaders.

```text
src/indexer/__tests__/storage-bulk-rollback.test.ts:
Skipping vector indexing (SQLite-only mode)

 57 pass
 0 fail
 239 expect() calls
Ran 57 tests across 18 files. [796.00ms]
```

## Index rebuild (complete verbatim output)

Command: `ORACLE_DATA_DIR=$HOME/.arra-oracle-v3-thai ORACLE_DISABLE_LOCAL_VECTOR=1 /usr/bin/time -p bun run index --repo-root "$HOME/hello-oracle"`
Exit status: 0. Only the isolated Thai DB was rebuilt; the command queued jobs there
but skipped vector embedding. Existing live/control DBs were read with `sqlite3 -readonly`.

```text
$ bun src/indexer/cli.ts --repo-root /Users/admin/hello-oracle
[Indexer] Detected project: (universal)
Starting Oracle indexing...
📦 DB backup: /Users/admin/.arra-oracle-v3-thai/oracle.db.backup-2026-10-02T00-44-35-120Z
📄 JSON export: /Users/admin/.arra-oracle-v3-thai/oracle.db.export-2026-10-02T00-44-35-120Z.json (0 docs)
📊 CSV export: /Users/admin/.arra-oracle-v3-thai/oracle.db.export-2026-10-02T00-44-35-120Z.csv (0 rows)
Indexed 987 resonance documents from 47 files (skipped 0 duplicate files)
[indexer] unknown document type "process" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "lesson-learned" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
Indexed 5385 learning documents from 2359 files (skipped 0 duplicate files)
Indexed 0 retrospective documents from 0 files (skipped 0 duplicate files)
Indexed 0 distillation documents from 0 files (skipped 0 duplicate files)
[indexer] unknown document type "shared-learning-note" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "synthesis" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "moc" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "index" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "shared-learning-queue" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "hub" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
Indexed 12998 ψ/learn documents from 1699 files (skipped 0 duplicates)
[indexer] unknown document type "reference" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "feedback" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
[indexer] unknown document type "project" — using "learning" instead. Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type will be demoted on every reindex.
Indexed 7462 ψ/inbox documents from 1021 files (skipped 3 duplicates)
Indexed 711 vault-extra documents from 163 files (skipped 0 duplicates)
Chunked 27543 source documents into 79143 index chunks
Smart delete: 0 stale docs (preserving oracle_learn)
stored 1000/79143 chunks
stored 2000/79143 chunks
stored 3000/79143 chunks
stored 4000/79143 chunks
stored 5000/79143 chunks
stored 6000/79143 chunks
stored 7000/79143 chunks
stored 8000/79143 chunks
stored 9000/79143 chunks
stored 10000/79143 chunks
stored 11000/79143 chunks
stored 12000/79143 chunks
stored 13000/79143 chunks
stored 14000/79143 chunks
stored 15000/79143 chunks
stored 16000/79143 chunks
stored 17000/79143 chunks
stored 18000/79143 chunks
stored 19000/79143 chunks
stored 20000/79143 chunks
stored 21000/79143 chunks
stored 22000/79143 chunks
stored 23000/79143 chunks
stored 24000/79143 chunks
stored 25000/79143 chunks
stored 26000/79143 chunks
stored 27000/79143 chunks
stored 28000/79143 chunks
stored 29000/79143 chunks
stored 30000/79143 chunks
stored 31000/79143 chunks
stored 32000/79143 chunks
stored 33000/79143 chunks
stored 34000/79143 chunks
stored 35000/79143 chunks
stored 36000/79143 chunks
stored 37000/79143 chunks
stored 38000/79143 chunks
stored 39000/79143 chunks
stored 40000/79143 chunks
stored 41000/79143 chunks
stored 42000/79143 chunks
stored 43000/79143 chunks
stored 44000/79143 chunks
stored 45000/79143 chunks
stored 46000/79143 chunks
stored 47000/79143 chunks
stored 48000/79143 chunks
stored 49000/79143 chunks
stored 50000/79143 chunks
stored 51000/79143 chunks
stored 52000/79143 chunks
stored 53000/79143 chunks
stored 54000/79143 chunks
stored 55000/79143 chunks
stored 56000/79143 chunks
stored 57000/79143 chunks
stored 58000/79143 chunks
stored 59000/79143 chunks
stored 60000/79143 chunks
stored 61000/79143 chunks
stored 62000/79143 chunks
stored 63000/79143 chunks
stored 64000/79143 chunks
stored 65000/79143 chunks
stored 66000/79143 chunks
stored 67000/79143 chunks
stored 68000/79143 chunks
stored 69000/79143 chunks
stored 70000/79143 chunks
stored 71000/79143 chunks
stored 72000/79143 chunks
stored 73000/79143 chunks
stored 74000/79143 chunks
stored 75000/79143 chunks
stored 76000/79143 chunks
stored 77000/79143 chunks
stored 78000/79143 chunks
stored 79000/79143 chunks
Skipping vector indexing (SQLite-only mode)
Indexed 79143 chunks (SQLite + FTS5)
Queued 237429 vector job(s); skipped 0
Indexing complete!
Indexing complete!
real 64.16
user 43.90
sys 15.13
```

## Query-builder counts (complete verbatim output)

Command: `bun scripts/check-thai-fts.ts "$HOME/.arra-oracle-v3-thai/oracle.db" "$HOME/.arra-oracle-v3-rebuild/oracle.db" "$HOME/.arra-oracle-v2/oracle.db"`
Exit status: 0. All Thai FTS/LIKE ratios exceed 0.8; all English counts meet the live
baseline. For ภาษาไทย the new builder emits `"ภาษา ไทย"`, which explains why the
old control returns 2 instead of the earlier unsegmented-query count of 32.

```text
NEW /Users/admin/.arra-oracle-v3-thai/oracle.db
chunks=79143
ภาษาไทย MATCH="ภาษา ไทย" FTS=215 LIKE=212 ratio=1.0142 matched_like=212
บัญชี MATCH="บัญชี" FTS=741 LIKE=742 ratio=0.9987 matched_like=741
ยิ้ม MATCH="ยิ้ม" FTS=2999 LIKE=2858 ratio=1.0493 matched_like=2858
โปรแกรม MATCH="โปรแกรม" FTS=109 LIKE=113 ratio=0.9646 matched_like=109
deploy MATCH="deploy" FTS=3638 LIKE=3828 ratio=0.9504 matched_like=3200
memory MATCH="memory" FTS=25003 LIKE=9323 ratio=2.6819 matched_like=9323
docker MATCH="docker" FTS=1132 LIKE=984 ratio=1.1504 matched_like=933
OLD-CONTROL /Users/admin/.arra-oracle-v3-rebuild/oracle.db
chunks=78048
ภาษาไทย MATCH="ภาษา ไทย" FTS=2 LIKE=206 ratio=0.0097 matched_like=0
บัญชี MATCH="บัญชี" FTS=298 LIKE=728 ratio=0.4093 matched_like=298
ยิ้ม MATCH="ยิ้ม" FTS=370 LIKE=2753 ratio=0.1344 matched_like=335
โปรแกรม MATCH="โปรแกรม" FTS=13 LIKE=107 ratio=0.1215 matched_like=13
deploy MATCH="deploy" FTS=3552 LIKE=3750 ratio=0.9472 matched_like=3125
memory MATCH="memory" FTS=24775 LIKE=9172 ratio=2.7012 matched_like=9172
docker MATCH="docker" FTS=1121 LIKE=974 ratio=1.1509 matched_like=923
LIVE-READONLY /Users/admin/.arra-oracle-v2/oracle.db
chunks=78219
ภาษาไทย MATCH="ภาษา ไทย" FTS=2 LIKE=206 ratio=0.0097 matched_like=0
บัญชี MATCH="บัญชี" FTS=298 LIKE=728 ratio=0.4093 matched_like=298
ยิ้ม MATCH="ยิ้ม" FTS=371 LIKE=2759 ratio=0.1345 matched_like=336
โปรแกรม MATCH="โปรแกรม" FTS=13 LIKE=107 ratio=0.1215 matched_like=13
deploy MATCH="deploy" FTS=3557 LIKE=3756 ratio=0.9470 matched_like=3130
memory MATCH="memory" FTS=24775 LIKE=9172 ratio=2.7012 matched_like=9172
docker MATCH="docker" FTS=1121 LIKE=974 ratio=1.1509 matched_like=923
English deploy: NEW=3638 LIVE=3557 PASS
English memory: NEW=25003 LIVE=24775 PASS
English docker: NEW=1132 LIVE=1121 PASS
```

The new corpus has 79,143 chunks; the old control has 78,048 and live has 78,219.
Literal Thai recovery (`matched_like / LIKE`) is 100%, 99.87%, 100%, and 96.46%.
Ratios above one include extra FTS matches (concepts, stems or mark equivalence).

The watcher HTTP suite was also compared: 4 pass / 4 fail on both versions
(7.39s changed, 7.38s base); failures are the same event-wait timeouts.

## Remaining work

- Re-run the full suite where localhost servers and watcher events are permitted;
  investigate the baseline vault/config failures separately.
- Create `fix/fts-thai-segmentation` and commit after `.git` becomes writable,
  excluding `bun.lock`. No push or live DB migration is authorized/performed here.
- For later rollout, back up the target DB, migrate, then reindex with this Bun/ICU
  version. Re-ingest preserved manual rows separately (see `fts-thai.md`).
- Investigate the five remaining literal Thai misses if further recall is needed;
  dictionary segmentation and unicode61 mark equivalence still limit precision/recall.
