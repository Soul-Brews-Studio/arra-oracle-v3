# Oracle (arra-oracle-v3) — operations runbook

Format: `rules/oracle-runbook-standard.md` (claude-config-repo). The launchd-only operational path
(sections 1–3, 5–6) is current as of 2026-08-21, including `/api/health/live`. Not every command was
freshly re-executed on this date — dated inline citations trace each fact to when it was proven;
several still trace to 2026-08-16/17, and Type A bundle-restore (section 5) is still unexecuted. If a procedure changes, this file changes in the same commit.

## 1. Identity & layout

- Live checkout: `~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3` (branch `alpha`)
- Publish surface: `git@github.com:TTT3P/arra-oracle-v3.git` (remote `fork`;
  upstream Soul-Brews-Studio is 403 for the TTT3P account)
- Runtime: `bun src/server.ts` on port **47778**, owned by launchd as
  `com.tt3p.arra-oracle` (installed 2026-08-18 via `bun run server:install-launchagent`;
  RunAtLoad + KeepAlive, logs `~/.arra-oracle-v2/oracle-server.log`). The plist
  sets PATH with `/opt/homebrew/bin` so the git-origin project fallback works
  (launchd's default PATH lacks it). `bun run server:ensure` remains a no-op
  starter when the agent is already serving; find the listener with
  `lsof -iTCP:47778 -sTCP:LISTEN`
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

- **Liveness ≠ freshness** (ORA-SHARED-20260820-06): `embedderStatus`/`vectorStatus`
  above are connectivity checks only — "can the server reach Ollama/the
  vector engine", not "is the vector index current". `vector.freshness.lastIndexed`
  is computed from SQLite (`MAX(oracle_documents.indexed_at)` joined to FTS),
  **not** from `vector_index_manifest` — a document indexed a minute ago can
  make this field look fresh while the vector side is stale for hours.
  `vector.freshness.docsPending`/`docsExtra` (`src/vector/health.ts:125-140`)
  are an **aggregate count** comparison (`source.docs` vs `max(engine counts)`),
  membership-blind — a coarse drift signal, not exact per-document freshness.
  For an exact answer, compare source↔manifest↔engine ID sets directly. On the
  :8081 sidecar, `/health`'s `ready` field (`src/vector/proxy-server.ts:29-35`)
  means "the store finished initializing — `connect()`+`ensureCollection()`
  succeeded once" — set BEFORE the first actual `/vectors/*` operation runs,
  not after one succeeds. A fresh restart legitimately shows `ready:false`
  until something touches the store; that alone is not a fault.

## 3. Restart

```sh
launchctl kickstart -k gui/$(id -u)/com.tt3p.arra-oracle    # server (launchd-owned)
launchctl kickstart -k gui/$(id -u)/com.tt3p.arra-vector    # vector sidecar
```
Installs (idempotent, but **not symmetric** — verified 2026-08-21 by reading both scripts in full
plus reproducing the divergent branch): `bun run server:install-launchagent` ·
`bun run vector:install-launchagent` (`scripts/install-server-launchagent.sh` /
`install-vector-launchagent.sh`).
- **Server**: always `bootout`s a currently-loaded job (or kills an
  unmanaged listener on the port), then unconditionally `bootstrap`s +
  `kickstart -k`s and polls `/api/health/live` (15s) before failing loud
  with the log path to inspect.
- **Vector**: `bootout`s a currently-loaded job the same way, **but if not
  currently loaded AND something already listens on the port, it prints
  "scheduled: … will start at next login; existing listener retained" and
  exits 0 without bootstrap/kickstart/health-poll.** Reproduced directly
  (fake label + scratch stub listener, no real launchd job touched): the
  `elif lsof -tiTCP:"$PORT"` branch fires and returns before `bootstrap`.
  If the sidecar looks "not adopted" after installing, check whether
  something else already owns port 8081 first.

**Stop without auto-respawn.** Both LaunchAgents set
`KeepAlive.SuccessfulExit=false` (confirmed live, 2026-08-21 — `plutil -p`
on both `com.tt3p.arra-oracle.plist` and `com.tt3p.arra-vector.plist` in
`~/Library/LaunchAgents/`), so launchd restarts the job on any terminating
nonzero exit — a bare `kill` (any signal that terminates the process
counts as nonzero) respawns it immediately instead of stopping it. To
actually take the job down (e.g. before swapping the DB file, section 5):
```sh
launchctl bootout gui/$(id -u)/com.tt3p.arra-oracle    # server
launchctl bootout gui/$(id -u)/com.tt3p.arra-vector    # vector sidecar
```
Bring back with the same install commands above — safe to re-run any time.
`bun run server:ensure` (section 1) is a manual, non-launchd dev-mode
starter only; it does not stop or replace the launchd-managed process and
must not be used as a restart path while launchd owns the job.

## 4. Data operations

- Agent `/rrr` ingest: use the MCP owner tool
  `oracle_index_retro({repoRoot, filePath})`. It accepts exactly one existing
  file under `<repoRoot>/ψ/memory/retrospectives/`, forces the bounded
  `retro-file` scope in HTTP-proxy mode, and never falls back to a full reindex.
  A session that cannot list this tool is stale and must restart before claiming
  the retrospective complete. The HTTP calls below are operator surfaces, not
  substitutes for an agent missing its MCP tool.
- Retros-only reindex (non-pruning, released; re-executed 2026-08-17):
  ```sh
  curl -s -X POST http://127.0.0.1:47778/api/v1/indexer/reindex \
    -H 'content-type: application/json' \
    -d '{"repoRoot":"/Users/trirongyinwichapoon/tt3p/agent-hub/orchestrator-vnext","scope":"retros","wait":true}'
  # expect: {"success":true,…,"status":"complete","ok":true,…}
  ```
  `repoRoot` is REQUIRED here: omitting it resolves to the server's own repo
  checkout, not the canonical source root, and indexes 0 documents.
- **Ingest is hybrid, not one path** (ORA-SHARED-20260820-06): `oracle_learn`'s
  default write embeds into the vector store **inline**, bypassing
  `vector_index_manifest` entirely. On any embedder error the ingest still
  reports `success:true` (the FTS write already landed) but sets
  `embedding:"failed"` + `embeddingError` in the tool response, plus a
  server-log warning (`src/tools/learn.ts:241-258`) — **not silent, but the
  caller must check the embedding field itself**; a caller that only checks
  `success` won't notice the vector side fell behind. Retro-index and full
  reindex are **FTS-only by design** —
  they call `storeDocuments(..., vectorClient=null, ...)` and never touch
  the vector store. Vector coverage for anything written through those
  paths only catches up via the manual sync below — there is no scheduler;
  this is an operator-owned step, not automatic.
- Vector drain: `bun src/scripts/index-model.ts bge-m3 --incremental`
  (`--dry-run` first; NEVER run concurrently with another DB writer — a
  concurrent write loses the final manifest and forces a full re-embed).
  **Set formulas, exact** (ORA-SHARED-20260820-06): `changed` = docs whose
  current source content-hash differs from (or is absent from)
  `vector_index_manifest` — what the dry-run reports it will embed. `stale`
  = manifest − current sync input, where current input = `oracle_documents`
  ⋈ `oracle_fts`; physical doc deletion OR missing FTS can produce stale.
  Supersede alone does not while both rows remain joined. `orphans` = rows
  physically in the vector engine but absent from the manifest (e.g. from
  `oracle_learn`'s inline path above) —
  **this sync tool does not see or touch orphans**; reconciling them needs a
  separate engine-vs-manifest comparison, not this command.
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

**Type B — `.db` backup** (`oracle.db.backup-*` auto pre-run copies). The
stop/swap/restart bracket below is launchd-consistent as of 2026-08-21
(section 3) — the DB-swap step itself is the ONLY proven restore path
(executed 2026-08-16 incident recovery):
```sh
launchctl bootout gui/$(id -u)/com.tt3p.arra-oracle   # stop WITHOUT auto-respawn (section 3)
launchctl bootout gui/$(id -u)/com.tt3p.arra-vector   # sidecar ALSO opens oracle.db read-only
                                                       # (src/vector-server.ts header comment)
lsof ~/.arra-oracle-v2/oracle.db*        # GATE: must print NOTHING — ANY holder counts, not
                                         # just the two jobs above (indexer run, stray dev
                                         # process, leftover test run); all must exit first
sqlite3 <backup.db> ".backup '$HOME/.arra-oracle-v2/oracle.db'"
cd ~/tt3p/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3 && bun run server:install-launchagent
bun run vector:install-launchagent
```
Do not use a bare `kill` on either job — with `KeepAlive.SuccessfulExit=false`
(section 3) launchd would respawn it against the OLD `oracle.db` before the
swap lands, racing the restore.
Then re-run section 2 and compare counts — they must match exactly:
```sh
sqlite3 -readonly <backup.db> "SELECT count(*) FROM oracle_documents;"
sqlite3 -readonly ~/.arra-oracle-v2/oracle.db "SELECT count(*) FROM oracle_documents;"
```

## 6. Fresh install

```sh
git clone git@github.com:TTT3P/arra-oracle-v3.git && cd arra-oracle-v3 && git checkout alpha
bun install
printf 'OLLAMA_BASE_URL=http://127.0.0.1:11434\nORACLE_EMBEDDING_MODEL=bge-m3\nVECTOR_URL=http://localhost:8081\n' > .env
ollama pull bge-m3
bun run vector:install-launchagent    # sidecar first, so the health check below (which expects
bun run server:install-launchagent    # vectorStatus=ok) isn't racing the sidecar's own startup
curl -s http://127.0.0.1:47778/api/health/live   # expect: status=ok, state=live
curl -s http://127.0.0.1:47778/api/health        # expect: status=ok, state=healthy, vectorStatus=ok
```
`VECTOR_URL` is required in `.env` (section 1) — without it core falls back to local vector
resolution instead of proxying to the sidecar, and `/api/health`'s `vectorStatus`/`vectorServer`
fields stop proving the sidecar path at all. On a genuinely fresh install neither job is loaded and
nothing yet listens on either port, so — unlike section 3's warning about the vector installer's
"already listening, not yet loaded" shortcut — both commands here take their full bootstrap+kickstart+health-poll path and wait for a real response before exiting 0. Then restore the
newest `.db` backup via the Type B procedure (section 5) or reindex from the canonical root, and
drain vectors (section 4). Finish by re-running section 2.

## 7. Policies & holds

- **No hard-delete, permanently** (TINE R0, 2026-08-17): supersede is the only
  retirement path; gated prune is exceptional TINE-approved maintenance only.
  Decision record: `learning_2026-08-17_decision-tine-r0-2026-08-17-oracle-has-no-har`
- **Bounded retro-index exception for read-only seats** (TINE R1, 2026-08-18):
  a seat with `ORACLE_READ_ONLY=true` plus `ORACLE_REMOTE_WRITE_URL=<owner core>`
  is **read-mostly, not strictly read-only** — it additionally advertises
  `oracle_index_retro`, routed only through the owner-core HTTP proxy
  (fail-closed; local DB never written; `oracle_learn`/`oracle_supersede` stay
  hidden; search/read stay local-embedded). Decision record:
  `learning_2026-08-18_decision-tine-r1-2026-08-18-read-only-oracl`.
- Current recovery/hold state lives in the Oracle recovery-state learning chain
  (search: "recovery state canonical source root", project orchestrator-vnext).
- **No ghq alias as an owner-resolution fix** (TINE NO-GO, ORA-SHARED-20260820):
  a document's DB `project` can legitimately be a repo's real git-origin
  identity while the machine's ghq entry for that repo is aliased under a
  different name — do **not** create a second `ghq/<project>` symlink to
  "fix" a read miss. A `maw` scanner derives a fresh Oracle identity from
  each distinct ghq entry name; a second entry for the same repo registers
  a duplicate identity (registry pollution). The owning fix is the
  resolver's origin-mapping fallback (`resolveGhqAliasTargetByOrigin`,
  `f0312b74` — matches by the alias's real-target git origin, fails closed
  on 0 or >1 matches, never creates anything).

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
