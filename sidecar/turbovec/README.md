# TurboVec sidecar reference

Reference implementation of the Arra vector proxy protocol for Issue #1438.
It exposes the standard HTTP contract used by `ProxyVectorAdapter`:

- `POST /vectors/add`
- `POST /vectors/query`
- `GET /vectors/stats`
- `DELETE /vectors/collection`
- `GET /health`

Run locally:

```bash
python3 sidecar/turbovec/server.py --port 8082
```

Register it with Arra:

```bash
curl -X POST http://localhost:47778/api/vector/services/register \
  -H 'content-type: application/json' \
  -d '{"name":"turbovec","type":"proxy","endpoint":"http://127.0.0.1:8082"}'
```

The reference server has a dependency-free cosine index fallback so the protocol
can be tested anywhere. It is intentionally small; production TurboVec wiring can
swap the internal `VectorIndex` implementation while preserving the protocol.
