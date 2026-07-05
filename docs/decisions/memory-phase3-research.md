# Memory Phase 3 research decision records (#2646)

Status: Phase 3 research guardrails for #2251. These records are not automatic
implementation commitments. A bet can graduate only into a Phase 2 design task
with acceptance tests, owner, telemetry, and rollback/audit policy.

## Non-negotiable #2251 gates

Every research bet below must preserve the memory-layer thesis:
provenance-first, confidence-ranked, non-destructive, LLM-free retrieval.

Reject any proposal that:

- physically deletes or overwrites memory rows to correct facts;
- puts an LLM on the synchronous read path;
- puts an LLM on every synchronous write/index path;
- makes a graph database required for the memory core;
- optimizes for LoCoMo/DMR leaderboard movement over repo-specific evals;
- infers persona, psychology, or theory-of-mind without a product requirement.

## Record 1 — Async LLM curation: ADD / NOOP / SUPERSEDE

**Recommendation:** Continue only as an async, opt-in, dry-run-first research path.
The useful shape is ADD/NOOP/SUPERSEDE planning over top-k similar memories, but
only auditable outcomes may apply: ADD for new evidence and SUPERSEDE through the
existing supersede-not-delete machinery. Reject hard DELETE, in-place UPDATE, and
uncited rewrites.

**Risks:** False supersedes can hide useful current facts; LLM cost and latency can
turn ingestion into a tax; prompts may leak tenant context; operators may trust a
low-quality dry-run report as if it were reviewed truth.

**Kill criteria:** Kill or freeze the bet if it requires synchronous write-time LLM
calls, proposes hard delete/update, cannot emit exact old/new IDs and rationale,
violates tenant scope, or fails a curated supersede-precision set with any
unreviewed destructive outcome.

**Graduate-or-kill verdict:** Do not graduate broadly yet. Graduate only to a Phase
2 governance design for review queues, precision targets, telemetry, and rollback
UX. Otherwise keep it dry-run research.

## Record 2 — Graph/edge layer vs sidecar entities

**Recommendation:** Keep sidecar entities and entity-as-ranking as the default.
Research a lightweight edge layer only after logs show repeated, concrete
multi-hop relationship misses that sidecar entity boosts cannot answer. Do not
adopt Neo4j, FalkorDB, Kuzu, Neptune, or any required graph DB by default.

**Risks:** Graph infrastructure adds ops burden, tenancy hazards, latency, and a
second source of truth; relationship extraction can hallucinate edges; graph
traversal can over-amplify weak entity matches and obscure provenance.

**Kill criteria:** Kill the graph path if no product query needs multi-hop
traversal, sidecar entity ranking closes the miss, graph recall lift is small
relative to latency/cost, provenance cannot be shown per edge, or a graph DB
becomes mandatory for normal recall.

**Graduate-or-kill verdict:** Kill graph-DB-by-default now. Graduate only a narrow
Phase 2 edge-layer design when a named query class, sidecar baseline, and eval set
prove sidecar entities are insufficient.

## Record 3 — Learned salience / adaptive heat

**Recommendation:** Keep the current explainable heat inputs first: usage count,
last accessed time, freshness, provenance, and bounded confidence blending. Learned
salience should wait until telemetry shows the simple model is stable and a small
golden set defines what “better salience” means.

**Risks:** Learned heat can become an opaque popularity loop, bury rare but critical
facts, reward noisy repeated queries, or accumulate MemoryOS-style magic constants
that nobody can explain or tune safely.

**Kill criteria:** Kill or defer if the model cannot explain why a memory moved,
needs many hand-tuned weights, worsens stale-result suppression or rare-fact
recall, lacks per-tenant telemetry, or cannot be disabled without changing stored
data.

**Graduate-or-kill verdict:** Do not graduate yet. Graduate only after Phase 2
telemetry and eval criteria exist; until then, improve observability around simple
heat instead of adding learned salience.

## Record 4 — LoCoMo / DMR benchmarks

**Recommendation:** Use LoCoMo/DMR-style suites only as sanity checks for temporal
and dialogue-memory regressions. The north-star remains repo-specific evidence:
trusted corpus recall, supersede precision, stale-result suppression, as-of
correctness, tenant isolation, and cited answers.

**Risks:** Benchmark chasing can reward behaviors that violate the product thesis,
including read-path LLM calls, hidden persona inference, or synthetic dialogue
optimizations that do not improve Oracle corpus memory.

**Kill criteria:** Kill benchmark-driven work if it degrades local golden tests,
requires read-path LLM calls, hides provenance, produces unstable numbers across
runs, or turns external leaderboard movement into a release gate.

**Graduate-or-kill verdict:** Graduate only a non-gating sanity-check harness with
clear limitations. Kill any attempt to make LoCoMo/DMR the product KPI.

## Record 5 — Persona memory / user-modeling

**Recommendation:** Keep Honcho-style persona or theory-of-mind memory out of
scope. Arra Oracle is a corpus/knowledge memory layer, not a psychological profile
or user-model store. Product work should model documents, facts, provenance,
confidence, tenants, and explicit user-provided preferences only.

**Risks:** Persona inference invites privacy risk, confident-but-wrong
interpretation, weak explainability, and policy/consent burdens. It also distracts
from the auditable corpus-memory advantage.

**Kill criteria:** Kill the bet if it infers mental states, communication style, or
psychological traits from behavior; lacks explicit product requirement and consent;
cannot export/audit/delete the model; or is needed to make core recall work.

**Graduate-or-kill verdict:** Kill for Phase 3. Reopen only with a separate product
requirement, privacy model, explicit consent UX, and proof that plain corpus memory
cannot satisfy the use case.
