# Search Score-Direction Fix Design

## Context

SQLite FTS5 returns better BM25 matches as more-negative `rank` values and orders them with
`ORDER BY rank`. The vector adapter already converts cosine distance to bounded similarity,
where higher is better. The search handler currently reverses both directions before descending
fusion, so the weakest candidates in each retrieved pool rise to the top.

## Approved scope

- Remove only the handler's second vector inversion.
- Replace FTS normalization with a bounded, order-preserving mapping.
- Correct the existing unit test that encodes the opposite BM25 direction.
- Add real SQLite FTS, handler vector, hybrid arithmetic/confidence, and temp-snapshot golden
  regressions.
- Audit pointer, both entity boosts, confidence, and reranker score handling without changing
  sites whose direction is already correct.
- Stage and commit locally only. Do not push, apply, deploy, restart, or mutate live data/config.

## Score contracts

All scores entering `combineResults` use one contract: finite values in `[0, 1]`, with larger
values meaning more relevant.

- FTS: `1 - exp(-0.3 * max(0, -rank))`. A more-negative BM25 rank produces a larger score;
  zero or an unexpected positive rank maps to zero.
- Vector: `cosineDistanceToSimilarity(distance)` is the sole distance conversion. The handler
  consumes that similarity unchanged.
- Pointer and entity signals: positive relevance boosts remain additive and bounded at their
  existing sites.
- Confidence: derives from the final fused score, so no direction conversion is needed.
- Reranker: returns an explicit candidate order; its sidecar score is not blended into fusion.

## Test architecture

The fast regression file uses an in-memory SQLite FTS5 table, a temporary Oracle database with a
mock vector store returning distances `[0.1, 0.7]`, and pure fusion/evidence assertions. The golden
file is opt-in through `ORACLE_GOLDEN_DATA_DIR`, rejects any path outside the OS temp directory,
opens copied SQLite and Lance data only, and supplies the copied target vector as a deterministic
query embedding. This isolates score-direction behavior from live Ollama while exercising the
real snapshot, Lance cosine search, handler fusion, and English/Thai FTS queries.

## Safety and rollback

Tests always set Oracle paths to temporary locations. Deployment, if later approved, is a normal
merge/cherry-pick of the local fix commit followed by scoped tests and a process restart. Rollback
is a normal revert of that commit followed by the same checks and restart; neither action is part
of this staged task.
