# API reference index

Use this page to choose the right API reference for HTTP, MCP, plugin, vector,
and route-family work.

## Entry points

| Need | Use |
| --- | --- |
| Interactive Swagger UI | `http://localhost:47778/api/docs` |
| Machine-readable spec | [openapi.json](./openapi.json) |
| Full Elysia route inventory | [http-api-reference.md](./http-api-reference.md) |
| Menu, plugin, vector, MCP notes | [API.md](./API.md) |
| Install and auth setup | [INSTALL.md](./INSTALL.md) |
| First-run smoke tests | [QUICKSTART.md](./QUICKSTART.md) |

## Base URL and auth

The default HTTP backend is `http://localhost:47778`. Most `/api/*` routes are
also reachable under `/api/v1/*`; infrastructure routes such as `/api/health`
remain direct.

When `ARRA_API_TOKEN` is set, protected routes need a bearer token:

```bash
curl -H "Authorization: Bearer $ARRA_API_TOKEN" \
  http://localhost:47778/api/stats
```

Tenant-aware routes use `X-Oracle-Tenant` and optional
`X-Oracle-Tenant-Token`:

```bash
curl -H 'X-Oracle-Tenant: team-a' \
  'http://localhost:47778/api/search?q=oracle&limit=5'
```

## Route families

| Family | Common paths | Primary reference |
| --- | --- | --- |
| Health, stats, dashboard | `/api/health`, `/api/stats`, `/api/dashboard` | [http-api-reference.md](./http-api-reference.md#health-metrics-dashboard) |
| Search and memory | `/api/search`, `/api/list`, `/api/memory/*` | [http-api-reference.md](./http-api-reference.md#search-knowledge-learn-memory) |
| Vector and indexer | `/api/vector/*`, `/api/indexer/*`, `/api/map` | [API.md](./API.md#vector-api) |
| Menu and plugins | `/api/menu`, `/api/plugins`, `/api/canvas/*` | [API.md](./API.md#menu-api) |
| MCP catalogue | `/api/mcp/tools` | [API.md](./API.md#mcp-tool-listing-api) |
| Export/import | `/api/export/*`, `/api/vector/export/*` | [http-api-reference.md](./http-api-reference.md#vector-and-indexer) |
| Collaboration | `/api/traces`, `/api/supersede`, `/api/schedule` | [http-api-reference.md](./http-api-reference.md#collaboration-social-traces-schedule) |
| Federation/peer | `/identity`, `/peer/*`, `/search` | [FEDERATION.md](./FEDERATION.md) |

## Curl smoke checks

```bash
curl -sf http://localhost:47778/api/health
curl -sf http://localhost:47778/api/docs >/dev/null
curl 'http://localhost:47778/api/search?q=oracle&mode=fts&limit=5'
curl -sf http://localhost:47778/api/mcp/tools
curl -sf http://localhost:47778/api/vector/health
```

## Adding or changing endpoints

- Add the Elysia route under `src/routes/<cluster>/` and compose it in
  `src/server.ts` when it is a new cluster.
- Add or update fetch-based HTTP tests under `tests/http/<cluster>/`.
- Update [http-api-reference.md](./http-api-reference.md) for route inventory
  changes and [API.md](./API.md) when behavior needs deeper examples.
- Export/update [openapi.json](./openapi.json) when route schemas change.
- Keep changed docs and tests at or below 250 lines per file.
