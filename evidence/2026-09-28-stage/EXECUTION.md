# Private staging execution — 2026-09-28 UTC

Status: in progress. Production remains the previous FTS-only image. No completion claim.

## 04:20–04:24 execution

- Reused authenticated Mint admin SSH session; host verification unchanged.
- Verified candidate image `arra-oracle-v3:private-c363c7f5` digest `sha256:6d437e5f4e4d09218f500d81019814d8900e8b8f909f89872f78b216d21754ee`.
- Disk free: 9.7 GiB. Production volume: 8.2 MiB.
- Created `arra-completion-stage_arra-oracle-stage-data`.
- Briefly stopped production container, copied its complete volume with `cp -a`, and restarted via EXIT trap. Subsequent production health confirmed SQLite/FTS available, 848 documents; vectors remain disabled there.
- Retained stage's original vector config as `vector-server.pre-bge.json`; installed committed BGE configuration only into stage.
- Started `arra-completion-stage` using production/private/staging Compose files, image `private-c363c7f5`, adapter `c363c7f5`, existing protected staging environment. Ports 48778/48779; workers off.
- Stage health: Ollama connected, embedded SQLite-vec connected, 848 FTS documents.
- `POST /api/vector/index/start` with `{model:"bge-m3",batchSize:4}` returned 200, job `vidx-1790569282880`; source SQLite, total 848. Progress observed 32, 132, then 180 vectors. Not yet a completed semantic gate.
- Authenticated `/api/docs/json`: actual OpenAPI 3.0.3 document, 177 paths.
- `/api/federation/status`: 200, official provider status.
- Search auth checks: absent and invalid credentials 401; existing authorized credential 200.
- MCP initialize: 200, valid JSON-RPC result, protocol 2025-03-26, server arra-oracle-v3.
- Adapter health: 200.
- Root with default Accept returns JSON, not UI proof. Browser Accept is required by the official SPA middleware.
- `/simple` failed 500: missing `/app/dist/simple.html`. Root cause: bundler relocates `import.meta.dir`, Docker image omitted adjacent HTML. Added one COPY instruction plus regression test. Test observed RED then GREEN. Commit `8cde020a`.
- Backed up remote candidate Dockerfile as `Dockerfile.c363c7f5`, transferred committed fix with strict SCP, started image rebuild `arra-oracle-v3:private-8cde020a`; log `staging/full-stack-20260928/build-http-8cde020a.log`.

Pending: completed indexing/semantic evidence, rebuilt image Simple Mode check, staged LLM/approval gates, production cutover, encrypted vector recovery, fresh cross-device gates and Git push. Keep completion automation active.

## 04:27–04:29 progress

- Index job completed: 848/848, strategy `delete-add`, completedAt `1790569660098`.
- Vector-only paraphrase query returned HTTP 200, `mode=vector`, `vectorAvailable=true`; top hit `mine_1e53214ae5764266eab8803f__chunk_3`, source `mine/corpus/arra/planning/2026-09-12/packages/01.md`, score 0.778156. Query: “How can encrypted copies recover the memory service after failure?”
- Studio with `Accept: text/html`: 200 and HTML document.
- Rebuilt image `arra-oracle-v3:private-8cde020a`: digest `sha256:777d859b1fbeb9a221a5e43649a857860e555516248fd9cf7d2d04b487a2bcbb`, build exit 0. Packaged Simple HTML exists, 1980 bytes.
- Scoped deployment/OpenAPI/federation tests: 37 pass, 0 fail.
- Commit `b80bf811` enables staged read-only ask inference; consolidation/entity workers remain off.
- Recreated only staging using fixed image and staged ask overlay. `/simple` now 200 with HTML; vector count remains 848 after restart.
- Acer strict SSH reachable again (read-only echo exit 0); no fresh Acer MCP gate yet.
- Completion automation verified `ACTIVE`, hourly. No removal.
- Protected recovery identity located at `/Users/poramateake/.codex/arra-secrets/backup.agekey`, mode 600; contents not displayed. This is separate from backup destination.

## 04:29–04:35 staging gates and production cutover

- Staged ask with the recovery paraphrase: 200, `mode=llm`, `noEvidence=false`, one citation. Imaginary Sapphire Hedgehog reactor question: 200, `mode=llm`, `noEvidence=true`, zero citations.
- Seeded four explicitly named `stage-gate-20260928-*` fixtures only in disposable staging using the official Drizzle schema. Official consolidation HTTP approve/reject returned 200 and actor `mac-stage-gate` audit records at 04:31:09Z and 04:31:13Z. Database readback confirmed approved old fixture points to its replacement; rejected old fixture remains unsuperseded.
- New application-consistent pre-cutover archive `arra-pre-bge-20260928T0433Z.age` created with existing backup script, 94 curated source files and all 848 database documents covered. Both Mint and Mac SHA-256: `e84c8ef7b12b335d3224317114faa1d8a5506410332e11722503f07cde6e1eb2`. Mac decryption/listing succeeded. This captures current pre-cutover state, not a blind repeat of the prior archive.
- Stopped staging, checkpointed its vector database. Stopped production; retained production's old vector database/config as `vectors.pre-bge-20260928.db` and `vector-server.pre-bge-20260928.json`. Copied only verified vectors and vector configuration from stage. Never copied staging oracle.db or its test fixtures.
- Recreated `arra-mint` with `arra-oracle-v3:private-8cde020a`, adapter `arra-private-llm-adapter:c363c7f5`, and committed private Compose overlay. Existing protected runtime credentials unchanged.
- Production health after cutover: healthy, Ollama, 848 vector documents / 848 source documents, zero pending; FTS 848/848; suggestion worker enabled. Authenticated OpenAPI: 177 paths. Federation status and Simple Mode: 200.
- Production vector-only paraphrase: `mode=vector`, `vectorAvailable=true`, real vector hits. Top ID `mine_bb5cff6d7e24693a235c5be5__chunk_1`.
- Hybrid query reports `mode=hybrid`, `vectorAvailable=true`; top three happened to be FTS hits, so nonzero vector-result gate still requires a wider-result check.

Remaining: post-cutover cited answer and wider hybrid result check, new encrypted vector backup and full-service isolated restore, persistent encrypted backup timer, cross-device final gates, scoped Git delivery. Production cutover is complete; overall deployment is not yet complete.
