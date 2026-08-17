# Oracle (arra-oracle-v3) — operations runbook

Format: `rules/oracle-runbook-standard.md` (claude-config-repo). Every command
below was executed and verified during the 2026-08-16/17 incident recovery.

## 1. Identity & layout

- Live checkout: `~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3` (branch `alpha`)
- Publish surface: `git@github.com:TTT3P/arra-oracle-v3.git` (remote `fork`;
  upstream Soul-Brews-Studio is 403 for the TTT3P account)
- Runtime: `bun src/server.ts` on port **47778** (spawned by `bun run server:ensure`);
  find it with `lsof -iTCP:47778 -sTCP:LISTEN`
- Data dir: `~/.arra-oracle-v2/` — `oracle.db` (SQLite, WAL), `lancedb/` (vectors),
  `exports/` (backup bundles + rescue journals), auto pre-run backups `oracle.db.backup-*`
- Vector sidecar (TINE-approved 2026-08-17): `bun run vector` (read-only
  vector-server) on port **8081**, log `~/.arra-oracle-v2/vector-server.log`;
  core proxies to it via `.env` `VECTOR_URL=http://localhost:8081`. This powers
  the hosted vector/compare/map Studio pages (`/api/compare` 308→`/api/v1/compare`).
  Install its per-user boot/login job once with `bun run vector:install-launchagent`.
  The generated `com.tt3p.arra-vector` LaunchAgent uses `RunAtLoad`, restarts
  failed exits, and keeps logs under `~/.arra-oracle-v2/`. Find the live listener
  with `lsof -iTCP:8081 -sTCP:LISTEN`.
- Config: repo `.env` (gitignored) — `OLLAMA_BASE_URL=http://127.0.0.1:11434`,
  `ORACLE_EMBEDDING_MODEL=bge-m3`, `VECTOR_URL=http://localhost:8081`;
  DB `settings` row `canonical_source_root` =
  `/Users/trirongyinwichapoon/tt3p/agent-hub/orchestrator-vnext`; tenant `default`
- Embeddings: local Ollama, model `bge-m3` (`ollama list` must show it)
- PATH requirement: the server process must start with a **functional git**
  (Homebrew git, e.g. `/opt/homebrew/bin/git`) on PATH — `git --version` must
  succeed. The `/usr/bin/git` Xcode stub without CLT breaks the project
  auto-scope git-origin fallback, which then fails closed to project=NULL
  (detectProject fix `7a0ed079`, 2026-08-17).

## 2. Health

```sh
curl -s http://127.0.0.1:47778/api/health
# expect: status=ok, state=healthy, db=connected, embedderStatus.status=connected, vectorStatus=ok
sqlite3 -readonly ~/.arra-oracle-v2/oracle.db "PRAGMA integrity_check;"   # expect: ok
```
MCP-side: `oracle_stats` — fts_status healthy, vector_status connected.

## 3. Restart

```sh
kill -TERM $(lsof -tiTCP:47778 -sTCP:LISTEN)
# vector sidecar (one-time install): bun run vector:install-launchagent
cd ~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3 && bun run server:ensure
```
`server:ensure` is start-only (no stop/restart flag); env comes from repo `.env`.

## 4. Data operations

- Retros-only reindex (non-pruning, released; re-executed 2026-08-17):
  ```sh
  curl -s -X POST http://127.0.0.1:47778/api/v1/indexer/reindex \
    -H 'content-type: application/json' \
    -d '{"repoRoot":"/Users/trirongyinwichapoon/tt3p/agent-hub/orchestrator-vnext","scope":"retros","wait":true}'
  # expect: {"success":true,…,"status":"complete","ok":true,…}
  ```
  `repoRoot` is REQUIRED here: omitting it resolves to the server's own repo
  checkout, not the canonical source root, and indexes 0 documents.
- Vector drain: `bun src/scripts/index-model.ts bge-m3 --incremental`
  (`--dry-run` first; NEVER run concurrently with another DB writer — a
  concurrent write loses the final manifest and forces a full re-embed)
- **HELD/gated:** `scope=all` full indexer and any destructive prune. Prune
  requires canonical root + active-only plan + exact `--confirm-delete=<n>` +
  direct TINE approval. NEVER run `src/indexer/cli.ts` with a narrowed
  `--repo-root` expecting a scoped delete — see the 2026-08-16 post-mortem
  (`learning_2026-08-16_post-mortem-oracle-db-smart-delete-incident-2026-2`).

## 5. Backup & restore

Two backup types with one-to-one restore paths — do not mix them:

**Type A — export bundle** (integrity-verifiable archive; contains `backup.sql`,
manifest, checksums). Produce + verify:
```sh
bun tools/export-app/index.ts --output ~/.arra-oracle-v2/exports/<name> --db ~/.arra-oracle-v2/oracle.db
bun tools/export-app/index.ts --verify ~/.arra-oracle-v2/exports/<name>    # expect verified:true
chmod -R a-w ~/.arra-oracle-v2/exports/<name>
```
A bundle-import/restore has **never been executed** — treat bundles as verified
off-site evidence, NOT as the operational restore path (open item, section 8).

**Type B — `.db` backup** (`oracle.db.backup-*` auto pre-run copies). This is
the ONLY proven restore path (executed 2026-08-16 incident recovery):
```sh
kill -TERM $(lsof -tiTCP:47778 -sTCP:LISTEN)
lsof ~/.arra-oracle-v2/oracle.db*        # GATE: must print NOTHING (any other
                                         # holder, e.g. an indexer, must exit first)
sqlite3 <backup.db> ".backup '$HOME/.arra-oracle-v2/oracle.db'"
cd ~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3 && bun run server:ensure
```
Then re-run section 2 and compare counts — they must match exactly:
```sh
sqlite3 -readonly <backup.db> "SELECT count(*) FROM oracle_documents;"
sqlite3 -readonly ~/.arra-oracle-v2/oracle.db "SELECT count(*) FROM oracle_documents;"
```

## 6. Fresh install

```sh
git clone git@github.com:TTT3P/arra-oracle-v3.git && cd arra-oracle-v3 && git checkout alpha
bun install
printf 'OLLAMA_BASE_URL=http://127.0.0.1:11434\nORACLE_EMBEDDING_MODEL=bge-m3\n' > .env
ollama pull bge-m3
bun run server:ensure
curl -s http://127.0.0.1:47778/api/health   # expect: status=ok, state=healthy
```
Then restore the newest `.db` backup via the Type B procedure (section 5 —
the only proven restore path) or reindex from the canonical root, and drain
vectors (section 4). Finish by re-running section 2 health checks.

## 7. Policies & holds

- **No hard-delete, permanently** (TINE R0, 2026-08-17): supersede is the only
  retirement path; gated prune is exceptional TINE-approved maintenance only.
  Decision record: `learning_2026-08-17_decision-tine-r0-2026-08-17-oracle-has-no-har`
- Current recovery/hold state lives in the Oracle recovery-state learning chain
  (search: "recovery state canonical source root", project orchestrator-vnext).

## 8. Escalation

- R0: hard-delete, anything irreversible → TINE only. R1: live-DB mutations,
  restores, publishes → staged + independent review (riddler) + rollback.
  R2: code fixes with tests → direct.
- History: post-mortem above; rescue evidence journal + bundles in
  `~/.arra-oracle-v2/exports/`.
- Open item: no proven bundle-import procedure for Type A exports — until one
  is executed and recorded here, disaster restore depends on `.db` backups.
- Classified limitation (2026-08-17): the FTS health gap is confined to legacy
  `created_by=zhuge`, `type=principle` rows (23 active and 62 superseded at the
  time of audit). No owning importer exists in this repository. Do not patch
  `oracle_fts` directly; re-open only with an owner-backed ingestion path.
