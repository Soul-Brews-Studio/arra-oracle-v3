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
- Config: repo `.env` (gitignored) — `OLLAMA_BASE_URL=http://127.0.0.1:11434`,
  `ORACLE_EMBEDDING_MODEL=bge-m3`; DB `settings` row `canonical_source_root` =
  `/Users/trirongyinwichapoon/tt3p/agent-hub/orchestrator-vnext`; tenant `default`
- Embeddings: local Ollama, model `bge-m3` (`ollama list` must show it)

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
cd ~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3 && bun run server:ensure
```
`server:ensure` is start-only (no stop/restart flag); env comes from repo `.env`.

## 4. Data operations

- Retros-only reindex (non-pruning, released):
  `POST http://127.0.0.1:47778/api/v1/indexer/reindex {"repoRoot":"<canonical>","scope":"retros","wait":true}`
- Vector drain: `bun src/scripts/index-model.ts bge-m3 --incremental`
  (`--dry-run` first; NEVER run concurrently with another DB writer — a
  concurrent write loses the final manifest and forces a full re-embed)
- Full export bundle over HTTP: `POST /api/v1/export/engine/run` (engine route;
  `/export/run` is the history job recorder)
- **HELD/gated:** `scope=all` full indexer and any destructive prune. Prune
  requires canonical root + active-only plan + exact `--confirm-delete=<n>` +
  direct TINE approval. NEVER run `src/indexer/cli.ts` with a narrowed
  `--repo-root` expecting a scoped delete — see the 2026-08-16 post-mortem
  (`learning_2026-08-16_post-mortem-oracle-db-smart-delete-incident-2026-2`).

## 5. Backup & restore

Produce + verify a bundle (proven rollback artifact):
```sh
bun tools/export-app/index.ts --output ~/.arra-oracle-v2/exports/<name> --db ~/.arra-oracle-v2/oracle.db
bun tools/export-app/index.ts --verify ~/.arra-oracle-v2/exports/<name>    # expect verified:true
chmod -R a-w ~/.arra-oracle-v2/exports/<name>
```
Restore SQLite from a `.db` backup (proven 2026-08-16, lock-respecting):
```sh
kill -TERM $(lsof -tiTCP:47778 -sTCP:LISTEN)
sqlite3 <backup.db> ".backup '$HOME/.arra-oracle-v2/oracle.db'"
cd ~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3 && bun run server:ensure
```
Then re-run section 2 and confirm document counts against the backup's manifest.

## 6. Fresh install

```sh
git clone git@github.com:TTT3P/arra-oracle-v3.git && cd arra-oracle-v3 && git checkout alpha
bun install
printf 'OLLAMA_BASE_URL=http://127.0.0.1:11434\nORACLE_EMBEDDING_MODEL=bge-m3\n' > .env
ollama pull bge-m3
bun run server:ensure
```
Then restore the newest verified bundle (section 5) or reindex from the
canonical root, and drain vectors (section 4).

## 7. Policies & holds

- **No hard-delete, permanently** (TINE R0, 2026-08-17): supersede is the only
  retirement path; gated prune is exceptional TINE-approved maintenance only.
  Decision record: `learning_2026-08-17_decision-tine-r0-2026-08-17-oracle-has-no-har…`
- Current recovery/hold state lives in the Oracle recovery-state learning chain
  (search: "recovery state canonical source root", project orchestrator-vnext).

## 8. Escalation

- R0: hard-delete, anything irreversible → TINE only. R1: live-DB mutations,
  restores, publishes → staged + independent review (riddler) + rollback.
  R2: code fixes with tests → direct.
- History: post-mortem above; rescue evidence journal + bundles in
  `~/.arra-oracle-v2/exports/`.
