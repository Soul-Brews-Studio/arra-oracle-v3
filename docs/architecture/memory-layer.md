# Memory layer architecture (#2251)

This document records the memory-layer contracts added by the #2251 waves that
are present on `alpha`: confidence-ranked retrieval, retrieval reinforcement,
supersede-not-delete, the async consolidation worker, and bi-temporal reads.
The guiding rule is:
**reads stay fast and LLM-free; curation is explicit, auditable, and never
physically deletes memories.**

## Goals and invariants

- Preserve memory history with replacement pointers instead of hard deletes.
- Rank read results by retrieval quality plus trust signals, not confidence
  labels alone.
- Reinforce useful memories when search returns them, while keeping stale-warning
  decay visible.
- Run consolidation off the hot path; optional LLM review can propose only
  `SUPERSEDE` actions.
- Keep every path tenant-aware and compatible with SQLite/FTS5 plus vector
  adapters.
- Answer historical searches with `valid_time` / `asOf` without deleting old
  rows.

## End-to-end shape

```text
write/index
  -> oracle_documents + oracle_fts + vector collections
  -> valid_time + usage_count / last_accessed_at start cold

read/search
  -> FTS/vector/fan-out retrieval
  -> optional asOf filter uses valid_time / valid_until
  -> query-time confidence score
  -> rankingScore = normalized RRF blended with confidence
  -> logDocumentAccess() bumps usage_count + last_accessed_at

maintenance
  -> consolidation worker scans active docs off-path
  -> lexical/FTS or optional LLM evidence proposes pairs
  -> runSupersede() marks old -> new, deleted = 0
```

## Confidence-ranked fan-out

`src/routes/memory/fanout.ts` fuses per-collection vector results with Reciprocal
Rank Fusion (`RRF_K = 60`) and then blends the normalized RRF score with
query-time confidence:

```text
rankingScore = normalizedRrf * (1 - confidenceWeight)
             + confidence.score * confidenceWeight
```

`src/routes/memory/rerank-config.ts` owns the operator-facing config.
Operational knobs:

- `ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT`
- legacy fallback: `ARRA_MEMORY_FANOUT_CONFIDENCE_WEIGHT`
- default: `0.25`; values are clamped to `0..1`; `0` disables confidence
  reranking without disabling confidence labels.

`/api/health` exposes `memory.fanoutReranking` with the effective weight,
source, env key, and `confidence_weighted_rrf` strategy for operators.

The fan-out response also exposes the ranking contract so clients can explain ordering:

```json
{
  "ranking": {
    "rrfK": 60,
    "confidenceWeight": 0.25,
    "confidenceRerankingEnabled": true,
    "confidenceWeightSource": "default",
    "confidenceSource": "query-time-confidence"
  }
}
```

`src/routes/memory/confidence.ts` computes confidence at query time; no confidence
column is stored. Current signals are:

- semantic or keyword match score;
- freshness decay (`139d` half-life when source/tags anchor the memory, `30d`
  when unanchored);
- provenance from source, tags, and title;
- retrieval reinforcement from `usage_count` and `last_accessed_at`.

Read-path invariant: fan-out does **not** call an LLM. LLMs may assist only in
background consolidation, never synchronous retrieval.

## Retrieval reinforcement

Search result access feeds a small heat signal back into confidence without
turning the store into an opaque popularity contest.

Data fields in `oracle_documents`:

- `usage_count` tracks how often a document was returned/accessed;
- `last_accessed_at` tracks the latest access timestamp;
- `idx_documents_usage_heat` supports heat-aware lookups.

`src/server/logging.ts` owns the write:

- `logDocumentAccess()` inserts a `document_access` row;
- `bumpDocumentUsage()` increments `usage_count` and updates
  `last_accessed_at`.

Current call sites include:

- `src/server/handlers.ts` for core search results;
- `src/routes/search/tenant-search.ts` for tenant-scoped FTS results.

Confidence uses a bounded signal: `log1p(usage_count)` plus a 30-day recency
curve from `last_accessed_at`, then clamps it into the final score. Reinforced
old memories can rise in rank, but stale/unanchored warnings remain visible.

## Supersede-not-delete

Supersession is the memory-layer mutation for contradiction, replacement, and
near-duplicate cleanup. It never removes the old row.

Primary fields on `oracle_documents`:

- `superseded_by` points from the old document to the replacement;
- `superseded_at` records transaction time: when Oracle learned the old document
  was superseded;
- `superseded_reason` stores the human, worker, or LLM rationale.

Mutation surfaces:

- MCP/tool path: `oracle_supersede` in `src/tools/supersede.ts`;
- shared implementation: `runSupersede()`;
- HTTP path: `POST /api/supersede/document` in
  `src/routes/supersede/create.ts`.

Read support:

- `src/search/supersede-status.ts` adds `superseded_by`, `superseded_at`, and
  `superseded_reason` to returned search rows.
- Callers can follow the replacement pointer while still auditing the historical
  row and reason.

The old document remains queryable by ID/history. Normal “active” scans filter on
`superseded_by IS NULL` when they need only current candidates.

## Consolidation worker

`src/workers/consolidation.ts` performs sleep-time cleanup off the read/write hot
path. It is deliberately conservative:

- default `dryRun: true`;
- scans active docs only (`superseded_by IS NULL`);
- optional tenant filter;
- compares same-tenant, same-type documents;
- uses lexical cosine plus token-overlap evidence from FTS/content/source;
- chooses the lower-confidence or older document as the old side;
- applies through `runSupersede()` and returns `deleted: 0`.

Default thresholds are high enough to bias toward duplicate cleanup rather than
creative rewriting:

```text
limit = 250
minCosine = 0.94
minFtsOverlap = 0.86
staleDays = 45
intervalMs = 300000
```

`createConsolidationWorker()` wraps `runOnce()`, `start()`, `stop()`, and
`isRunning()` so process managers can schedule it without mixing consolidation
logic into routes.

## Optional LLM consolidation layer

`src/workers/consolidation-llm.ts` is opt-in only:

- pass `llm.enabled`, or set `ORACLE_CONSOLIDATION_LLM=1`;
- provide an injected client or `ORACLE_CONSOLIDATION_LLM_URL`;
- keep `dryRun` unless the operator intentionally applies results.

Guardrails:

- prompts demand JSON containing only `SUPERSEDE` calls;
- `DELETE`, `UPDATE`, unknown IDs, and self-supersede are ignored;
- LLM calls are validated against the current pair before becoming a plan;
- application still routes through `runSupersede()`.

This adopts the useful part of LLM write-time curation while preserving the
project invariant: wrong curation remains reversible/auditable because no row is
hard-deleted.

## Bi-temporal reads

`oracle_documents.valid_time` records world-valid time. `/api/search?asOf=...`
uses `src/search/bitemporal.ts` to include rows where the coalesced valid start
is at or before `asOf`, and the successor's `valid_time` or `superseded_at` is
after `asOf`. Returned rows can expose `valid_time` and `valid_until` alongside
supersede metadata.

See [`memory-pipeline.md`](./memory-pipeline.md) for the full write/read flow.

## Wave status and follow-ups

Implemented on current `alpha`:

- confidence affects fan-out order, not just response labels;
- search access reinforces confidence through usage heat;
- supersede metadata is returned with search results;
- async consolidation can plan/apply supersede-only cleanup;
- optional LLM consolidation is isolated from read paths;
- bi-temporal `valid_time` / `asOf` reads return `valid_time` and `valid_until`.

Tracked by #2251 but not a current `alpha` contract in this branch:

- entity-linking sidecar collections from PR #2285.

When that lands, extend this document with the entity fusion/ranking contract,
but keep the same non-goals below.

## Non-goals

- No hard deletes for memory correction.
- No LLM calls during retrieval.
- No synchronous consolidation on writes.
- No required graph database for the memory core.
- No hidden confidence column that drifts out of sync with current query context.
