"""Vector index implementation for the TurboVec sidecar."""

from __future__ import annotations

import hashlib
import math
import threading
from dataclasses import dataclass, field
from typing import Any

VERSION = "0.1.0"
PROTOCOL = "vector-proxy-v1"
DIMENSIONS = 64
UINT64_MAX = (1 << 64) - 1

try:  # Optional production backend; fallback keeps CI dependency-free.
    import numpy as np  # type: ignore[import-not-found]
    from turbovec import IdMapIndex  # type: ignore[import-not-found]
except Exception:  # noqa: BLE001 - optional dependency probe.
    np = None
    IdMapIndex = None


def embed_text(text: str, dimensions: int = DIMENSIONS) -> list[float]:
    vector = [0.0] * dimensions
    tokens = text.lower().split() or [text.lower()]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:2], "big") % dimensions
        vector[index] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def cosine_distance(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    return max(0.0, 1.0 - dot) * 100.0


def metadata_matches(metadata: dict[str, Any], where: dict[str, Any] | None) -> bool:
    if not where:
        return True
    return all(metadata.get(key) == value for key, value in where.items())


@dataclass
class StoredDoc:
    id: str
    document: str
    metadata: dict[str, Any]
    vector: list[float]


@dataclass
class VectorIndex:
    name: str
    dimensions: int = DIMENSIONS
    bit_width: int = 4
    prefer_turbovec: bool = True
    docs: dict[str, StoredDoc] = field(default_factory=dict)
    numeric_ids: dict[int, str] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    turbovec: Any | None = None
    backend: str = "fallback"

    def __post_init__(self) -> None:
        if self.prefer_turbovec and IdMapIndex is not None:
            self.turbovec = IdMapIndex(dim=self.dimensions, bit_width=self.bit_width)
            self.backend = "turbovec"

    def numeric_id(self, doc_id: str) -> int:
        digest = hashlib.sha256(doc_id.encode("utf-8")).digest()
        candidate = int.from_bytes(digest[:8], "big") or 1
        while candidate in self.numeric_ids and self.numeric_ids[candidate] != doc_id:
            candidate = (candidate + 1) & UINT64_MAX or 1
        self.numeric_ids[candidate] = doc_id
        return candidate

    def normalized_vector(self, item: dict[str, Any], text: str) -> list[float]:
        vector = item.get("vector")
        if isinstance(vector, list) and all(isinstance(n, (int, float)) for n in vector):
            values = [float(n) for n in vector]
            if len(values) == self.dimensions:
                return values
        return embed_text(text, self.dimensions)

    def add(self, documents: list[dict[str, Any]]) -> None:
        vectors: list[list[float]] = []
        ids: list[int] = []
        with self.lock:
            for item in documents:
                doc_id = str(item["id"])
                text = str(item.get("document", ""))
                metadata = dict(item.get("metadata") or {})
                metadata.setdefault("id", doc_id)
                vector = self.normalized_vector(item, text)
                self.docs[doc_id] = StoredDoc(doc_id, text, metadata, vector)
                vectors.append(vector)
                ids.append(self.numeric_id(doc_id))
            self.add_to_turbovec(vectors, ids)

    def add_to_turbovec(self, vectors: list[list[float]], ids: list[int]) -> None:
        if self.turbovec is None or np is None or not vectors:
            return
        try:
            for numeric_id in ids:
                try:
                    self.turbovec.remove(numeric_id)
                except Exception:
                    pass
            self.turbovec.add_with_ids(
                np.asarray(vectors, dtype=np.float32),
                np.asarray(ids, dtype=np.uint64),
            )
        except Exception as exc:  # noqa: BLE001 - fallback keeps sidecar alive.
            print(f"[turbovec-sidecar] disabling TurboVec backend: {exc}")
            self.turbovec = None
            self.backend = "fallback"

    def query(self, text: str, limit: int, where: dict[str, Any] | None = None) -> dict[str, Any]:
        with self.lock:
            if self.turbovec is not None and np is not None:
                result = self.query_turbovec(text, limit, where)
                if result is not None:
                    return result
            rows = self.query_fallback(text, where)
        return self.response(rows[: max(1, min(limit, 100))])

    def query_fallback(self, text: str, where: dict[str, Any] | None) -> list[tuple[float, StoredDoc]]:
        query_vector = embed_text(text, self.dimensions)
        rows = [
            (cosine_distance(query_vector, doc.vector), doc)
            for doc in self.docs.values()
            if metadata_matches(doc.metadata, where)
        ]
        rows.sort(key=lambda item: item[0])
        return rows

    def query_turbovec(self, text: str, limit: int, where: dict[str, Any] | None) -> dict[str, Any] | None:
        allowed = [
            num for num, doc_id in self.numeric_ids.items()
            if metadata_matches(self.docs[doc_id].metadata, where)
        ]
        if where and not allowed:
            return self.response([])
        try:
            query = np.asarray(embed_text(text, self.dimensions), dtype=np.float32)
            kwargs = {"k": max(1, min(limit, 100))}
            if where:
                kwargs["allowlist"] = np.asarray(allowed, dtype=np.uint64)
            scores, numeric_ids = self.turbovec.search(query, **kwargs)
            selected = self.turbovec_rows(scores, numeric_ids)
            return self.response(selected)
        except Exception as exc:  # noqa: BLE001 - fall back for compatibility.
            print(f"[turbovec-sidecar] TurboVec search failed, falling back: {exc}")
            return None

    def turbovec_rows(self, scores: Any, numeric_ids: Any) -> list[tuple[float, StoredDoc]]:
        selected: list[tuple[float, StoredDoc]] = []
        for score, numeric_id in zip(scores, numeric_ids):
            doc_id = self.numeric_ids.get(int(numeric_id))
            if doc_id and doc_id in self.docs:
                distance = max(0.0, 1.0 - float(score)) * 100.0
                selected.append((distance, self.docs[doc_id]))
        return selected

    def count(self) -> int:
        with self.lock:
            return len(self.docs)

    def response(self, selected: list[tuple[float, StoredDoc]]) -> dict[str, Any]:
        return {
            "ids": [doc.id for _, doc in selected],
            "documents": [doc.document for _, doc in selected],
            "distances": [distance for distance, _ in selected],
            "metadatas": [doc.metadata for _, doc in selected],
        }

    def clear(self) -> None:
        with self.lock:
            self.docs.clear()
            self.numeric_ids.clear()
            if self.backend == "turbovec" and IdMapIndex is not None:
                self.turbovec = IdMapIndex(dim=self.dimensions, bit_width=self.bit_width)
