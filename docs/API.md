# Arra Oracle API Reference

Verified against `src/server.ts`, `src/routes/*`, `src/tools/mcp-manifest.ts`,
and `src/tools/mcp-rest-map.ts` on 2026-06-17. The internal Elysia routes are
mounted under `/api/*`; the runnable server redirects most unversioned `/api/*`
requests to `/api/v1/*` and rewrites them internally. `/api/health` stays
unversioned for probes. Swagger UI is `/api/docs`; JSON is `/api/docs/json`.

## Auth, tenants, and errors

- If `ARRA_API_TOKEN` is set, send `Authorization: Bearer <token>` for protected
  `/api/*`; `/api/health` and `/api/docs*` remain open.
- If `ARRA_API_KEY` is set, it is also a bearer guard; only `/api/health` is
  bypassed. Do not set the two guards to different values for the same server.
- Tenant scope: `X-Oracle-Tenant: <id>`. If `ORACLE_TENANT_TOKENS` is set, also
  send `X-Oracle-Tenant-Token`; tenant API keys may be supplied with `X-API-Key`.
- Common errors are `{ "error": "..." }` or structured `{ success: false,
  error, code?, details? }` from middleware.

```bash
BASE=http://localhost:47778
AUTH=(-H "Authorization: Bearer $ARRA_API_TOKEN")
curl -sf "$BASE/api/health"
curl -sf "${AUTH[@]}" "$BASE/api/v1/mcp/tools"
```

## Route inventory by family

`createApp()` currently exposes 185 routes, 181 under `/api`; dynamic plugin
routes may add more at runtime. These families match the mounted source modules.

| Family | Methods and paths |
| --- | --- |
| Root/docs | `GET /`, `/swagger*` redirects, `GET /api/docs`, `/api/docs/json`, `/api/openapi.json` |
| Auth/settings | `GET /api/auth/status`; `POST /api/auth/login`, `/api/auth/logout`; `GET/POST /api/settings/`; `GET /api/settings/system` |
| Health/runtime | `GET /api/health`, `/api/health/deep`, `/api/stats`, `/api/metrics`, `/api/dashboard*`, `/api/session/stats`, `/api/oracles*`, `/api/gateway/*` |
| Search/knowledge | `GET /api/search`, `/api/read`, `/api/list`, `/api/concepts`, `/api/reflect`; `GET/POST/PUT/DELETE /api/learn*`; `POST /api/handoff`, `/api/research/note`, `/api/verify`; `GET /api/inbox`, `/api/verify` |
| Memory | `POST /api/memory/save`, `/api/memory/closeout`; `GET /api/memory/morning-tape`, `/api/memory/recall`, `/api/memory/search`, `/api/memory/fanout` |
| Vector/indexer | `GET /api/vector/*`, `/api/similar`, `/api/compare`, `/api/map`, `/api/map3d`; `POST/PATCH/PUT/DELETE /api/vector/config*`, `/api/vector/collections*`, `/api/vector/services*`, `/api/vector/providers/test`, `/api/vector/costs/usage`, `/api/vector/index/*`; `ALL /api/vector-db*`; `GET/POST /api/indexer/*` |
| Export/import | `GET /api/export*`; `POST /api/export`, `/api/export/run`, `/api/export/app/run`, `/api/export/batch`, `/api/export/import`, `/api/export/test-connection` |
| Menu/plugins/canvas | `GET/POST/PUT/PATCH/DELETE /api/menu*`; `GET/PATCH/POST /api/plugins*`; `GET /api/canvas/plugins*`, `/api/canvas/registry` |
| Files/vault | `GET /api/context`, `/api/file`, `/api/graph`, `/api/logs`, `/api/doc/:id`; `POST /api/doc`, `/api/vault/sync`; `PATCH /api/doc/:id` |
| Collaboration | `GET/POST /api/feed/`; `GET /api/threads`, `/api/thread/:id`; `POST /api/thread`; `PATCH /api/thread/:id/status`; `GET/POST/DELETE /api/traces*`; `GET/POST/PATCH /api/schedule*`; `GET/POST /api/supersede*` |
| Admin/ops | `GET/POST /api/tenants*`; `GET/POST /api/watcher/*`; `GET /api/mcp/tools` |

## Request/response examples

### Search

```bash
curl -s "${AUTH[@]}" \
  "$BASE/api/v1/search?q=oracle&mode=fts&limit=2&asOf=2026-06-17T00:00:00Z"
```

```json
{ "query": "oracle", "results": [{ "id": "doc_1", "type": "learning", "sourceFile": "ψ/memory/learnings/x.md" }], "total": 1, "searchTimeMs": 8 }
```

### Learn

```bash
curl -s "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"pattern":"Document the verified API surface","concepts":["docs","api"],"project":"arra"}' \
  "$BASE/api/v1/learn"
```

```json
{ "success": true, "file": "ψ/memory/learnings/2026-06-17_document-the-verified-api-surface.md", "id": "learning_2026-06-17_document-the-verified-api-surface" }
```

### Health and vector health

```bash
curl -s "$BASE/api/health"
curl -s "${AUTH[@]}" "$BASE/api/v1/vector/health"
```

```json
{ "status": "ok", "server": "arra-oracle-v3", "db": "connected", "vectorStatus": "ok", "mcp": { "toolCount": 27 } }
```

```json
{ "status": "ok", "engines": [{ "key": "bge-m3", "ok": true }], "checked_at": "2026-06-17T00:00:00.000Z" }
```

### Vector config and indexing

```bash
curl -s "${AUTH[@]}" -H 'content-type: application/json' \
  -X PATCH -d '{"enabled":true,"engine":"lancedb"}' \
  "$BASE/api/v1/vector/config"
curl -s "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"model":"bge-m3","batchSize":50}' \
  "$BASE/api/v1/vector/index/start"
```

```json
{ "success": true, "reloaded": true, "source": "file", "enabled": true, "collections": [{ "key": "bge-m3", "model": "bge-m3" }] }
```

```json
{ "jobId": "vidx-1718582400000", "status": "started", "model": "bge-m3", "batchSize": 50, "source": "auto" }
```

### Menu and plugin state

```bash
curl -s "${AUTH[@]}" "$BASE/api/v1/menu?scope=main"
curl -s "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"path":"/canvas","label":"Canvas","group":"tools","order":40}' \
  "$BASE/api/v1/menu/custom"
curl -s "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"enabled":false}' "$BASE/api/v1/plugins/community-search/toggle"
```

```json
{ "items": [{ "path": "/search", "label": "Search", "group": "main", "source": "api" }] }
```

```json
{ "added": true, "replaced": false, "item": { "path": "/canvas", "label": "Canvas", "group": "tools", "order": 40, "source": "page", "added": true } }
```

```json
{ "ok": true, "plugin": "community-search", "enabled": false, "reloaded": true, "mcpTools": [] }
```

### Export job

```bash
curl -s "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"collection":"oracle_documents","format":"json"}' \
  "$BASE/api/v1/export"
```

```json
{ "job": { "id": "export_01", "status": "queued", "format": "json", "source": "vault", "collection": "oracle_documents", "progress": 0 } }
```

## MCP tool catalogue

`GET /api/v1/mcp/tools` returns core tools plus active plugin tools; handler names
are omitted. The 27 core names are, in order:

`____IMPORTANT`, `oracle_search`, `oracle_read`, `oracle_learn`, `oracle_list`,
`oracle_stats`, `oracle_concepts`, `oracle_supersede`, `oracle_research_note`,
`oracle_handoff`, `oracle_inbox`, `oracle_thread`, `oracle_threads`,
`oracle_thread_read`, `oracle_thread_update`, `oracle_profile`, `oracle_trace`,
`oracle_trace_list`, `oracle_trace_get`, `oracle_trace_link`,
`oracle_trace_unlink`, `oracle_trace_chain`, `oracle_trace_distill`,
`oracle_reflect`, `oracle_verify`, `oracle_mcp_list_tools`, `oracle_mcp_call`.

```json
{
  "tools": [
    {
      "name": "oracle_search",
      "group": "search",
      "readOnly": true,
      "remoteable": true,
      "rest": { "method": "GET", "path": "/api/search" },
      "source": "core"
    }
  ],
  "total": 27
}
```

Remoteable tools have a `rest` method/path; local-only tools have
`localOnlyReason`. Plugin tools use `source: "plugin"` and include `plugin`.
