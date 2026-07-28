"""
arra-oracle reranker sidecar — bge-reranker-v2-m3.

Stateless FastAPI service. POST query+candidates, get back reranked candidates
with cross-encoder scores. Called by arra-oracle-v3 after dense recall to lift
precision (especially on Thai mixed-script).

Run:
    uv run --with 'fastapi,uvicorn,sentence-transformers,torch' \\
        uvicorn main:app --host 127.0.0.1 --port 8765

Or (with deps already installed in venv):
    uvicorn main:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

# Lazy import — only when service starts
_model = None


def get_model():
    """Lazy-load the cross-encoder. Cached process-wide."""
    global _model
    if _model is None:
        from sentence_transformers import CrossEncoder
        model_name = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
        _model = CrossEncoder(model_name, max_length=1024)
    return _model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the model on startup so the first /rerank isn't slow
    get_model()
    yield


app = FastAPI(
    title="arra-reranker",
    version="0.1.0",
    description="Stateless cross-encoder reranker for arra-oracle-v3",
    lifespan=lifespan,
)


class RerankRequest(BaseModel):
    query: str = Field(..., description="The user's search query")
    candidates: List[str] = Field(..., min_length=1, max_length=200,
                                   description="Candidate documents to rerank")
    top_k: Optional[int] = Field(None, description="If set, return only top_k by score")


class ScoredCandidate(BaseModel):
    index: int
    score: float
    document: str


class RerankResponse(BaseModel):
    query: str
    results: List[ScoredCandidate]
    model: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "arra-reranker", "model_loaded": _model is not None}


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest) -> RerankResponse:
    model = get_model()
    pairs = [(req.query, c) for c in req.candidates]
    scores = model.predict(pairs)

    indexed = [
        ScoredCandidate(index=i, score=float(s), document=c)
        for i, (s, c) in enumerate(zip(scores, req.candidates))
    ]
    indexed.sort(key=lambda x: x.score, reverse=True)

    if req.top_k:
        indexed = indexed[: req.top_k]

    return RerankResponse(
        query=req.query,
        results=indexed,
        model=os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3"),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=False)
