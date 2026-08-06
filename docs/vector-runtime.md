# Vector runtime mode

Arra keeps an FTS5 floor: `/api/search` always runs the local SQLite FTS leg, even when the vector layer is disabled or proxied. Vector failures must degrade to FTS5 results instead of making core search unavailable.

`/api/health` exposes the current vector runtime:

- `vectorMode: "embedded"` — local vector adapter is usable in this process.
- `vectorMode: "proxied"` — `VECTOR_URL` is set and vector requests are sent to a separate vector HTTP process.
- `vectorMode: "disabled"` — local vector is intentionally unavailable, for example CPU/AVX guard failure or a missing local vector index.

To split vector work out of the core server today, run a compatible vector HTTP service and start the core server with:

```bash
VECTOR_URL=http://127.0.0.1:48080 bun src/server.ts
```

With `VECTOR_URL` set, hybrid search still performs local FTS5 first and asks the vector service for the vector leg. If the proxy is down, search returns FTS5-only results with `vectorAvailable: false`.
