# Private Arra completion

Approved specification: this chat's September 28 deployment plan and recommended decisions.
Mac is the sole deployment/config writer; Mint is data authority; Acer retains its five-tool bridge and separately authorized operator SSH.
No public exposure, personal import, host-trust weakening, OS upgrade, or separate swarm.
Preserve existing dirty deployment work. Continue on the existing feature branch; update PR #3065 against alpha, never self-merge.

## Accepted scope amendment — 2026-09-29

User accepted Hermes/Grok-only inference acceptance, with Codex fallback deferred.
Existing fallback wiring may remain installed but is not a verified availability
guarantee: the authenticated Mint account is quota-limited. Re-test actual fallback
inference after quota is available; no paid plan or API purchase is required for
the accepted Hermes-backed operation. This amendment supersedes the original
two-provider completion condition below, not its historical execution evidence.
The revised deployment scope is accepted complete; remove the completion heartbeat
and retain normal encrypted backups, off-host copying and health monitoring.

## Task 1: Restore official private API surfaces

Write authenticated OpenAPI and federation mounting regressions, observe failures, then minimally repair internal auth propagation and optional route registration.
Run scoped HTTP tests and typecheck. Expected: real OpenAPI schema with auth, enabled federation responds, disabled and unauthorized requests remain denied.

## Task 2: CPU vector deployment and staging

Use official Ollama bge-m3 (1024 dimensions), SQLite-vec, FTS fallback; no OpenAI embedding key.
Pin Ollama 0.34.4 amd64 digest sha256:4be1eaabf0dd0152bfbb780347e2888b5fe86ec25d0faa3eb4b1a956173736fb and capture pulled model digest.
Use port 11434 loopback, batch 4, concurrency 1, embedding timeout 120 seconds.
Production ports 47778/47779; staging 48778/48779 and distinct data volume.
Back up exact changed configuration, build pinned candidate, stage canonical data, index curated records, prove vector coverage and vector-only paraphrase retrieval.

## Task 3: Official maw and client verification

Use official maw-js commit 5ee396a7f61def2ee2a8774d3f6da216e069c6c2 and this checkout's full maw-plugin.
Mac HTTP commands use existing Mint tunnel; database-local maintenance stays on Mint.
Prove supported MCP catalog and calls from Mac/Hermes, exact five tools on Acer; delegate device-local checks only if necessary.
Retain Hermes/Grok primary and Codex fallback; test cited/no-evidence answers and controlled fallback.
Approve/reject through existing Studio/HTTP only; workers queue suggestions, never auto-approve.

## Task 4: Cutover and recovery

Reuse matching old backup evidence; new state requires new age-encrypted backup and off-host Mac copy.
Extend isolated restore for Ollama without requiring an OpenAI key; preserve compatibility.
Use identical pinned application image for stage, production, and recovery.
Replace existing daily plaintext backup job with encrypted full-state backup; no duplicate timer.
Restore Mac copy independently; prove FTS, vectors, UI, MCP, restart and source hashes.
Critical cutover failure: restore matching old image/config/data. Preserve failed state for diagnosis.

## Task 5: Delivery and completion

Run route matrix, scoped tests, typecheck, frontend build, secret/mode checks and diff checks.
Record commands, timestamps, exit codes, image/model/source pins and checksums in sanitized deployment evidence.
Commit scoped artifacts only and push existing branch; update PR #3065, do not merge.
Delete hourly completion automation only after every approved gate passes; retain operational backups/health monitoring.

## Execution state

Hourly same-chat automation created: finish-private-arra-deployment, ACTIVE.
Baseline: 26 scoped tests passed, typecheck and git diff --check passed before changes.
SSH to Mint works. Non-root Docker socket access denied; sudo authorization must be available before privileged rollout.
Existing dirty files: deployment README, corpus coverage/script/manifest, restore script, corpus coverage tests; untracked evidence and Python caches preserved.

## Review focus

Authentication must not leak or become optional through internal OpenAPI dispatch.
Disabled federation must remain absent; no public federation exposure.
No mixing 1536-dimensional OpenAI vectors with 1024-dimensional BGE vectors.
No staged process shares production mutable state or listener ports.
No second canonical database through Mac CLI maintenance.
No plaintext secrets in Git, evidence, logs, or backup payloads.
