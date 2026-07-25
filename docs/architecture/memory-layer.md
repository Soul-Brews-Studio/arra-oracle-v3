# Memory layer architecture (#2251 close-out)

Current source of truth for the memory/search layer on `alpha` as verified for
#2721. Every implementation claim cites code as `file:line`. The design law is:
**retrieval is fast, auditable, tenant-aware, and LLM-free; curation is
suggest-only or explicit supersede, never hard delete.**

## 1. Storage and write surfaces

| Store | Contract | Evidence |
|---|---|---|
| `oracle_documents` | Corpus docs carry tenant, type, source, concepts, valid-time, supersede pointers, usage heat. | `src/db/schema.ts:10-39` |
| `oracle_fts` | FTS5 content/concepts index joined to docs for keyword recall. | `src/db/schema.ts:40`; FTS query in `src/server/handlers.ts:143-199` |
| `oracle_entity_links` | Deterministic entity links are SQL sidecars keyed by tenant, entity key, and document. | `src/db/schema.ts:41-51` |
| `oracle_memories` | App memories carry valid range, supersede fields, tier/heat, usage. | `src/db/schema.ts:62-82` |
| Vector collections | `getEmbeddingModels()` reads active vector config; default config has `bge-m3`, `nomic`, `qwen3`. | `src/vector/factory.ts:122-143`; `src/vector/config.ts:55-78` |
| Memory save | `/api/memory/save` persists then indexes one memory vector doc. | `src/routes/memory/index.ts:21-32`; vector doc shape `src/routes/memory/vector.ts:27-67` |

## 2. Retrieval pipeline and formulas

### General search / ask

1. `/api/search` sanitizes input, parses mode/model/asOf, runs tenant search or
   core hybrid search, then applies asOf filtering, entity rerank, supersede
   metadata, warnings, and optional compact summary (`src/routes/search/search.ts:20-88`).
2. Core `handleSearch()` expands candidate depth from `limit` via
   `candidatePoolSize()` (`src/server/handlers.ts:81-96`;
   `src/search/retrieve-depth.ts:1-15`). It runs FTS unless vector-only
   (`src/server/handlers.ts:132-200`), runs vector unless FTS-only
   (`src/server/handlers.ts:202-250`), then hybrid-fuses candidates
   (`src/server/handlers.ts:252-287`). Hybrid score is per-leg normalized score
   plus reciprocal-rank weight, with overlap boost capped at 1
   (`src/server/handlers.ts:306-340`).
3. `/api/ask` reuses the search path, applies asOf, entity rerank, supersede
   attachment, then ranks sources and synthesizes cited output
   (`src/routes/ask/index.ts:59-98`). Setting `llm:false` bypasses the optional
   LLM client because the client is only chosen when `body.llm !== false`
   (`src/routes/ask/index.ts:83-84`).

### Memory fan-out

`GET /api/memory/fanout` queries every configured vector collection, converts
hits to search results, filters them by tenant/asOf, computes entity signals,
and calls `fuseRankedResults()` (`src/routes/memory/fanout.ts:144-187`).
`fuseRankedResults()` is the final ranking contract:

```text
RRF_K = 60
contribution(collection, rank) = 1 / (RRF_K + rank)
rrf = fusedScore / maxFusedScore
confidence.score = memoryConfidence(... semanticScore=result.score ...).score
entityWeight = min(0.06, confidenceWeight / 4)
confidencePart = confidenceWeight - entityWeight
rankingScore = rrf * (1 - confidenceWeight)
             + confidence.score * confidencePart
             + entity.score * entityWeight
```

Code anchors: `RRF_K` is defined at `src/routes/memory/fanout.ts:40`; entity
signal config is `weight <= 0.06` and `graph:false`
(`src/routes/memory/fanout.ts:66-69`); per-collection contribution is computed at
`src/routes/memory/fanout.ts:83-90`; normalization and `rankingScore` are
computed at `src/routes/memory/fanout.ts:112-123`; sorting and limiting happen at
`src/routes/memory/fanout.ts:125-126`. The response repeats ranking metadata,
including entity signal config, at `src/routes/memory/fanout.ts:197-205`.

`confidenceWeight` defaults to `0.25`, clamps to `0..1`, and uses
`ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT` before the legacy
`ARRA_MEMORY_FANOUT_CONFIDENCE_WEIGHT` (`src/routes/memory/rerank-config.ts:1-5`,
`src/routes/memory/rerank-config.ts:27-40`,
`src/routes/memory/rerank-config.ts:47-55`).

## 3. Confidence and heat

The query-time confidence model is not stored as a column. It returns score,
label, components, warnings, and reasons (`src/routes/memory/confidence.ts:3-18`).
The formula is:

```text
freshness = 0.5 ** (ageDays / halfLife)
halfLife = 139d when source or tags exist, else 30d
provenance = source*0.45 + tags*0.35 + title*0.2
usage = log1p(usage_count)/log1p(20)*0.7 + recency(last_accessed_at, 30d)*0.3
score = match*0.5 + freshness*0.3 + provenance*0.2
      + usage*ORACLE_MEMORY_USAGE_CONFIDENCE_WEIGHT
```

Code anchors: half-lives and env key at `src/routes/memory/confidence.ts:29-33`;
provenance, usage, weight, and score at `src/routes/memory/confidence.ts:49-64`;
usage curve at `src/routes/memory/confidence.ts:150-154`; warnings/reasons at
`src/routes/memory/confidence.ts:132-164`. The usage weight defaults to `0.1`,
clamps to `0..0.1`, and can be disabled with `0`
(`src/routes/memory/confidence.ts:90-108`).

Retrieval reinforcement is off-response-path for fan-out: returned ids are
scheduled with `setTimeout`, then each id calls `bumpDocumentUsage()`
(`src/routes/memory/reinforcement.ts:6-23`). `bumpDocumentUsage()` increments
`usage_count` and updates `last_accessed_at` (`src/server/logging.ts:86-90`).
Core search still logs and bumps synchronously after slicing
(`src/server/handlers.ts:269-275`).

## 4. Provenance contracts

| Contract | Implementation | Evidence |
|---|---|---|
| Supersede-not-delete | `runSupersede()` validates ids/tenant/cycles, then updates `superseded_by`, `superseded_at`, `superseded_reason`; it returns a message that the old doc still appears flagged. | `src/tools/supersede.ts:73-174`, `src/tools/supersede.ts:178-188` |
| HTTP supersede | `/api/supersede/document` delegates to `runSupersede()`. | `src/routes/supersede/create.ts:73-94` |
| Result surfacing | `attachSupersedeStatus()` normalizes existing fields, reads doc supersede fields, and mutates result records; `supersedeWarnings()` emits user-visible warnings. | `src/search/supersede-status.ts:40-62`, `src/search/supersede-status.ts:65-100` |
| Bi-temporal asOf | `parseAsOf()` accepts ms or parseable dates; asOf filtering includes docs whose valid start is <= asOf and whose successor valid time/superseded_at is null or > asOf; it annotates `valid_time`/`valid_until`. | `src/search/bitemporal.ts:16-29`, `src/search/bitemporal.ts:53-63`, `src/search/bitemporal.ts:65-113` |
| Ask citations | Ask returns `answer`, `citations`, `citationIndexes`, `warnings`, `noEvidence`, `mode`, `generatedAt`, `asOf`, `search`, and `sources`; sources carry id/type/title/file/score/confidence/excerpt/stale/entity/chunk. | `src/routes/ask/index.ts:83-98`; `src/routes/ask/synthesis.ts:21-60` |
| MCP search provenance | Search evidence adds confidence signals and provenance scores for FTS/vector/pointer/entity matches. | `src/tools/search/helpers.ts:129-175`; metadata at `src/tools/search/handler.ts:121-151` |

## 5. Consolidation and curation

| Path | Behavior | Knobs / evidence |
|---|---|---|
| HTTP suggestion queue | `/memory/consolidation/pending|suggestions` dry-runs `runConsolidationWorker()`, merges queued sleep suggestions, and exposes approve/reject endpoints. Approval calls `runSupersede()`; reject/approve writes audit rows. | `src/routes/memory/consolidation.ts:25-89`, `src/routes/memory/consolidation.ts:145-164` |
| Non-LLM corpus worker | `runConsolidationWorker()` scans active `oracle_documents`, same tenant/type only, lexical cosine + FTS overlap, chooses lower-confidence/older old side, defaults dry-run, applies only through supersede, returns `deleted: 0`. | `src/workers/consolidation.ts:39-61`, `src/workers/consolidation.ts:111-179`, `src/workers/consolidation.ts:182-221` |
| Memory-table worker — ⚠️ **NOT WIRED** | `runMemoryConsolidationWorker()` handles `oracle_memories`, same tenant, dry-run default, cosine/overlap thresholds, writes supersede fields directly and returns `deleted: 0`. **It has no production caller** — the symbol appears only in its own file, its own test, and this row. The memory tier is **manual by decision** (Nat, 2026-07-25): memories come from `POST /api/v1/memory` or Simple mode, never from an automatic pass. Every other row in this table is genuinely reachable; this one is listed so it is not mistaken for one. | `src/workers/memory-consolidation.ts:22-72`, `src/workers/memory-consolidation.ts:88-123`; see #2859 |
| Sleep vector worker (#2704) | Env-gated worker scans active docs off-path, uses vector `queryById`, emits queued suggestions, never applies them. | `src/workers/sleep-consolidation.ts:69-76`, `src/workers/sleep-consolidation.ts:90-135`, `src/workers/sleep-consolidation.ts:138-223`; queue `src/workers/consolidation-queue.ts:12-28` |
| Sleep LLM pass (#2713) | If `ORACLE_CONSOLIDATION_LLM=1`, it reviews near-but-not-duplicate vector pairs, asks the same ask-client, accepts only `SUPERSEDE`, queues suggestions with model/reason provenance. | `src/workers/sleep-consolidation-llm.ts:36-74`, `src/workers/sleep-consolidation-llm.ts:123-153`, `src/workers/sleep-consolidation-llm.ts:169-179` |
| Legacy LLM worker | `runConsolidationWorker(..., { llm })` dispatches to `runLlmConsolidationWorker()`, which accepts only validated `SUPERSEDE` calls and still applies through `runSupersede()`. | `src/workers/consolidation.ts:187-190`; `src/workers/consolidation-llm.ts:29-45`, `src/workers/consolidation-llm.ts:131-155`, `src/workers/consolidation-llm.ts:195-235` |

## 6. Entity layer (#2707 condensed)

Current alpha already has the low-cost entity sidecar:

- extraction is deterministic concepts + regex, max 12/doc
  (`src/vector/entities.ts:7-20`);
- SQL links persist in `oracle_entity_links` (`src/db/schema.ts:41-51`) via
  `replaceEntityLinks()` (`src/search/entity-ranking.ts:35-80`);
- `_entities` vector docs use `{collection}_entities`, `source_doc_id`,
  `tenant_id`, and `type: entity` (`src/vector/entities.ts:11-33`);
- `/api/indexer/start` builds and refreshes the entity vector store
  (`src/routes/indexer/start.ts:103-169`);
- `/api/search` and `/api/ask` apply SQL candidate boosts
  (`src/routes/search/search.ts:66-78`; `src/routes/ask/index.ts:68-80`);
- candidate boost is capped at `min(0.24, matches*0.08)` and never adds
  entity-only hits (`src/search/entity-ranking.ts:8-10`,
  `src/search/entity-ranking.ts:84-105`);
- fanout now consumes SQL entity signals as the third budgeted ranking signal,
  still only for retrieved candidates (`src/routes/memory/fanout.ts:178-187`,
  `src/routes/memory/fanout.ts:112-123`);
- vector search adds confidence+heat+entity capped multiplier
  (`src/routes/vector/search.ts:152-194`; `src/routes/vector/entity-boost.ts:50-82`);
- entity sidecar search exists at `/vector/entities/search`
  (`src/routes/vector/entity-search.ts:60-104`);
- MCP `oracle_search` reports `graph:false` and entity-sidecar metadata
  (`src/tools/search/entities.ts:65-91`, `src/tools/search/handler.ts:139-148`);
- health reports entity coverage and backfill status
  (`src/search/entity-coverage.ts:17-30`; `src/routes/health/health.ts:158-159`);
- the startup process launches both sleep consolidation and entity backfill
  workers, each env-gated internally (`src/server.ts:173-177`).

Phased verdict from #2707 is now mostly landed: **Phase 1** golden eval covers
exact, alias, bigram, tenant, stale/asOf, and entity-only negative cases
(`tests/eval/phase1-entity-golden-baseline.test.ts:72-114`); **Phase 2** adds
backfill/repair for missing SQL links and `_entities` sidecars
(`src/workers/entity-backfill.ts:52-60`, `src/workers/entity-backfill.ts:84-134`);
**Phase 3** adds the budgeted fanout signal above. Remaining research is
no-LLM extraction quality (path/title/aliases/acronyms) only if coverage/eval
shows gaps.

## 7. Memory knobs and provenance PRs

PR provenance was checked with `git log -S <ENV_KEY>`.

| Knob | Default / range | Effect | Code refs | Added |
|---|---:|---|---|---|
| `ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT` | `0.25`, `0..1` | Fanout non-RRF confidence budget. | `src/routes/memory/rerank-config.ts:1-5`, `src/routes/memory/rerank-config.ts:27-40` | #2261; exposed in health by #2284 |
| `ARRA_MEMORY_FANOUT_CONFIDENCE_WEIGHT` | legacy fallback | Same as above if primary missing. | `src/routes/memory/rerank-config.ts:1-2`, `src/routes/memory/rerank-config.ts:47-55` | #2261 |
| `ORACLE_MEMORY_USAGE_CONFIDENCE_WEIGHT` | `0.1`, `0..0.1` | Usage/last-accessed term inside confidence. | `src/routes/memory/confidence.ts:32-43`, `src/routes/memory/confidence.ts:90-108` | #2698 |
| `ORACLE_RETRIEVE_DEPTH` | `100`, max `500` | Candidate pool depth for search/memory semantic search. | `src/search/retrieve-depth.ts:1-15`; call `src/routes/memory/index.ts:89-103` | #2476 |
| `ORACLE_SEARCH_RETRIEVE_DEPTH` | legacy fallback | Same as retrieve depth if primary missing. | `src/search/retrieve-depth.ts:4-6` | #2476 |
| `ORACLE_ASK_LLM` | off | Enables ask synthesis client; `llm:false` bypasses it. | `src/routes/ask/synthesis.ts:74-82`; `src/routes/ask/index.ts:83-84` | #2303 |
| `ORACLE_ASK_LLM_URL` | none | HTTP endpoint for ask/sleep LLM client. | `src/routes/ask/synthesis.ts:74-82`; sleep use `src/workers/sleep-consolidation-llm.ts:48-51` | #2303 |
| `ORACLE_CONSOLIDATION_WORKER` | off | Enables sleep vector suggestion worker when `1`. | `src/workers/sleep-consolidation.ts:69-76` | #2704 |
| `ORACLE_CONSOLIDATION_WORKER_INTERVAL_MS` | `900000`, clamp `60000..86400000` | Sleep worker interval. | `src/workers/sleep-consolidation.ts:60-76`, `src/workers/sleep-consolidation.ts:240-246` | #2704 |
| `ORACLE_CONSOLIDATION_SIMILARITY_THRESHOLD` | `0.95`, `0..1` | Vector duplicate threshold; also LLM dedup threshold input. | `src/workers/sleep-consolidation.ts:60-76`, `src/workers/sleep-consolidation.ts:99-110` | #2704; reused #2713 |
| `ORACLE_CONSOLIDATION_LLM` | off | Enables legacy/sleep LLM consolidation pass. | legacy `src/workers/consolidation-llm.ts:29-31`; sleep `src/workers/sleep-consolidation-llm.ts:36-41` | #2277; sleep pass #2713 |
| `ORACLE_CONSOLIDATION_LLM_URL` | none | Legacy consolidation LLM endpoint. | `src/workers/consolidation-llm.ts:33-45` | #2277 |
| `ORACLE_CONSOLIDATION_LLM_CAP` | `10`, clamp `1..100` | Max sleep LLM calls/suggestions per pass. | `src/workers/sleep-consolidation-llm.ts:32-41`, `src/workers/sleep-consolidation-llm.ts:199-202` | #2713 |
| `ORACLE_ASK_LLM_MODEL` | `ask-llm` in reason | Model provenance string in sleep LLM suggestions. | `src/workers/sleep-consolidation-llm.ts:144-153` | #2713 |
| `ORACLE_VECTOR_ENTITY_BOOST_CAP` | `1.5`, clamp `1..3` | Fallback cap for vector entity multiplier. | `src/routes/vector/entity-boost.ts:9-15`, `src/routes/vector/entity-boost.ts:148-151` | #2669 |
| `ORACLE_ENTITY_BACKFILL` | off | Enables entity sidecar repair worker when `1`. | `src/workers/entity-backfill.ts:38-49`, started at `src/server.ts:173-177` | #2723 |
| `ORACLE_ENTITY_BACKFILL_INTERVAL_MS` | `900000`, clamp `60000..86400000` | Entity backfill worker interval. | `src/workers/entity-backfill.ts:38-44`, `src/workers/entity-backfill.ts:68-79` | #2723 |
| `ORACLE_ENTITY_BACKFILL_LIMIT` | `250`, clamp `1..5000` | Max docs planned per backfill sweep. | `src/workers/entity-backfill.ts:33-44`, `src/workers/entity-backfill.ts:84-90` | #2723 |
| `ORACLE_ENTITY_BACKFILL_ENTITY_SCAN_LIMIT` | `100000`, clamp `1..1000000` | Max existing `_entities` docs scanned per model. | `src/workers/entity-backfill.ts:33-44`, `src/workers/entity-backfill.ts:93-115` | #2723 |
| `MEMORY_TTL_AUTOSUPERSEDE` | off | Non-ORACLE legacy TTL auto-supersede for `oracle_memories`. | `src/routes/memory/store.ts:126-132`, `src/routes/memory/store.ts:219-220` | #2402 |

Non-env entity settings: `vector.entity_boost_cap` and `vector.entity_aliases`
are scoped DB settings with env fallback only for the cap
(`src/routes/vector/entity-boost.ts:9-15`, `src/routes/vector/entity-boost.ts:148-166`).
`/api/health` exposes fanout reranking and sleep-worker status under `memory`
plus entity coverage/backfill under `entities` (`src/routes/health/health.ts:158-159`).

## 8. Anti-patterns promoted to design law

- **No hard delete for memory correction.** Supersede updates pointers and keeps
  old rows auditable (`src/tools/supersede.ts:167-188`). This adopts Zep-style
  invalidation history without a graph DB.
- **No LLM on synchronous read.** Fanout calls vector stores and confidence only
  (`src/routes/memory/fanout.ts:161-190`); ask LLM is optional and can be
  disabled per request (`src/routes/ask/index.ts:83-84`). Zep's landscape lesson
  in #2251 was zero-LLM retrieval for latency.
- **No LLM on sync write.** Consolidation LLMs are worker/sleep paths and emit
  supersede suggestions/calls only (`src/workers/sleep-consolidation-llm.ts:123-153`;
  `src/workers/consolidation-llm.ts:131-155`).
- **No graph DB as core memory substrate.** Entity links are SQL/vector sidecars
  with `graph:false` in MCP metadata (`src/tools/search/handler.ts:139-148`).
  #2251 captured mem0's 2026 lesson: graph gave about 2% lift for 2x tokens, so
  Oracle skips straight to entity-link ranking.
- **No hyperparameter sprawl.** Fanout has one confidence weight today
  (`src/routes/memory/rerank-config.ts:1-5`); entity fanout already carves its
  third signal out of that budget instead of adding a new env knob
  (`src/routes/memory/fanout.ts:66-69`, `src/routes/memory/fanout.ts:80-82`).

See also [memory-pipeline.md](./memory-pipeline.md) for the older flow diagram;
this file is the close-out contract for #2251.
