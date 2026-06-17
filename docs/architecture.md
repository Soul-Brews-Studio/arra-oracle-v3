# Arra Oracle architecture overview

Arra Oracle is the Oracle family's installable memory/search layer. One core
runtime exposes the same capabilities through HTTP, MCP stdio, the `arra` CLI,
Studio UI, unified plugins, and Docker/MCP Toolkit packaging.

## Design goals

- **Easy install:** `bun add -g github:Soul-Brews-Studio/arra-oracle-v3#vX.Y.Z`
  should be enough to run the server and CLI.
- **One capability core:** HTTP routes, MCP tools, CLI commands, and plugins reuse
  shared handlers instead of duplicating business logic.
- **Local-first data:** SQLite + FTS5 remain available even when vector backends
  or remote services are disabled.
- **Plugin-shaped extension:** external features should install as plugin folders
  or artifacts, not require editing core source.

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
        ├─ src/tools/       MCP/CLI-ready tool handlers
        ├─ src/vector/      vector adapters and config
        ├─ src/indexer/     document parsing and backfill jobs
        ├─ src/gateway/     federation/proxy guardrails
        ├─ src/middleware/  auth, tenant, logging, negotiation
        └─ SQLite + FTS5 + vector stores + vault markdown
```

## Request paths

| Surface | Entrypoint | Primary contracts |
| --- | --- | --- |
| HTTP | `src/server.ts` | Elysia route clusters under `/api/*`, `/health` |
| MCP embedded | `src/index.ts` | `oracle_search`, `oracle_learn`, `oracle_read`, plugin tools |
| MCP proxy | `ORACLE_HTTP_URL` | Stdio MCP forwards covered writes/reads to HTTP |
| CLI | `cli/src/cli.ts` | Built-ins plus plugin commands, target config, install helpers |
| Studio | `frontend/` | React pages over HTTP routes and plugin/menu registries |
| Docker | `Dockerfile`, `catalog/` | HTTP image, stdio image, Docker MCP Toolkit catalog |

## Data flow

```text
markdown/import/API write
        │
        ▼
parse/index document chunks
        │
        ├─ oracle_documents metadata table
        ├─ oracle_fts keyword index
        └─ vector collection when enabled
        │
        ▼
search/list/read/export through HTTP, MCP, CLI, or plugin routes
```

`oracle_documents` is the tenant-scoped source of truth for indexed metadata.
FTS5 provides the always-on fallback search path. Vector adapters are optional
and configured per model/collection.

## Plugin architecture

Unified plugins are directories with `plugin.json` plus an entry module. The
runtime scans `~/.arra/plugins` and `~/.oracle/plugins`, normalizes manifests,
and registers declared surfaces:

| Manifest key | Runtime effect |
| --- | --- |
| `apiRoutes[]` | Adds Elysia routes to the main HTTP server |
| `mcpTools[]` | Adds tool definitions and dispatchable plugin MCP calls |
| `menu[]` | Adds Studio/menu navigation rows |
| `cliSubcommands[]` | Adds `arra <command>` operator commands |
| `proxy[]` | Adds guarded proxy routes to external services |
| `server` | Starts or lazily proxies a plugin-owned child service |
| `exportFormats[]` | Adds app export formats |

Easy plugin install should place the same folder shape under a plugin home, so
installers only need to fetch, build/copy artifacts, and write `plugin.json`.
See [PLUGIN-GUIDE.md](./PLUGIN-GUIDE.md) for authoring and packaging.

## Security and isolation

- Protected HTTP writes use bearer tokens when `ARRA_API_TOKEN` is set.
- Shared HTTP deployments can require `ORACLE_TENANT_TOKENS` and scope reads/writes
  by `tenant_id`.
- MCP stdio mode sends logs to stderr with `ORACLE_LOG_TARGET=stderr`.
- File reads resolve real paths and stay inside allowed repo/ghq/vault roots.
- Plugin paths and entry modules are containment-checked before import.

## Operational checks

```bash
arra-oracle-v3 serve --port 47778
curl -sf http://localhost:47778/api/health
arra health
bunx tsc --noEmit
bun test tests/http/health/
bun test tests/plugins/
```

For install steps, start with [INSTALL.md](./INSTALL.md) and
[QUICKSTART.md](./QUICKSTART.md).
