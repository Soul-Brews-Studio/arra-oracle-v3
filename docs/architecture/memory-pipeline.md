# Memory pipeline diagram

This is the operational flow for the Oracle memory layer on `alpha`: writes land
in SQLite/FTS/vector stores, background consolidation creates supersede links,
reads rank by confidence without LLM calls, and `asOf` reads use bi-temporal
validity windows.

## Pipeline diagram

```mermaid
flowchart LR
  W[Write: learn, import, indexer] --> D[oracle_documents]
  W --> F[oracle_fts]
  W --> V[vector collections]

  D --> C[async consolidation worker]
  F --> C
  C -->|runSupersede| S[superseded_by / superseded_at / reason]
  S --> D

  Q[Read query] --> R1[/api/search]
  Q --> R2[/api/v1/memory/fanout]

  R1 --> F
  R1 --> B[bi-temporal asOf filter]
  B --> T[valid_time / valid_until]
  T --> A[attach supersede status]

  R2 --> V
  R2 --> K[RRF k=60]
  K --> H[query-time confidence]
  H --> O[confidence-ranked results]

  A --> U[document_access + usage heat]
  O --> U
  U --> D
```

## Phase flow

### 1. Write and index

Writes come from MCP/HTTP learn flows, imports, and the indexer. The canonical row
is `oracle_documents`; search text is mirrored to `oracle_fts`; vector adapters
receive embeddings for semantic/fan-out recall.

Important columns:

- `tenant_id` scopes all memory surfaces;
- `valid_time` records when the fact became true in the world;
- `superseded_by`, `superseded_at`, `superseded_reason` preserve history;
- `usage_count`, `last_accessed_at` store retrieval reinforcement heat.

### 2. FTS and vector substrates

`oracle_fts` is the low-latency keyword substrate for `/api/search` and tenant
search. Vector collections power `/api/v1/memory/fanout`; current fan-out fuses
collections with Reciprocal Rank Fusion before confidence reranking.

### 3. Async consolidation

`src/workers/consolidation.ts` scans active docs (`superseded_by IS NULL`) off the
hot path. It compares same-tenant, same-type candidates with lexical cosine and
FTS/token overlap, defaults to dry-run, and applies only through `runSupersede()`.
The result contract includes `deleted: 0`.

The optional LLM layer in `src/workers/consolidation-llm.ts` is still
supersede-only: it accepts validated `SUPERSEDE` calls and ignores delete/update,
unknown IDs, and self-supersede.

### 4. Confidence-ranked reads

`/api/v1/memory/fanout` computes confidence at query time. Ranking is:

```text
rankingScore = normalizedRrf * (1 - confidenceWeight)
             + confidence.score * confidenceWeight
```

`src/routes/memory/rerank-config.ts` exposes the effective configuration; health
reports it as `memory.fanoutReranking`. Confidence uses match score, freshness,
provenance, and usage heat. The read path remains LLM-free.

### 5. Bi-temporal reads

`/api/search?asOf=<timestamp>` answers “what was true then?” by applying
`src/search/bitemporal.ts`:

```text
valid_start = coalesce(valid_time, updated_at, created_at, indexed_at)
valid_until = coalesce(successor.valid_time, superseded_at)
include row when valid_start <= asOf and (valid_until is null or valid_until > asOf)
```

Returned rows may include:

- `valid_time`: the row's world-valid start time;
- `valid_until`: the replacement's `valid_time`, falling back to transaction-time
  `superseded_at`;
- supersede metadata from `attachSupersedeStatus()`.

Tenant FTS search applies the bi-temporal predicate in SQL. Other search modes
filter candidate results after retrieval, then report `asOf` as an ISO timestamp.

## Safety contracts

- No hard deletes for contradiction or consolidation.
- No LLM calls on synchronous read paths.
- Consolidation is off-path and dry-run-first.
- Bi-temporal reads preserve transaction history while exposing world-valid time.
- Retrieval reinforcement can lift useful old docs, but stale warnings remain
  visible through confidence details.
