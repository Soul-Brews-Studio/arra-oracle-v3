# Arra Oracle architecture overview

Verified against `src/server.ts`, `src/routes/*`, and `src/tools/*` on
2026-06-17. Arra Oracle is the Oracle family's installable memory/search layer:
SQLite + FTS5 stay local, vector backends are optional, and the same capability
core is exposed through HTTP, MCP stdio, CLI, Studio, plugins, and packaging.

## Design goals

- **One capability core:** HTTP routes, MCP tools, CLI commands, and plugins reuse
  shared handlers instead of duplicating business logic.
- **Local-first operation:** search, learn, read, and list work from SQLite/FTS5
  even when vector services or remote proxies are disabled.
- **Plugin-shaped extension:** additional API routes, MCP tools, menu items,
  sidecars, export formats, and CLI commands come from `plugin.json` manifests.
- **Safe multi-tenant deploys:** token auth and tenant headers scope data without
  changing local-first defaults.

## Runtime map

```text
Users, agents, Studio, maw-js, MCP clients
        │
        ├─ Server bin: bin/arra.ts (`arra-oracle-v3 serve|mcp`)
        ├─ Operator CLI: cli/src/cli.ts (`arra ...`)
        ├─ HTTP API: src/server.ts + src/routes/*
        ├─ MCP stdio: src/index.ts + src/tools/*
        └─ Plugin runtime: src/plugins/unified-loader.ts
                  │
        Core services and storage
        ├─ src/tools/       MCP-ready handlers and REST mapping
        ├─ src/vector/      vector adapters, config, provider detection
        ├─ src/indexer/     document parsing, scan/reindex, daemon jobs
        ├─ src/gateway/     vector/gateway status and proxy guardrails
        ├─ src/middleware/  versioning, auth, tenant, limits, errors
        └─ SQLite + FTS5 + optional vector stores + vault markdown
```

## Request lifecycle

1. `createStartedApp()` validates env, resets indexing status, preflights vector
   runtime, starts file/plugin watchers, seeds menus, then wraps `app.fetch()`.
2. `createApiVersionedFetch()` redirects public non-health `/api/*` requests to
   `/api/v1/*` and rewrites `/api/v1/*` back to internal `/api/*` routes.
3. Global middleware adds request logging, correlation IDs, tenant context, CORS,
   private-network preflight, version/security/content headers, body limits,
   optional API-key/token auth, rate limits, metrics, compression, ETags, DB
   context, request de-duplication, timeouts, structured errors, and not-found
   handling.
4. `createServerRouteModules()` mounts the Elysia route modules, then plugin
   routes, then the not-found boundary. A source inspection currently builds 185
   routes, 181 of them under `/api`.

## HTTP route families

| Family | Source modules | Primary paths |
| --- | --- | --- |
| Health/status | `routes/health`, `routes/metrics`, `gateway` | `/api/health`, `/api/health/deep`, `/api/stats`, `/api/metrics`, `/api/gateway/*` |
| Search/knowledge | `routes/search`, `routes/learn`, `routes/knowledge` | `/api/search`, `/api/list`, `/api/read`, `/api/learn*`, `/api/handoff`, `/api/inbox` |
| Vector/indexer | `routes/vector`, `routes/indexer` | `/api/vector/*`, `/api/vector-db*`, `/api/similar`, `/api/compare`, `/api/map*`, `/api/indexer/*` |
| Studio/admin | `routes/menu`, `routes/plugins`, `routes/canvas`, `routes/settings` | `/api/menu*`, `/api/plugins*`, `/api/canvas/*`, `/api/settings/*` |
| Collaboration | `routes/forum`, `routes/traces`, `routes/schedule`, `routes/supersede` | `/api/thread*`, `/api/threads`, `/api/traces*`, `/api/schedule*`, `/api/supersede*` |
| Import/export | `routes/export`, `routes/vault`, `routes/files` | `/api/export*`, `/api/vault/sync`, `/api/doc*`, `/api/file`, `/api/context`, `/api/graph` |
| MCP catalogue | `routes/mcp`, `src/tools/mcp-rest-map.ts` | `/api/mcp/tools` plus MCP stdio tools |

## MCP and HTTP coupling

`src/tools/mcp-manifest.ts` defines 27 core MCP tools. `src/tools/mcp-rest-map.ts`
uses the same ordered names to mark 24 tools as HTTP-remoteable and three as
local-only (`____IMPORTANT`, `oracle_mcp_list_tools`, `oracle_mcp_call`).
`GET /api/mcp/tools` merges those core definitions with active plugin tools and
returns public metadata only; plugin handlers are never exposed.

Example catalogue item:

```json
{
  "name": "oracle_search",
  "group": "search",
  "readOnly": true,
  "remoteable": true,
  "rest": { "method": "GET", "path": "/api/search" },
  "source": "core"
}
```

## Data flow

```text
HTTP/MCP/CLI/plugin write
        │
        ▼
parse + normalize document metadata
        │
        ├─ oracle_documents tenant-scoped source of truth
        ├─ oracle_fts keyword index for always-on recall
        └─ optional vector collection via configured adapter/provider
        │
        ▼
search/list/read/export via HTTP, MCP, CLI, Studio, or plugin routes
```

`oracle_documents` owns metadata and tenant scope. FTS5 owns the fallback search
path. Vector config lives in `vector-server.json`; default collections are
`bge-m3`, `nomic`, and `qwen3`, with a default sidecar proxy manifest at
`/api/vector-db*` using `VECTOR_DB_URL`.

## Plugin architecture

Unified plugins are folders with `plugin.json` plus code/artifacts. The runtime
scans parent `.maw/plugins`, `$MAW_PLUGINS_DIR`, `~/.maw/plugins`,
`~/.arra/plugins`, and `~/.oracle/plugins`, normalizes manifests, and registers:

| Manifest key | Runtime effect |
| --- | --- |
| `apiRoutes[]` / `proxy[]` | Mounted HTTP routes or guarded upstream proxies |
| `mcpTools[]` | Extra MCP definitions and dispatchable plugin calls |
| `menu[]` | Studio/menu rows seeded into `/api/menu` |
| `cliSubcommands[]` | `arra <command>` operators |
| `server` | Child sidecar service health/proxy lifecycle |
| `exportFormats[]` | Additional export app formats |

## Security and isolation

- `ARRA_API_TOKEN` protects `/api/*` except `/api/health` and `/api/docs*`.
- `ARRA_API_KEY` is a legacy bearer guard that only bypasses `/api/health`.
- Tenant scope comes from `X-Oracle-Tenant`; `ORACLE_TENANT_TOKENS` can require
  `X-Oracle-Tenant-Token` per tenant or wildcard.
- MCP stdio logs go to stderr when `ORACLE_LOG_TARGET=stderr`.
- File reads resolve real paths inside allowed repo/ghq/vault roots, and plugin
  paths/entry modules are containment-checked before import.

## Operational checks

```bash
arra-oracle-v3 serve --port 47778
curl -sf http://localhost:47778/api/health
curl -H "Authorization: Bearer $ARRA_API_TOKEN" \
  'http://localhost:47778/api/v1/search?q=oracle&mode=fts&limit=3'
curl -sf http://localhost:47778/api/v1/mcp/tools
bunx tsc --noEmit
bun test tests/http/health/ tests/http/mcp/tools.test.ts
```

For install steps, start with [INSTALL.md](./INSTALL.md) and
[QUICKSTART.md](./QUICKSTART.md). See [API.md](./API.md) for request/response
examples and [PLUGIN-GUIDE.md](./PLUGIN-GUIDE.md) for plugin packaging.
