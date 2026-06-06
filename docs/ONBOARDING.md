# Progressive onboarding

This is the capstone first-run path for epic #1369. The rule is progressive disclosure: start useful with the smallest local surface, then opt into MCP, indexing, vectors, cloud/proxy, and audit visibility as you need them.

## 0. Start the server

```bash
bunx --bun --package github:Soul-Brews-Studio/arra-oracle-v3 arra-oracle
# or from source:
bun run server
```

The HTTP API defaults to `http://localhost:47778`. Check liveness with:

```bash
curl http://localhost:47778/api/health
```

## 1. Search immediately: FTS5 floor (#1370)

A fresh install does not need LanceDB, Ollama, or a vector index before it can search. SQLite FTS5 is the always-on floor.

```bash
curl 'http://localhost:47778/api/search?q=oracle&mode=fts'
```

Useful endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search?q=...&mode=fts` | Keyword search through SQLite FTS5. |
| `GET /api/search?q=...&mode=hybrid` | FTS + vector when vectors are available; degrades to FTS during zero-config start. |
| `GET /api/list` | Browse indexed documents. |
| `GET /api/stats` | Document and vector stats. |
| `GET /api/health` | Server health; #1390 adds `vectorMode`. |

If vector setup is missing, keep using FTS. That is expected, not a broken install.

## 2. Connect MCP, then reduce context (#1372/#1373)

Add the MCP server to Claude Code:

```bash
claude mcp add arra-oracle-v3 -- bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3
```

For HTTP-backed MCP usage, set `ORACLE_API` so the stdio MCP process calls the running API instead of opening local storage directly:

```bash
claude mcp add arra-oracle-v3 \
  --env ORACLE_API=http://localhost:47778 \
  -- bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3
```

When the tool list is too large for the task, trim it.

### Config file / env

Persist a strict allow-list in `.arra/config.json`:

```json
{
  "allowed_tools": ["oracle_search", "oracle_read", "oracle_list", "oracle_stats"]
}
```

Equivalent env controls are available for deploys and temporary sessions:

```bash
ORACLE_ENABLED_TOOLS=oracle_search,oracle_read,oracle_list,oracle_stats bun src/index.ts
# or hide only a few:
ORACLE_DISABLED_TOOLS=oracle_trace,oracle_thread bun src/index.ts
```

### Web toggle UI

Open `/tools/config`. It reads and writes the same MCP tool enablement surface through:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/settings/tools` | Read current groups, enabled tools, disabled tools, and config path. |
| `PUT /api/settings/tools` | Persist selected MCP tools as `allowed_tools`. |

Saved toggles apply on the next MCP tool-list refresh / process reload.

## 3. Connect page, token, and MCP install snippet (#1374)

Open:

```text
http://localhost:47778/connect?api=http://localhost:47778
```

The `/connect` page is a browser-local credential helper:

- stores backend URL as `NEO_ARRA_API`;
- stores optional token as `ARRA_API_TOKEN` / `NEO_ARRA_API_TOKEN` in localStorage;
- can generate a random token for you to copy into the server environment;
- renders both `claude mcp add ...` and JSON config snippets.

Server-side token gate:

```bash
ARRA_API_TOKEN='<copy-generated-token>' bun run server
```

With the gate enabled, clients call protected endpoints with:

```http
Authorization: Bearer <token>
```

`/connect` checks `GET /api/health` with that header so you can verify the saved browser connection. Local MCP stdio remains usable without the HTTP token unless you choose the HTTP-backed `ORACLE_API` path.

## 4. Index a ψ vault into FTS (#1375)

When the repo has a `ψ/` directory, first scan it:

```bash
curl -X POST http://localhost:47778/api/indexer/scan \
  -H 'content-type: application/json' \
  -d '{"sourcePath":"/path/to/repo"}'
```

If the response has `psiDetected: true` and `canIndexFts: true`, run the FTS reindex:

```bash
curl -X POST http://localhost:47778/api/indexer/reindex \
  -H 'content-type: application/json' \
  -d '{"repoRoot":"/path/to/repo","scope":"all","wait":true}'
```

Relevant endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/indexer/scan` | Detect markdown files and ψ layout. |
| `POST /api/indexer/reindex` | Build/refresh SQLite + FTS from the server process. |
| `GET /api/indexer/progress` | Read indexing progress/status. |

After this step, `/api/search?mode=fts` should return local ψ results.

## 5. Turn on vectors only when ready (#1377/#1390)

Vectors are optional. Keep FTS running while you prepare engine/model choices.

### Local engine/model selection

Read current vector config:

```bash
curl http://localhost:47778/api/vector/config
```

Switch engine or model registry:

```bash
curl -X PATCH http://localhost:47778/api/vector/config \
  -H 'content-type: application/json' \
  -d '{"engine":"lancedb"}'
```

Supported local engines are exposed by the response and currently include `lancedb`, `sqlite-vec`, and `qdrant`. Embedding model collections live in `vector-server.json` under `ORACLE_DATA_DIR` once you save config.

Build vectors from the FTS-indexed rows:

```bash
curl -X POST http://localhost:47778/api/vector/index/start \
  -H 'content-type: application/json' \
  -d '{"model":"bge-m3"}'
```

Poll:

```bash
curl http://localhost:47778/api/vector/index/status
curl http://localhost:47778/api/vector/health
curl http://localhost:47778/api/vector/stats
```

### Cloud / sidecar proxy

To move vector work out of the core process, run a compatible vector HTTP service and start core with `VECTOR_URL`:

```bash
VECTOR_URL=http://127.0.0.1:48080 bun run server
```

Vector-only routes such as `/api/similar`, `/api/compare`, `/api/map`, `/api/map3d`, `/api/vector/health`, `/api/vector/stats`, and `/api/vector/index/*` are the surface intended to move behind the proxy. Hybrid `/api/search` keeps the local FTS leg and asks the proxy for vector results.

#1390 adds runtime observability to `GET /api/health`:

```json
{
  "vectorMode": "embedded | proxied | disabled",
  "vectorUrl": "http://127.0.0.1:48080",
  "vectorDisabledReason": "CPU lacks AVX or local vector index missing"
}
```

Use this to confirm whether the deployment is embedded, proxied through `VECTOR_URL`, or safely running FTS-only.

## 6. Audit what AI search did (#1384)

Open:

```text
http://localhost:47778/traces
```

The page reads trace/audit data from:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/logs` | List recent AI search log entries. |
| `GET /api/traces` | List trace records. |
| `GET /api/traces/:id` | Inspect one trace. |
| `GET /api/traces/:id/chain` | Follow trace chain context. |
| `GET /api/traces/:id/linked-chain` | Follow explicitly linked traces. |

Use `/traces` after MCP or web search sessions to inspect AI search details instead of guessing what context was pulled.

## Recommended path

1. Start server and confirm `GET /api/health`.
2. Use `GET /api/search?mode=fts` immediately.
3. Add MCP with only the tools needed for the task.
4. Use `/connect` if the deployment has `ARRA_API_TOKEN` or you want copyable MCP snippets.
5. Scan/index ψ with `/api/indexer/scan` and `/api/indexer/reindex`.
6. Add vectors with `/api/vector/config` and `/api/vector/index/start` only after FTS is useful.
7. Check `/api/health` `vectorMode`, `/api/vector/health`, and `/api/vector/stats`.
8. Review `/traces` for auditability.
