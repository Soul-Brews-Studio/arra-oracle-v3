# Memory Phase 2 design contracts (#2645)

Status: design note for Phase 2 work spawned from #2251. It is a contract for
implementation and test planning; it does not change runtime behavior by itself.

Preserved #2251 invariants:

- Provenance first: every answer, merge, and ranking adjustment must trace to
  source document IDs and tenant-scoped metadata.
- Confidence-ranked, non-destructive memory: never hard-delete or overwrite a
  fact to consolidate it; supersede and annotate instead.
- Retrieval stays LLM-free and fast. LLMs may synthesize or propose memory
  changes only after deterministic retrieval produces evidence.
- No required graph DB: entity links are deterministic side tables and ranking
  signals, not a mandatory graph database dependency.
- Tenant isolation applies before ranking, consolidation, caching, and prompts.

## 1. Consolidation governance

Consolidation jobs compare candidate memories and produce one of two outputs:

| Mode | Default | Allowed output | Write behavior |
| --- | --- | --- | --- |
| `suggest-only` | Yes | review items, proposed `SUPERSEDE` edges, explanations | no memory mutation |
| `apply` | No | accepted `SUPERSEDE` edges plus audit rows | append-only writes only |

### Suggest-only contract

- New tenants, new datasets, imports, and LLM-assisted consolidation run in
  `suggest-only` until a maintainer enables apply mode for that tenant or job.
- Suggestions must include candidate IDs, tenant ID, reason codes, confidence,
  evidence snippets, and whether the proposal came from rules or an LLM.
- Suggestions must not hide, demote, or supersede existing documents on read
  paths. They are review material only.
- A rejected suggestion is durable feedback for later tuning; the same proposal
  should not immediately reappear without new evidence or a changed threshold.

### Apply-mode contract

`apply` mode may create `SUPERSEDE` relationships only when all gates pass:

1. tenant-scoped candidates match the job tenant;
2. both source and successor still exist and are not already contradicted by a
   newer accepted successor;
3. deterministic thresholds pass before any LLM rationale is considered;
4. the job has explicit apply permission and an auditable actor/job ID;
5. the write is append-only: set supersede metadata or insert an edge/audit row,
   but do not delete source rows or rewrite source text.

LLM output is never sufficient authority to apply a consolidation. An LLM may
rank or explain a candidate, but deterministic gates and tenant policy decide
whether the job can write. Failed gates downgrade to `suggest-only` with a reason.

### Governance artifacts

Each consolidation run must emit an audit record containing mode, tenant, input
query or batch, thresholds, candidate count, applied count, suggested count,
rejected count, actor/job ID, and code version. Operators need a rollback path
that removes or disables the supersede edge while preserving the audit trail.

## 2. Bi-temporal semantics

Memory has two time axes:

- **Valid time**: when the fact is true in the world (`valid_time`).
- **Transaction time**: when Oracle learned or changed the record (`indexed_at`,
  `created_at`, `updated_at`, `superseded_at`).

For reads with `asOf`, compute:

```text
valid_start = coalesce(valid_time, updated_at, created_at, indexed_at)
valid_until = coalesce(successor.valid_time, superseded_at)
visible if valid_start <= asOf and (valid_until is null or valid_until > asOf)
```

Timestamps are stored and compared as UTC instants. Date-only imports are treated
as `00:00:00Z` unless the importer supplies a timezone. Invalid `asOf` values are
request errors, not silent fallbacks to current time.

### Examples

1. **Current fact**: `A` says "API v2 is active", `valid_time=2026-04-01`, no
   successor. `asOf=2026-07-01` returns `A`; `asOf=2026-03-01` does not.
2. **Historical fact**: `A` says "Owner is Maya", valid from January. `B` says
   "Owner is Niran", valid from March, and supersedes `A`. `asOf=2026-02-15`
   returns `A`; `asOf=2026-03-15` returns `B`.
3. **Correction learned late**: Oracle indexes `B` on April 10 but `B.valid_time`
   is March 1. A May query uses the corrected March valid time. Audit views still
   show the transaction time: Oracle learned the correction on April 10.
4. **Import without valid time**: an imported note has no explicit `valid_time`,
   so `updated_at`, then `created_at`, then `indexed_at` define the start. This
   fallback must be visible in eval fixtures so import behavior is deterministic.
5. **Conflicting valid times**: two tenant-local records claim different values
   for the same entity and overlapping valid windows. Reads may rank the stronger
   evidence higher, but consolidation must produce a conflict suggestion unless
   an accepted supersede edge resolves the interval.

### Endpoint support expectations

| Endpoint | `asOf` expectation | Test expectation |
| --- | --- | --- |
| `GET /api/search` | supported query param | filters before entity boosts; returns `valid_time` and `valid_until` |
| `GET /api/v1/search` | same contract as `/api/search` | versioned route matches unversioned route |
| `POST /api/ask` | Phase 2 must either support body `asOf` or reject it with 400 until implemented | no historical answer may cite evidence outside the requested valid window |
| Admin/list/export routes | not historical unless explicitly documented | supplied `asOf` must be rejected or ignored with a documented warning |

No endpoint may imply historical correctness while silently using current-time
retrieval.

## 3. Entity-link rank boost caps and interaction rules

Entity links are deterministic ranking hints derived from source text. The
current boost contract is:

- canonicalize entity keys with Unicode normalization, lowercase text, and
  punctuation folding;
- at most 16 query entity keys contribute to a request;
- at most the top 100 ranking candidates are entity-reranked;
- each matched entity adds `0.08`;
- total entity boost is capped at `0.24` per result.

Interaction rules:

1. Tenant and `asOf` filters run before entity boosts. Entity links must never
   resurrect out-of-tenant, expired, or superseded-out evidence.
2. Entity boosts add to the base FTS/vector/hybrid score but remain bounded so a
   weak lexical/vector match cannot outrank strong evidence only because it has
   many aliases.
3. Confidence and heat signals remain separate. Entity boost may break close
   ties, but confidence thresholds and stale/superseded warnings still apply.
4. Alias/canonicalization expansion must be tenant-aware. A tenant-specific alias
   cannot affect another tenant's ranking.
5. Missing entity-link tables or empty matches degrade to the original ranking,
   not an error on the read path.
6. Stable ordering is required when scores tie: preserve the pre-boost order.

Future tuning must change caps only with golden eval evidence. The eval must show
that entity boosts improve recall without increasing stale or cross-tenant hits.

## 4. `/api/ask` product contract

`/api/ask` is retrieval-grounded synthesis, not autonomous memory lookup. The
retrieval phase remains deterministic and LLM-free; an optional LLM may only
summarize the retrieved evidence.

### Request and evidence

- Input query is sanitized the same way search queries are sanitized.
- `limit` is clamped to the product range; tests should cover low, high, and
  missing values.
- Tenant filters apply before evidence reaches the prompt, cache, or response.
- If Phase 2 adds `asOf`, ask must pass it into retrieval and expose the selected
  instant in the response metadata.

### Response contract

Every response includes:

- `query`, `answer`, `citations`, `noEvidence`, `mode`, `generatedAt`;
- `search.total`, `search.limit`, `search.vectorAvailable`, and optional warning;
- `sources[]` with stable citation index, document ID, type/source file, score,
  excerpt, and supersede metadata when present.

Citation rules:

- Every factual answer sentence should cite one or more source indexes such as
  `[1]`.
- Citations must refer only to returned sources. Invalid LLM citations are
  dropped rather than passed to the client.
- `noEvidence=true` when no source or only below-threshold evidence exists; the
  answer must say Oracle does not have enough evidence instead of guessing.

### Stale, superseded, and redacted evidence

- Superseded sources remain citeable only as historical or stale evidence. The
  answer must state that the evidence is stale when it is central to the answer.
- Current answers should prefer non-superseded successors when available.
- Prompts and responses include excerpts, not entire documents, and must not leak
  cross-tenant content, secrets, provider configuration, or raw environment data.
- Remote LLM synthesis is disabled unless `ORACLE_ASK_LLM` and
  `ORACLE_ASK_LLM_URL` opt in; extractive mode is the safe fallback.

### Latency and caching

Targets for implementation planning:

- retrieval-only/extractive ask should stay within the normal search latency
  budget and avoid blocking consolidation jobs;
- LLM synthesis must have a bounded timeout and fall back to extractive output on
  provider failure;
- cache keys include tenant, sanitized query, mode, limit, filters, `asOf`, model,
  LLM mode/provider version, source IDs, and source freshness/supersede markers;
- cache entries are short-lived and invalidated or bypassed after tenant-local
  writes, imports, or supersede changes.

## 5. Golden eval fixtures spec

Ranking weight changes, consolidation thresholds, and `/api/ask` citation changes
need golden fixtures before tuning. Fixtures should live under a stable test path
such as `tests/fixtures/memory-phase2/` and be small enough for CI.

Fixture shape:

```json
{
  "name": "owner-correction-asof",
  "tenantId": "tenant-a",
  "documents": [
    { "id": "doc-old", "text": "Owner is Maya", "valid_time": "2026-01-01T00:00:00Z" },
    { "id": "doc-new", "text": "Owner is Niran", "valid_time": "2026-03-01T00:00:00Z", "supersedes": "doc-old" }
  ],
  "queries": [
    { "q": "who owns it", "asOf": "2026-02-15T00:00:00Z", "expectTopIds": ["doc-old"] },
    { "q": "who owns it", "asOf": "2026-03-15T00:00:00Z", "expectTopIds": ["doc-new"] }
  ]
}
```

Required fixture families:

1. bi-temporal current, historical, late correction, and fallback import cases;
2. consolidation true-positive, false-positive, and conflict-suggestion cases;
3. entity-link boost tie-breaks, cap enforcement, alias matching, and no-match
   degradation;
4. confidence/heat interaction cases where entity boost must not overwhelm weak
   evidence;
5. `/api/ask` citation, no-evidence, stale-warning, and redaction cases;
6. tenant isolation cases proving ranking, consolidation, prompts, and caches do
   not cross tenant boundaries.

Minimum pass criteria before tuning:

- expected top IDs match for all deterministic search cases;
- no stale/superseded answer is presented as current evidence;
- no fixture introduces a cross-tenant source;
- citation indexes in ask responses are valid and stable;
- any changed ranking cap includes before/after eval output in the PR.

## Acceptance checklist

- Consolidation governance separates `apply` from `suggest-only` and keeps
  writes append-only.
- Bi-temporal semantics define valid and transaction time with concrete examples.
- Entity-link boost caps and interaction rules are explicit.
- `/api/ask` covers citations, stale warnings, latency, caching, provider config,
  and redaction.
- Golden eval fixtures are specified before ranking-weight tuning.
- #2251 invariants remain intact.
