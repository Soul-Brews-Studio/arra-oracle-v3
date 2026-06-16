# TurboVec sidecar reference

Reference implementation of the Arra vector proxy protocol for Issue #1438.
It exposes the standard HTTP contract used by `ProxyVectorAdapter`:

- `POST /vectors/add`
- `POST /vectors/query`
- `GET /vectors/stats`
- `DELETE /vectors/collection`
- `GET /health`

`GET /health` includes `protocol: "vector-proxy-v1"` so Arra can verify the
service speaks the #1438 proxy contract.

Run locally with the dependency-free fallback backend:

```bash
python3 sidecar/turbovec/server.py --port 8082 --backend fallback
```

Run with TurboVec when the optional Python package is installed:

```bash
python3 sidecar/turbovec/server.py --port 8082 --backend turbovec
```

The default `--backend auto` uses TurboVec when importable, otherwise it falls
back to the in-memory cosine index. `--dimensions` and `--bit-width` configure
the wrapped `IdMapIndex`.

Register it with Arra:

```bash
curl -X POST http://localhost:47778/api/vector/services/register \
  -H 'content-type: application/json' \
  -d '{"name":"turbovec","type":"proxy","endpoint":"http://127.0.0.1:8082"}'
```

The sidecar uses a lock around index mutation/query to preserve the proxy
contract under concurrent HTTP requests. Health and stats responses include a
`backend` field (`turbovec` or `fallback`) for registry diagnostics.
