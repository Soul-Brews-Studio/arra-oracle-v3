# arra-reranker — Python sidecar

Stateless cross-encoder reranking service for arra-oracle-v3. Calls `BAAI/bge-reranker-v2-m3` to lift retrieval precision after dense recall (bge-m3).

## Why a sidecar (and not Bun)

`bge-reranker-v2-m3` has no Ollama tag and lacks first-class JS support. The Python `sentence-transformers` integration is the gold standard. Decoupling the reranker keeps the main TS server simple and lets us swap rerankers (or run on different hardware) without touching arra-oracle-v3.

## Quick start

Requires Python ≥3.10. With `uv` (recommended, ~30s cold start):

```bash
cd services/reranker-py
uv sync
uv run uvicorn main:app --host 127.0.0.1 --port 8765
```

First call downloads `BAAI/bge-reranker-v2-m3` (~2.3 GB) to `~/.cache/huggingface`. Subsequent starts are fast — model stays cached.

## API

### `POST /rerank`

```json
{
  "query": "การวัดความลึกของน้ำผ่านบล็อกเชน",
  "candidates": [
    "Flood monitoring with ±2mm radar accuracy on JIBCHAIN L1.",
    "Air quality monitoring with PM2.5 sensors across 1500+ stations.",
    "..."
  ],
  "top_k": 3
}
```

Returns:

```json
{
  "query": "...",
  "results": [
    { "index": 0, "score": 8.3421, "document": "Flood monitoring..." },
    { "index": 7, "score": 2.1, "document": "..." }
  ],
  "model": "BAAI/bge-reranker-v2-m3"
}
```

Higher score = more relevant. Scores are not bounded to [0,1] — they're cross-encoder logits.

### `GET /health`

```json
{ "status": "ok", "service": "arra-reranker", "model_loaded": true }
```

## Integration with arra-oracle-v3

Pipeline: dense recall (bge-m3, top-50 from LanceDB) → POST candidates to reranker → top-5 by cross-encoder score → return to client.

```ts
// Sketch
const dense = await vectorStore.query(userQuery, 50);
const ranked = await fetch("http://127.0.0.1:8765/rerank", {
  method: "POST",
  body: JSON.stringify({ query: userQuery, candidates: dense.documents, top_k: 5 }),
}).then(r => r.json());
return ranked.results.map(r => dense.results[r.index]);
```

Sidecar is optional — falls back to dense-only if `:8765` is unreachable.

## Env

| Var | Default | Notes |
|-----|---------|-------|
| `RERANKER_MODEL` | `BAAI/bge-reranker-v2-m3` | Any HF cross-encoder works |

## Why bge-reranker-v2-m3

Same M3 family as the dense embedder (`bge-m3`) → consistent training data, consistent multilingual coverage including Thai. BAAI evaluations show the largest single Thai-quality lift in the bge stack comes from this reranker.
