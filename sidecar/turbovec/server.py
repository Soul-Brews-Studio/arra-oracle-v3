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
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from vector_index import DIMENSIONS, PROTOCOL, VERSION, VectorIndex


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
            return self.send_json({
                "status": "ok",
                "name": self.index.name,
                "version": VERSION,
                "protocol": PROTOCOL,
                "backend": self.index.backend,
            })
        if self.path == "/vectors/stats":
            return self.send_json({
                "count": self.index.count(),
                "name": self.index.name,
                "backend": self.index.backend,
            })
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
            self.index.clear()
            return self.send_json({"success": True})
        self.send_json({"error": "not found"}, 404)


def main() -> None:
    parser = argparse.ArgumentParser(description="arra TurboVec proxy protocol sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--name", default="turbovec")
    parser.add_argument("--dimensions", type=int, default=DIMENSIONS)
    parser.add_argument("--bit-width", type=int, default=4)
    parser.add_argument("--backend", choices=["auto", "turbovec", "fallback"], default="auto")
    args = parser.parse_args()

    Handler.index = VectorIndex(
        args.name,
        dimensions=args.dimensions,
        bit_width=args.bit_width,
        prefer_turbovec=args.backend != "fallback",
    )
    if args.backend == "turbovec" and Handler.index.backend != "turbovec":
        raise SystemExit("turbovec backend requested but package is not installed")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[turbovec-sidecar] listening on http://{args.host}:{args.port} ({Handler.index.backend})")
    server.serve_forever()


if __name__ == "__main__":
    main()
