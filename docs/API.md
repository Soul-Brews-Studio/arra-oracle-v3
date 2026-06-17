# Arra Oracle API Reference

Base URL defaults to `http://localhost:47778`. Frontend dev servers proxy `/api/*` to
that backend. When `ARRA_API_TOKEN` is set, protected `/api/*` calls need
`Authorization: Bearer <token>` or `?token=<token>`; `/api/health`,
`/api/docs`, `/api/peer/*`, and `/api/identity` stay open.

This page covers the active menu, plugin, vector, and MCP tool-listing surfaces.
Swagger UI is mounted at `/api/docs`; legacy `/swagger` redirects there.

## Common error shape

```json
{ "error": "not found" }
```

Validation errors use 4xx status codes. Proxy/upstream failures commonly return
`502` or `503` with `{ "error": "..." }`.

## Menu API

`GET /api/menu` returns frontend navigation aggregated from route metadata,
Drizzle-backed `menu_items`, file-backed custom items, gist menu config, and
unified plugin menu entries.

### Menu item shape

```ts
type MenuItem = {
  id?: string; parentId?: string | null;
  path: string; label: string;
  group: 'main' | 'tools' | 'admin' | 'hidden';
  order: number;
  icon?: string; studio?: string | null;
  access?: 'public' | 'auth';
  source: 'api' | 'page' | 'plugin';
  sourceName?: string; added?: boolean; hidden?: boolean;
  scope?: 'main' | 'sub' | 'both';
  query?: Record<string, string>;
};
```

### Menu endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/menu?host=&scope=` | optional `host`, `scope=main\|sub\|both` | `{ items: MenuItem[] }` |
| `GET` | `/api/menu/source` | none | `{ url, hash, loaded_at, status }` |
| `POST` | `/api/menu/reload` | none | refreshed source object |
| `POST` | `/api/menu/source` | `{ url, mode?: 'merge'\|'override' }` | `{ mode, source }` |
| `DELETE` | `/api/menu/source` | none | source object with cleared URL |
| `GET` | `/api/menu/source/official` | none | `{ url }` |
| `POST` | `/api/menu/reset-all` | none | reset counts plus `source` |
| `GET` | `/api/menu/custom` | none | `{ items: MenuItem[] }` |
| `POST` | `/api/menu/custom` | `{ path, label, group?, order?, icon? }` | `{ item, replaced }` |
| `DELETE` | `/api/menu/custom/*` | path suffix is URL-encoded item path | `{ removed, path }` |
| `GET` | `/api/menu/tree` | none | `{ items: MenuTreeNode[] }` |
| `GET` | `/api/menu/items` | none | `{ items: MenuRow[] }` |
| `POST` | `/api/menu/items` | `MenuRowCreate` | created `MenuRow` (`201`) |
| `PATCH` | `/api/menu/items/:id` | partial `MenuRowCreate` except `path` | updated `MenuRow` |
| `DELETE` | `/api/menu/items/:id` | none | `{ id, deleted: 'hard'\|'soft' }` |
| `POST` | `/api/menu/reorder` | `{ items: [{ id, parentId?, position }] }` | `{ updated, ids }` |
| `POST` | `/api/menu/reset/:id` | none | `{ id, path, touchedAt: null }` |

`MenuRowCreate` fields: `path`, `label`, `groupKey?`, `parentId?`, `position?`,
`enabled?`, `access?`, `icon?`, `host?`, `hidden?`, `scope?`, and `query?`.

### Menu examples

```bash
curl http://localhost:47778/api/menu?scope=main
curl -X POST http://localhost:47778/api/menu/custom \
  -H 'content-type: application/json' \
  -d '{"path":"/canvas","label":"Canvas","group":"tools"}'
curl -X POST http://localhost:47778/api/menu/reorder \
  -H 'content-type: application/json' \
  -d '{"items":[{"id":1,"parentId":null,"position":10}]}'
```

## Plugins API

Plugins live under plugin directories such as `~/.oracle/plugins/<name>/` with a
`plugin.json` manifest, or as legacy flat `.wasm` files. The unified loader can
also register plugin API routes, proxy routes, menu entries, MCP tools, CLI
subcommands, and plugin-owned sidecar servers.

### Plugin listing and wasm endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/plugins` | none | `{ plugins: PluginEntry[], dir?: string }` |
| `GET` | `/api/plugins/:name` | plugin name | `application/wasm` bytes or `404` |
| `PATCH` | `/api/plugins/:name/state` | `{ enabled: boolean }` | persists manifest state; runtime reload still required |
| `POST` | `/api/plugins/:name/toggle` | `{ enabled?: boolean }` or empty body | persists state and reloads unified runtime MCP tools |

```ts
type PluginEntry = {
  name: string; file: string; size: number; modified: string;
  version?: string; description?: string;
  menu?: { label: string; group?: 'main'|'tools'|'hidden'; order?: number; icon?: string; path?: string };
  server?: { command: string; args?: string[]; healthPath?: string; autostart?: boolean };
};
```

Example:

```bash
curl http://localhost:47778/api/plugins
curl -o plugin.wasm http://localhost:47778/api/plugins/canvas-inspector
curl -X POST http://localhost:47778/api/plugins/community-search/toggle \
  -H 'content-type: application/json' \
  -d '{"enabled":false}'
```

### Plugin-owned server endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/plugins/:name/server/health` | none | `{ ok, plugin, healthy, status?, healthPath, routePrefix, startedAt }` |
| `ALL` | `/api/plugins/:name/server/*` | forwarded method, headers, query, body | upstream plugin server response |

Missing server configs return:

```json
{ "ok": false, "plugin": "missing", "error": "plugin server not found" }
```

Unified plugin manifests may additionally expose `apiRoutes` at their declared
absolute paths and `proxy` routes at their declared absolute paths.

## Vector API

The vector route cluster is mounted under `/api`. Some historical vector routes
remain top-level (`/api/similar`, `/api/compare`, `/api/map`, `/api/map3d`) while
newer control/status routes live under `/api/vector/*`.

### Vector endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/vector/health` | none | `{ status: 'ok'\|'degraded'\|'down', engines, checked_at, proxy? }` |
| `GET` | `/api/vector/stats` | none | per-engine collection counts or `{ error }` |
| `GET` | `/api/vector/config` | none | `{ source: 'file'\|'defaults', config }` |
| `POST` | `/api/vector/index/start` | `{ model?: string, batchSize?: number }` | `{ jobId, status: 'started', model, batchSize }` |
| `GET` | `/api/vector/index/status` | none | current job plus `docsPerSec` and `eta` |
| `GET` | `/api/vector/index/models` | none | `{ models: { [key]: { collection, model, adapter, count? } } }` |
| `ALL` | `/api/vector-db/*` | forwarded method, headers, query, body | sidecar vector DB response |
| `GET` | `/api/similar?id=&limit=&model=` | doc id, optional limit/model | `{ docId, results }` or `{ error, results: [], docId }` |
| `GET` | `/api/compare?q=&models=&limit=&type=&project=&cwd=` | query plus optional filters | `{ query, models, byModel, agreement }` |
| `GET` | `/api/map` | none | `{ documents, total }` |
| `GET` | `/api/map3d?model=` | optional model | `{ documents, total }` |

The default sidecar proxy manifest is `path=/api/vector-db`,
`targetEnv=VECTOR_DB_URL`, `stripPrefix=true`. When `VECTOR_URL` is configured,
vector handlers proxy to that remote vector server where supported.

### Vector examples

```bash
curl http://localhost:47778/api/vector/health
curl http://localhost:47778/api/vector/config
curl -X POST http://localhost:47778/api/vector/index/start \
  -H 'content-type: application/json' \
  -d '{"model":"bge-m3","batchSize":50}'
curl 'http://localhost:47778/api/compare?q=oracle&models=bge-m3,nomic&limit=5'
curl http://localhost:47778/api/vector-db/collections
```

## MCP tool listing API

`GET /api/mcp/tools` exposes the MCP tool catalogue for UI browsers. It returns
core tools plus unified-plugin MCP tools; handler names are intentionally omitted.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/mcp/tools` | none | `{ tools: PublicTool[], total: number }` |

```ts
type PublicTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  group?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
  source: 'core' | 'plugin';
  plugin?: string;
};
```

Unified plugin tools with `"enabled": false` in `plugin.json` are not registered,
listed, or callable. `enabledByDefault: false` keeps a tool registered but hides
it unless config explicitly enables it.

Core tool names: `____IMPORTANT`, `oracle_search`, `oracle_read`,
`oracle_learn`, `oracle_list`, `oracle_stats`, `oracle_concepts`,
`oracle_supersede`, `oracle_handoff`, `oracle_inbox`, `oracle_thread`,
`oracle_threads`, `oracle_thread_read`, `oracle_thread_update`, `oracle_trace`,
`oracle_trace_list`, `oracle_trace_get`, `oracle_trace_link`,
`oracle_trace_unlink`, `oracle_trace_chain`, `oracle_reflect`, `oracle_verify`,
`oracle_mcp_list_tools`, and `oracle_mcp_call`.

Example:

```bash
curl http://localhost:47778/api/mcp/tools
```

Response excerpt:

```json
{
  "tools": [
    { "name": "oracle_search", "group": "search", "readOnly": true, "source": "core" },
    { "name": "oracle_canvas_inspect", "plugin": "canvas-inspector", "source": "plugin" }
  ],
  "total": 2
}
```
