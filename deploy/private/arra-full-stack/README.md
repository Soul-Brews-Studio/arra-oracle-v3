# Private full-stack Arra bundle

Mint is the sole Arra authority. MacBook Codex is the control plane and only
repo/config writer. Acer remains a restricted bridge with exactly:
`oracle_search`, `oracle_read`, `oracle_list`, `oracle_learn`, `oracle_reflect`.

The Mint host runs Arra, Hermes, the optional Codex bridge, and the adapter on
loopback only: Arra `127.0.0.1:47778`, Hermes `127.0.0.1:8642`, adapter
`127.0.0.1:47779`, and Codex bridge `127.0.0.1:47781`. The private Compose
overlay uses Linux host networking so the container can reach those host-local
services without a bridged/public listener. Hermes/Grok is primary inference;
the bridge invokes Mint's existing logged-in Codex CLI in read-only mode as a
bounded fallback. ChatGPT Plus/Codex OAuth is not an OpenAI API key.

CPU embeddings run through official Ollama on `127.0.0.1:11434`, using
`bge-m3` (1024 dimensions) and SQLite-vec. Start `compose.embeddings.yml`,
pull the model once, and record its digest before indexing. The image is
pinned; stage, production, and restore must use the same model digest.
No OpenAI key is needed for this deployment. FTS5 remains the fallback.

## Operator sequence

1. Pin the current alpha commit and verify the Mint SSH, HTTP bearer token,
   MCP token (if separate),
   Hermes service, tunnel, and no concurrent writer.
2. On Mint, enable Hermes's API server in the existing mode-600 `~/.hermes/.env`
   with `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`,
   `API_SERVER_PORT=8642`, and a dedicated random `API_SERVER_KEY`. Keep the
   xAI OAuth state in Hermes only. Create a separate mode-600
   `/etc/arra-oracle/hermes.env` containing the Hermes key/model and Codex
   bridge key/model; use the same Hermes `API_SERVER_KEY` value in
   `HERMES_API_KEY`, and the same Codex bridge key in the adapter and bridge
   env files. It never contains Mint's bearer/MCP token. Verify Hermes
   `/health` and `/v1/models` before rollout. No OpenAI chat key is required.
3. Install `codex-bridge.service.example` as a Mint user service and copy
   `codex-bridge.env.example` to its mode-600 environment file. Confirm the
   service user can run the existing `codex login status`; the bridge uses
   `codex exec --json --sandbox read-only --ask-for-approval never` and sends
   only the Arra adapter payload. A trial/account expiry makes this provider
   unavailable; Hermes remains primary and the adapter fails closed.
4. Run `manifest-check.ts` against the approved repo, Arra, mac-setup, and
   explicitly selected Mint-record roots. Transfer only the
   resulting file list over strict SSH; run the official `arra mine` path on
   Mint. Record source hashes, deterministic IDs, FTS rows, and vector rows.
5. Run staged Compose with `compose.staging.yml` on a separate data
   volume and ports `48778`/`48779`; workers disabled and bounded LLM asks enabled;
   run synthetic worker tests only against the isolated data;
   run the health, plugin, auth, vector, ask, MCP, and corpus gates.
6. Create an application-consistent encrypted age backup. Verify decryption and
   boot an isolated restore with `restore-service.sh` before cutover.
7. Cut over briefly. If any critical gate fails, stop the new writer, restore
   the last good data/config snapshot, and return to FTS-only (`ORACLE_EMBEDDER`
   `none`) within the rollback deadline documented below.
8. After all acceptance gates, remove the active completion automation
   `finish-private-arra-deployment` and any verified superseded completion
   watcher; retain the normal backup timer and health-only monitor.

## Safety boundaries

- `ORACLE_PRIVATE_DEPLOYMENT=1` rejects a missing `ARRA_API_TOKEN` (HTTP
  protection), mismatched stacked `ARRA_API_KEY`, and non-loopback adapter URLs.
  A separate MCP token is allowed, but never substitutes for HTTP protection.
- `ORACLE_ENTITY_BACKFILL_DRY_RUN=1` is deliberate: workers plan/queue only;
  human Studio/HTTP approval is required for consolidation writes. Upstream
  has no dedicated consolidation approve/reject MCP tools.
- The strict plugin policy loads exactly the bundled `arra` and `oracle-dig`
  manifests, rejects symlinks/shadowing, and fails on lifecycle errors.
- `oracle-dig` session reads must be constrained to the Arra project path. No
  generic `AGENTS.md`/`CLAUDE.md`, raw session tree, screenshots, keys, tokens,
  certificates, `.env*`, backups, or unrelated personal folders are allowed.
- Existing Mint auth is not replaced. Hermes and Codex bridge credentials are
  separate local secrets. Codex OAuth can expire; when Hermes and Codex are
  unavailable, Arra fails closed to extractive answers/queued NOOP.

The vector template is versioned as `vector-server.private.json`. Install it
once while the service is stopped with
`install-vector-config.sh <data-dir> [config-path]`; the script refuses to
overwrite an existing config. Use `ORACLE_VECTOR_CONFIG_PATH` only for a
protected config stored outside the data volume.

## Backup/restore contract

Mint's existing daily `arra-backup.timer` invokes `scheduled-backup.sh` through
`arra-backup.service`. It takes an exclusive lock, verifies the running image's
40-character revision label, stops the authority, encrypts the curated snapshot,
and restarts the authority through an exit trap. Install the wrapper only after
deploying an image labelled `org.opencontainers.image.revision`.

Mac's `com.poramateake.arra-backup-pull` LaunchAgent runs at login and hourly,
copying encrypted archives and checksum receipts over strict SSH into
`~/.codex/arra-backups`. It verifies every receipt and never deletes archives.
The Mac must be awake and logged in; the next run catches up after downtime.
Recovery identity remains separate in Codex-owned secret storage. No automatic
retention policy is configured. Watch disk usage and explicitly review retention.

Backups are refused while the authority is live. Stop Arra/vector writers and
run `backup-age.sh --authority-stopped` with the full 40-hex
`ARRA_PINNED_COMMIT`, generated JSON corpus manifest, and one `--source-root`
per manifest source. The script checkpoints SQLite, captures DB/vector WAL
sidecars and the verified Markdown snapshot, then age-encrypts to an atomic
new file. It never overwrites an existing archive. `restore-age.sh` verifies
the manifest, rejects symlink entries, checks the corpus/vector config, and
validates every checksum plus complete coverage of database-referenced source
files. A database source path absent from the curated manifest is a hard
failure; extend the manifest deliberately before backup. `restore-service.sh`
boots only a new isolated data
directory, reconstructs the allowlisted corpus, uses a clean mode-600 runtime
environment with separate random HTTP/MCP tokens, proves authenticated read,
FTS search, MCP initialize, loopback binding, and restart. Its default proof
is deliberately FTS-only; add `--require-vector --embedding-env FILE
--vector-query QUERY --expected-source SOURCE` to require a semantic query.
The mode-600 file contains `ORACLE_EMBEDDER=ollama`,
`ORACLE_EMBEDDING_MODEL=bge-m3`, and `OLLAMA_BASE_URL=http://127.0.0.1:11434`.
Legacy `--openai-env` remains supported. It never reuses a live port or reads corpus files
from the live checkout.

`acceptance.sh` runs the cited Hermes/Codex ask gate by default. The semantic
gate is separate: set `ARRA_SEMANTIC_QUERY` and `ARRA_EXPECTED_SOURCE` only
when an approved embedding provider has been configured and mined. With the
explicit FTS-only rollback, set `ARRA_RUN_SEMANTIC_GATE=0`; this cannot count
as successful full-feature acceptance.
