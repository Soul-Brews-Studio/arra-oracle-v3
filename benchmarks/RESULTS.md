# Benchmark Results

## Honest retrieval methodology (#2472)

Run date: 2026-06-17

Harness: `benchmarks/hybrid-temp-backend.ts` starts an in-memory Bun `/api/search` service, seeds a 20-document public temp corpus into SQLite FTS5 plus memory vectors, embeds the same docs through local Ollama (`bge-m3`, `nomic-embed-text`, `qwen3-embedding`), and writes `benchmarks/out/honest-recall.json`.

This does **not** touch the live vault/index. Answer accuracy is **not measured**. Retrieval metrics now separate answerable recall from negative-control reject behavior.

| Metric | Value ± stdev | Hits / total | Runs | Notes |
| --- | --- | --- | --- | --- |
| Answerable-Recall@3 | 1.000000 ± 0.000000 | 10/10 | 5 | All answerable temp-seed queries recovered. |
| Reject-Recall | 1.000000 ± 0.000000 | 2/2 | 5 | Both no-match controls returned no docs. |
| Reject-Precision | 1.000000 ± 0.000000 | 2/2 | 5 | Every no-result response was a negative control. |
| FTS baseline Answerable-Recall@3 | 0.900000 ± 0.000000 | 9/10 | 5 | Missed `weak/semantic-vector`; no vector evidence used. |

### Methodology guardrails

- `top_k=3`, corpus size `20`, so `top_k/corpus = 0.1500`; the harness refuses `top_k` above 25% of corpus or `top_k >= corpus_size`.
- Variance is computed over five repeated deterministic temp-backend runs.
- Reject metrics are retrieval-only: negative controls have no expected ids and count as rejected only when the retriever returns no docs.
- Answer-Accuracy remains explicitly `not-measured`; no answer generator or judge was run.

### Reproduce

```bash
bun run benchmarks/hybrid-temp-backend.ts \
  --out benchmarks/out/honest-recall.json \
  --runs 5
```

The command requires local Ollama embedding models `bge-m3`, `nomic-embed-text`, and `qwen3-embedding`. It seeds only the temp 20-doc corpus and avoids live-vault reindexing.

### Hybrid provenance

```json
{
  "mode": "hybrid",
  "model": "multi",
  "top_k": 3,
  "corpus": { "label": "temp-ollama-20-docs-v1", "size": 20 },
  "metric": "Recall@k",
  "label": "Answerable-Recall@3",
  "backend": "temp-bun-sqlite-fts5-memory-vectors",
  "embedding_provider": "ollama",
  "ollama_models": ["bge-m3", "nomic-embed-text", "qwen3-embedding"],
  "runs": 5,
  "top_k_policy": "top_k=3; corpus_size=20; top_k/corpus=0.1500",
  "stack": ["bge-m3", "nomic", "qwen3", "FTS5"]
}
```

### Weak and negative-control cases disclosed

| Case | Expected | FTS result | Hybrid result | Note |
| --- | --- | --- | --- | --- |
| `weak/semantic-vector` | `doc-vector` | miss | hit | Vector embedding similarity recovers the paraphrase "nearest neighbor meaning search". |
| `weak/wcag` | `doc-a11y` | hit | hit | Acronym query is covered in this seed but remains too narrow for broad answer-quality claims. |
| `no-match/weather` | none | reject | reject | Weather forecast prompt is an intentional no-match control. |
| `no-match/recipe` | none | reject | reject | Recipe prompt is an intentional no-match control. |

The headline only claims retrieval metrics for this bounded, temp-seeded 20-doc corpus; it does not claim live-vault health or answer accuracy.
