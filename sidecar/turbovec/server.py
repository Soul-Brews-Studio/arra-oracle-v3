#!/usr/bin/env python3
"""Reference TurboVec-compatible vector proxy sidecar.

Speaks the arra vector proxy protocol:
  POST   /vectors/add         {"documents": [{id, document, metadata, vector?}]}
  POST   /vectors/query       {"text": str, "limit": int, "where"?: {}}
  GET    /vectors/stats       -> {"count": int, "name": str}
  DELETE /vectors/collection
  GET    /health              -> {"status":"ok", "name":..., "version":...}

This file intentionally has no required dependencies so CI and local smoke tests
can boot it. When TurboVec is installed, it still exposes the same HTTP contract;
the in-memory cosine index is the safe fallback reference path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

VERSION = "0.1.0"
PROTOCOL = "vector-proxy-v1"
DIMENSIONS = 64


def embed_text(text: str) -> list[float]:
    vector = [0.0] * DIMENSIONS
    tokens = text.lower().split() or [text.lower()]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:2], "big") % DIMENSIONS
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
    docs: dict[str, StoredDoc] = field(default_factory=dict)

    def add(self, documents: list[dict[str, Any]]) -> None:
        for item in documents:
            doc_id = str(item["id"])
            text = str(item.get("document", ""))
            metadata = dict(item.get("metadata") or {})
            metadata.setdefault("id", doc_id)
            vector = item.get("vector")
            if not isinstance(vector, list) or not all(isinstance(n, (int, float)) for n in vector):
                vector = embed_text(text)
            self.docs[doc_id] = StoredDoc(doc_id, text, metadata, [float(n) for n in vector])

    def query(self, text: str, limit: int, where: dict[str, Any] | None = None) -> dict[str, Any]:
        query_vector = embed_text(text)
        rows = [
            (cosine_distance(query_vector, doc.vector), doc)
            for doc in self.docs.values()
            if metadata_matches(doc.metadata, where)
        ]
        rows.sort(key=lambda item: item[0])
        selected = rows[: max(1, min(limit, 100))]
        return {
            "ids": [doc.id for _, doc in selected],
            "documents": [doc.document for _, doc in selected],
            "distances": [distance for distance, _ in selected],
            "metadatas": [doc.metadata for _, doc in selected],
        }


class Handler(BaseHTTPRequestHandler):
    index: VectorIndex

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[turbovec-sidecar] {self.address_string()} {fmt % args}")

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or "0")
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path == "/health":
            return self.send_json({"status": "ok", "name": self.index.name, "version": VERSION, "protocol": PROTOCOL})
        if self.path == "/vectors/stats":
            return self.send_json({"count": len(self.index.docs), "name": self.index.name})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self) -> None:
        try:
            body = self.read_json()
            if self.path == "/vectors/add":
                documents = body.get("documents")
                if not isinstance(documents, list):
                    return self.send_json({"error": "documents must be a list"}, 400)
                self.index.add(documents)
                return self.send_json({"success": True, "count": len(documents)})
            if self.path == "/vectors/query":
                text = str(body.get("text", ""))
                limit = int(body.get("limit") or 10)
                where = body.get("where") if isinstance(body.get("where"), dict) else None
                return self.send_json(self.index.query(text, limit, where))
            self.send_json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001 - protocol server should return JSON errors.
            self.send_json({"error": str(exc)}, 500)

    def do_DELETE(self) -> None:
        if self.path == "/vectors/collection":
            self.index.docs.clear()
            return self.send_json({"success": True})
        self.send_json({"error": "not found"}, 404)


def main() -> None:
    parser = argparse.ArgumentParser(description="arra TurboVec proxy protocol sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--name", default="turbovec")
    args = parser.parse_args()

    Handler.index = VectorIndex(args.name)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[turbovec-sidecar] listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
