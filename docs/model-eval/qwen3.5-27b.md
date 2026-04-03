# Qwen3.5-27B — Oracle Backup Model Evaluation

## Model Overview

| Field | Value |
|-------|-------|
| Full Name | Qwen/Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled |
| Parameters | 28B (27.8B active) |
| Context Window | 262,144 tokens |
| License | Apache 2.0 |
| Quantization | Q4_K_M (16.5GB VRAM) |
| Speed | 29-35 tok/s on RTX 3090 |

## Evaluation Criteria

### 1. Search Quality (Embedding Compatibility)

**Status**: Requires testing

Oracle v3 uses embedding models (`bge-m3` default, `nomic` for fast) via vector stores (LanceDB, Qdrant, SQLite-vec). Qwen3.5 is a **reasoning model**, not an embedding model.

**Integration Path**:
- Qwen3.5 is NOT a direct replacement for embeddings
- Can serve as the **reasoning layer** for query understanding, concept extraction, and result re-ranking
- For embeddings, continue using dedicated models (bge-m3, nomic-embed)

### 2. Use Cases for Oracle v3

| Use Case | Viability | Notes |
|----------|-----------|-------|
| Query expansion/rewriting | HIGH | Can rephrase searches for better FTS5 matches |
| Concept extraction (`/learn`) | HIGH | Chain-of-thought helps identify concepts from text |
| Document summarization | HIGH | 262K context handles large documents |
| Autonomous indexing | MEDIUM | Can drive indexer decisions locally |
| Embedding generation | NOT VIABLE | Use dedicated embedding models |
| Search result re-ranking | HIGH | Reasoning can improve relevance |

### 3. Performance Benchmarks (Estimated)

| Metric | Claude API | Qwen3.5 Local | Notes |
|--------|-----------|---------------|-------|
| Latency (first token) | 200-500ms | 50-100ms | Local eliminates network |
| Throughput | Rate-limited | 29-35 tok/s | Unlimited local |
| Context window | 200K (Opus) | 262K | Qwen3.5 slightly larger |
| Cost per query | ~$0.015-0.075 | $0 (electricity) | Major cost savings |
| Availability | 99.9% (API) | 100% (local) | No network dependency |

### 4. Integration Architecture

```
┌─────────────────────────────────────────────┐
│                Oracle v3 Server              │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Embedding │  │ Reasoning│  │   FTS5    │ │
│  │ (bge-m3) │  │ (Qwen3.5)│  │  (SQLite) │ │
│  └──────────┘  └──────────┘  └───────────┘ │
│       │              │              │        │
│       └──────────────┼──────────────┘        │
│                      │                       │
│              Hybrid Search                   │
└─────────────────────────────────────────────┘
```

### 5. Implementation Plan

**Phase A: Setup** (30 min)
```bash
ollama pull qwen3.5:27b
# or
ollama pull qwen3.5:27b-q4_k_m
```

**Phase B: Config Integration** (1-2 hours)
- Add `ORACLE_REASONING_MODEL` env var to `.env.example`
- Add Ollama client for reasoning tasks (separate from embedding)
- Wire into `/api/learn` for concept extraction
- Wire into `/api/search` for query expansion

**Phase C: Benchmarking** (2-3 hours)
- Run standard query set against both Claude API and Qwen3.5
- Measure: latency, quality (manual review), token throughput
- Test 100 consecutive queries for reliability
- Monitor VRAM/RAM usage during sustained load

### 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Quality gap vs Claude | MEDIUM | Use as fallback only, not primary |
| VRAM contention with embeddings | LOW | Embeddings use CPU; Qwen uses GPU |
| Model updates/maintenance | LOW | Apache 2.0 allows local hosting |
| Cold start time | LOW | Keep model loaded via Ollama |

## Recommendation

**CONDITIONAL ADOPT** — Qwen3.5-27B is viable as Oracle's **local reasoning backup** for:
1. Offline operations when Claude API is unavailable
2. Cost-sensitive batch operations (indexing, concept extraction)
3. Privacy-sensitive work

**NOT recommended** as a drop-in replacement for Claude API quality — use as a complement.

### Next Steps
1. Download and test locally with Ollama
2. Benchmark concept extraction quality vs Claude
3. If quality is 80%+ of Claude for concept extraction, integrate as fallback
4. Add config toggle: `ORACLE_REASONING_PROVIDER=ollama|claude`

## Status: Evaluation report complete. Awaiting local benchmarking.
