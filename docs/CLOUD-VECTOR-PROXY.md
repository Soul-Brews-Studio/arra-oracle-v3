# Cloud vector proxy runbook

Arra can keep SQLite/FTS5 local while sending the vector leg to a separate
backend such as a Cloudflare-hosted Worker/service, a VM, or another LAN host.
This is the Tier 4 path for cloud indexing without moving the local ground
truth database.

## Contract

- Local Arra HTTP server keeps `/api/search?mode=fts` as the source of truth.
- Set `VECTOR_URL` (or durable `vectorProxyUrl`) on the core server to route
  vector-only operations backend-to-backend.
- The remote service exposes the same vector HTTP surface:
  - `GET /api/search?...&mode=vector`
  - `GET /api/vector/health`
  - `GET /api/vector/stats`
  - `GET /api/vector/index/models`
  - `GET /api/vector/index/status`
  - `POST /api/vector/index/start`
  - optional visualization routes: `/api/map`, `/api/map3d`, `/api/similar`, `/api/compare`
- If the remote vector service is unavailable, hybrid search degrades to local
  FTS5 results with `vectorAvailable: false` and a warning.

## One-shot env config

```bash
VECTOR_URL="https://vectors.example.com" bun run server
```

Use this for temporary routing, local tunnels, or CI smoke tests. `VECTOR_URL`
wins over file config.

## Durable config

Persist the remote vector base URL in `ORACLE_DATA_DIR/vector-server.json` via
HTTP:

```bash
curl -X PATCH "http://localhost:47778/api/vector/config" \
  -H 'content-type: application/json' \
  --data '{"vectorProxyUrl":"https://vectors.example.com"}'
```

Or edit the file directly:

```json
{
  "version": "1.0",
  "host": "0.0.0.0",
  "port": 8081,
  "vectorProxyUrl": "https://vectors.example.com",
  "dataPath": "~/.arra-oracle-v2/lancedb",
  "embeddingEndpoint": "http://localhost:11434",
  "collections": {}
}
```

Restart the core server after changing file config. The standalone vector
server ignores inherited `VECTOR_URL` so it cannot proxy back to itself.

## Cloudflare shape

A Cloudflare deployment can be any backend that implements the vector HTTP
surface above. Typical options:

- Worker in front of Vectorize / AI Gateway / another vector service.
- Worker proxying to a private vector sidecar.
- Tunnel exposing a VM-hosted `bun src/vector-server.ts`.

Keep auth/token handling at the edge. The core server only needs the base URL.

## Fallback receipt

Hybrid search always runs FTS5 locally first. When remote `/api/search` returns
an error or times out, Arra returns local FTS results instead of failing the
request:

```json
{
  "mode": "hybrid",
  "vectorAvailable": false,
  "warning": "Vector proxy unavailable — FTS5-only results",
  "results": ["local FTS matches..."]
}
```

Vector-only visualization routes such as `/api/map` may return `503` because
there is no meaningful local FTS replacement for embedding maps.
