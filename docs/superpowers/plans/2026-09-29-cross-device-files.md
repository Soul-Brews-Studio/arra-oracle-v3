# Complete cross-device Arra file ingestion

Status: user approved; implementation in progress. Supersedes local-files design.

## Contract

Mint owns the separate file corpus, queue, SQLite-vec and local bge-m3 embeddings.
Mac remains sole deployment/config writer. Each device collects independently as
its existing user. Existing curated Arra and Acer's five-tool bridge stay unchanged.
Codex inference fallback is deferred, not a gate for this scope.

All discovered files receive outcomes. Unsupported/encrypted content may be
metadata-only. Unreadable roots, offline volumes, deferred supported files and
unfinished extraction are incomplete coverage, never successful full ingestion.

Never modify originals, follow symlinks/reparse points, hydrate cloud placeholders,
scan virtual devices, ingest credentials/auth stores, or touch Developer/42.
Keep metadata private. Locally screen bodies before transfer and extracted text
after conversion; quarantine whole matches. Detection is not a perfect guarantee.
Exclude collectors' own spools, databases, backups and recursive mount aliases.

Bounded relevant excerpts may reach existing cloud-backed agents automatically;
no bulk cloud uploads/summarization, new subscriptions or API spending. Retrieved
content is untrusted data and cannot authorize actions.

## Tasks and gates

1. Update specification and maintain execution ledger.
2. Inventory-only collectors: volume/provider discovery, identities, private
   checkpoints, explicit outcomes and capacity estimates on all three devices.
3. Synthetic pipeline through device-specific forced-command SSH receiver.
   Validate identity, length, hashes, sequence and completion. Strict host trust;
   no shell, PTY, forwarding or arbitrary destinations. Never reuse MCP keys.
4. Text/PDF/Office ingestion using official Arra chunking/storage, Drizzle schema
   additions only where necessary. Stable source identities, payload deduplication,
   changed-file retries, idempotent transfers and obsolete text/vector removal.
   Delete only after complete successful scans of online roots.
5. Local extended extraction: HTML/RTF/EPUB, PDF OCR, LibreOffice documents with
   external links/macros disabled, Tesseract English/Thai, official multilingual
   Whisper small with ten-minute segments, sampled video frame OCR, archives.
   Pin software/model hashes/licenses before enabling each real format.
6. Separate authenticated browser search/coverage and read-only MCP tools:
   arra_files_search (default 5, max 20, previews 500 characters), arra_files_read
   (16,000 characters with pagination/provenance), arra_files_status. Filters:
   device/path/format/date. No arbitrary reads, write/admin/exec/bulk-export tools.
7. Progressive real ingestion: documents, images, media, archives. Checkpoint each
   batch; reconcile discovered outcomes and monitor curated health throughout.
8. Native hourly schedules with startup/login catch-up: LaunchAgent, systemd timer,
   Windows user task. Independent offline spools and recovery. Separate age backups
   and off-host copies; isolated restore must reproduce counts/hashes/retrieval.
9. Scoped tests, typecheck, frontend checks, secret scan, diff check; sanitized Git
   delivery through existing fork/PR targeting alpha. Never self-merge.

## Hard bounds

- One heavy job and one embedding batch (four items) at a time.
- Extraction containers: network none, non-root, read-only runtime/source mounts,
  bounded memory/tmp. Separate local Ollama worker, pinned existing bge-m3 config.
- Archives: depth 3, 10,000 members, 1 GiB expanded, ratio 100:1. Reject traversal,
  absolute paths, links and special entries. Partial jobs stay explicitly partial.
- No arbitrary database dumps, browser/mail stores, disk images or executable analysis.
- Spools 512 MiB/device; no total corpus cap (user approved removal). Use available
  storage above operating floors; Mint stays authoritative.
- Free-space floors: Mint 15 GiB, Mac 10 GiB, Acer 20 GiB. Stop affected work and
  report shortfalls; no eviction, authority relocation or user-file deletion.
- No new chat heartbeat. Enable native schedules only after manual gates pass.

## Verification

Test Unicode/long paths/hard links/duplicates, symlinks/reparse/cloud/offline roots;
secret filenames/text/PDF/archive/OCR; malformed/encrypted files, bombs/traversal,
parser crashes/cancellation; concurrent source changes, retries, sleep/reboot,
queue exhaustion and safe deletion reconciliation. Prove keyword/semantic and
metadata search, provenance, client read-only catalogues, network isolation,
capacity guards, encrypted recovery and curated health.

Completion requires deployed collectors/search, full in-scope scans, processed
supported content, reconciled counts, working schedules, verified recovery and
pushed evidence. Individual implementation milestones are not deployment completion.
