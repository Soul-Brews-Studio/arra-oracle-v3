# Cross-device local-only file search

Status: superseded by the approved cross-device ingestion plan in
`../plans/2026-09-29-cross-device-files.md`. Historical proposal below; its
browser-only, cloud-excerpt prohibition and limited-format assumptions no longer
apply. The approved plan permits bounded automatic agent retrieval, independent
collectors and sandboxed extended-format extraction. Codex fallback stays deferred.

## Intent and approved boundaries

Make accessible files across Mac, Mint and Acer discoverable without modifying
originals. Existing curated Arra remains operational and separate. New file content
must not enter Grok, Codex or another external inference service. The user's broad
access grant does not bypass OS protections or authorize secret ingestion.

All-files coverage means an accounted inventory, not a promise that every binary
can produce searchable text. Report indexed, metadata-only, excluded, unreadable,
offline and capacity-deferred counts separately. Never label partial coverage full.

## Verified preflight

Strict SSH to Mint and Acer succeeds. Mac has about 20 GiB available; Mint about
29 GiB. Acer reports C, D and G filesystem drives with more available space.
Drive type, network/cloud backing and readiness require checking before traversal.
No file bodies were collected in this preflight.

Official `src/indexer/mine.ts` ingests only .md/.mdx/.txt, skips hidden directories,
and rejects files over 2 MiB. Reuse it for normalized text; do not claim that simply
pointing it at a disk implements all-file ingestion.

## Alternatives

1. Recommended: separate local-only Mint service and data volume. Reuse pinned
   Arra search/indexing; add only inventory/extraction and isolation wiring needed.
2. Reuse the current database: fewer components, but unacceptable because existing
   cloud-backed answer and MCP routes can retrieve the new private content.
3. Keep separate indices on every device: less centralized storage, but requires
   three runtimes and federation; defer unless Mint capacity proves insufficient.

## Discovery and extraction

- Mac remains the only deployment/config writer. Device collectors are read-only.
- Enumerate regular files on accessible local fixed filesystems. Do not follow
  symlinks, Windows reparse points, filesystem aliases or recursive mount loops.
- Do not hydrate cloud placeholders or traverse network/removable volumes without
  reporting their status first. Offline devices retain last-seen inventory state.
- Preserve the existing explicit exclusion of /Users/poramateake/Developer/42.
- Exclude secrets/auth directories and files, private keys, certificates containing
  private material, browser profiles/session stores, password managers, .env files,
  credentials, live databases with authentication state, backup archives and this
  index's own files. Do not log secret paths or snippets publicly.
- System/runtime/package/cache binaries get metadata only; no archive expansion,
  macro execution, image/audio transcription, or external parsers/services.
- Extract supported text, source, PDF and Office document text using local parsers
  after sandbox and size checks. Unsupported/encrypted/malformed files remain
  metadata-only with a reason. Parser crashes must not stop inventory progress.
- Use stable device-plus-path IDs and content hashes. Preserve separate provenance
  for identical files across devices; deduplicate stored content, not ownership.
- Incremental runs detect changes, deletions and moves. Deleted content is removed
  from the live private search index; originals are never deleted or rewritten.

## Privacy and serving

Separate service credentials, database, vector store, corpus directory and backup
namespace. Never mount new data in the existing curated Arra/adapter containers.
No new private-file MCP server in Codex, Hermes, Acer's existing bridge or maw.
Local browser search is the initial client; remote access uses strict SSH tunnels.
Search results rendered in cloud-agent tools would themselves be external sharing
and are therefore prohibited for this corpus, even if inference flags are off.

Reuse official search/UI where feasible. Disable asks, consolidation LLM, outgoing
federation, session tools, cloud plugins and background content sharing. Enforce
network isolation as well as application settings: no outbound internet from the
private search/parser/embedding runtime. Local Ollama embeddings may be added only
inside that boundary with a preinstalled model; never download models at runtime.
Verify the actual container networking and listener exposure before real ingestion.

## Capacity, scheduling and recovery

Inventory first, estimate extracted/index/vector size, then start content ingestion.
Initial private-index budget: 8 GiB on Mint; preserve at least 15 GiB free there and
10 GiB on Mac. Stop cleanly and report capacity-deferred coverage at either limit;
do not delete user files, silently evict results, or move authority to Acer.
Stream bounded batches; no full-disk copy to Mac. Limit CPU/concurrency so existing
Arra remains healthy. Resume from checkpoints, with one collector/index writer.
Use native device scheduling only after successful manual gates; no new chat cron.

New backups are age-encrypted, secret-free and isolated from the curated backup
manifest. Account for backup storage within capacity checks. Reuse the separate
recovery identity without exposing it. Prove an isolated restore before completion.

## Acceptance and rollback

1. Synthetic fixtures on each device: normal files, duplicates, secrets, oversized
   files, symlinks/reparse points, unreadable files and changed/deleted files.
2. No secret fixture content/path enters the index or exported evidence.
3. Private runtime cannot reach the internet or existing inference adapters; cloud
   MCP/ask routes cannot retrieve a private canary. Original curated service intact.
4. Per-device inventory totals reconcile to explicit outcome counts and checkpoints.
5. Local browser retrieval works for supported formats; files remain unchanged.
6. Capacity interruption and offline-device recovery work without losing checkpoints.
7. Encrypted off-host copy and isolated restore verify hashes and search results.
8. Scoped tests/typecheck, sanitized evidence and Git delivery pass.

Rollback stops only the new collectors/service. Preserve its data for recovery and
leave curated Arra, SSH trust, secrets, auth and all source files unchanged.

No deployment or unrestricted ingestion has occurred from this design document.
