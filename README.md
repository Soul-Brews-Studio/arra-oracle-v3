# Arra Oracle V3 — MCP Memory, Search, and Plugin Layer

[![CI](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE) [![Bun](https://img.shields.io/badge/runtime-Bun%201.2%2B-f9f1e1)](https://bun.sh)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Soul-Brews-Studio/arra-oracle-v3)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSoul-Brews-Studio%2Farra-oracle-v3&env=ORACLE_URL&envDescription=Oracle%20HTTP%20API%20base%20URL%20for%20the%20Studio%20API%20proxy&envLink=https%3A%2F%2Fgithub.com%2FSoul-Brews-Studio%2Farra-oracle-v3%2Fblob%2Falpha%2Fdocs%2Fdeploy-vercel.md%23environment-variables&project-name=arra-oracle-studio&repository-name=arra-oracle-studio) — [Vercel quickstart](docs/deploy-vercel.md)

> "The Oracle Keeps the Human Human" — queryable through MCP, HTTP, CLI, and
> maw-js plugin surfaces.

Arra Oracle V3 is the Oracle family's memory/search layer: an Elysia HTTP API,
MCP tool server, vector indexer, unified plugin runtime, React/Tauri Studio UI,
federation gateway, and operator CLI. It stores local knowledge in SQLite,
indexes it with vector backends, and exposes the same capabilities to humans,
agents, maw-js, and web frontends.

## Quick start: Docker + `arra mine` (recommended)

Use this path first: one local data dir, Docker for HTTP, and `arra mine` to ingest notes before asking.

```bash
export ORACLE_DATA_DIR="$HOME/.arra-oracle-v2"
mkdir -p "$ORACLE_DATA_DIR"

docker run --rm --name arra-oracle -p 47778:47778 \
  -e ORACLE_EMBEDDER=none \
  -v "$ORACLE_DATA_DIR:/data" \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
```

`ORACLE_EMBEDDER=none` is zero-egress mode: no embedding-provider calls; FTS5 works immediately, vectors can be configured later.

In another shell, mine a folder into the same data dir and ask over HTTP:

```bash
export ORACLE_DATA_DIR="$HOME/.arra-oracle-v2"
bunx --package arra-oracle-v3 arra mine ~/notes
curl 'http://localhost:47778/api/v1/search?q=runbook&mode=fts'
```

For MCP clients, point the stdio Docker image at the same data dir:

```bash
claude mcp add arra-oracle -- docker run --rm -i -e ORACLE_LOG_TARGET=stderr \
  -v "$ORACLE_DATA_DIR:/data" ghcr.io/soul-brews-studio/arra-oracle-v3:stdio
claude mcp list              # expect connected; tools/list exposes 28 tools
```

### Developer source path

Use source only when editing core code:

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bunx tsc --noEmit
bun run server                 # HTTP API on http://localhost:47778
```

Useful checks: `curl -sf http://localhost:47778/api/health` and `bun cli/src/cli.ts health`. React UI: `cd frontend && bun install && bun run dev`. Tauri: `cd frontend && cargo tauri dev`.

## Major features

| Area | What ships |
| --- | --- |
| Modular backend | Elysia/SQLite core can run all-local, behind a maw plugin backend, behind edge proxies, or split from vector/MCP adapters. |
| Runtime plug-in/out | Unified manifests enable/disable CLI, menu/API, MCP, proxy, server, export-format, and lifecycle surfaces without forks. |
| MCP memory tools | 28 tools: `____IMPORTANT` plus 27 `oracle_*`, including `oracle_research_note`, `oracle_profile`, and `oracle_trace_distill`. |
| Memory confidence + supersede | Confidence receipts, reversible supersede chains, trace context, and async dry-run consolidation preserve history while deduping. |
| HTTP API | Elysia route clusters under `/api/*`, with health, search, knowledge, vector, menu, plugins, canvas, tenants, settings, and opt-in federation surfaces. |
| Vector search | Configurable providers, LanceDB/local stores, proxy services, export formats, status/config APIs, and FTS fallback paths. |
| maw-js `arra` plugin | `maw arra ...` gives CLI/API/menu access to ARRA verbs, maintenance commands, vector config/health, and server controls. |
| Edge/cloud deploy | Cloudflare Workers remote MCP/canvas/studio/federation shapes, Vercel Studio proxy, Docker, and local Bun modes. |
| Multi-tenant HTTP isolation | Tenant headers and optional tenant tokens scope reads/writes by `tenant_id` for shared HTTP deployments. |
| Federation | Opt-in `/api/federation/*` mesh capability provider for registered nodes, capability discovery, Workers relay smoke, and signed tunnel workflows. |
| Studio + canvas UI | React/Tauri Studio plus `canvas.buildwithoracle.com` workers render search, vectors, plugins, MCP tools, and canvas plugins. |

## Architecture overview

```text
Clients / agents / maw-js / Studio
        │
        ├── CLI: cli/ + maw-plugin/
        ├── MCP stdio: src/index.ts + src/tools/
        ├── HTTP: src/server.ts + src/routes/*
        └── Edge/frontends: src/workers/* + workers/* + api/proxy.ts
                  │
        Unified surfaces and services
        ├── src/plugins/      # manifest loader, runtime plug-in/out surfaces
        ├── src/vector/       # vector providers, export, registry, proxy adapters
        ├── src/storage/      # Drizzle/SQLite backend selector
        ├── src/indexer/      # collection/index jobs and workers
        ├── src/federation/   # mesh capability provider and node registry
        └── src/middleware/   # auth, tenant scope, logging, content negotiation
                  │
        Data: SQLite/Drizzle + FTS + vector stores + local vault files
```

The design goal is one capability core with thin adapters: CLI, menu/API, MCP,
canvas, and web/desktop surfaces reuse shared registries instead of duplicating
business logic; cloud adapters proxy thin edges while shared backend contracts own memory, supersede, vector, plugin, and federation behavior.

## HTTP API and auth

Start the API with `bun run server`. The default port is `47778`.

Common endpoints:

```text
GET  /api/health
GET  /api/v1/search?q=oracle&mode=fts
POST /api/v1/learn
GET  /api/v1/vector/config
GET  /api/v1/vector/status
GET  /api/v1/plugins
GET  /api/v1/menu
GET  /api/v1/canvas/plugins
```

Optional auth/tenant controls:

```bash
export ARRA_API_TOKEN=secret                 # bearer token for protected API calls
export ORACLE_TENANT_TOKENS='acme=secret,*=dev'
curl -H 'Authorization: Bearer secret' -H 'X-Oracle-Tenant: acme' \
  -H 'X-Oracle-Tenant-Token: secret' http://localhost:47778/api/v1/search?q=team
# Tenant ID aliases: X-Tenant-ID, X-Org-Id; X-API-Key can map tenant keys.
```

## Vector backends and export

Vector configuration is exposed through `/api/v1/vector/*` and the CLI:

```bash
bun run src/cli/index.ts vector-config list
bun run src/cli/index.ts vector-config set bge-m3 adapter lancedb
bun run src/cli/index.ts vector-config test bge-m3
bun run src/cli/index.ts export --format markdown --out vault.md
```

Backends are selected by config. The system supports no-embedder/FTS operation,
local providers, remote HTTP/provider fallbacks, proxy services, and collection
exports (`json`, `jsonl`, `csv`, `markdown`).

## Unified plugins

Unified plugin manifests live under `src/plugins/` or installed plugin dirs. A
manifest can contribute any mix of:

- `cli` / `cliSubcommands` for operator commands.
- `apiRoutes` and `menu` rows for Studio and HTTP discovery.
- `mcpTools` for MCP-out tool registration.
- `proxy` and `server` surfaces for sidecars and web apps.
- `exportFormats` and lifecycle hooks.

The built-in `arra` plugin declares CLI, menu, API, swappable DB config, optional
embedder config, and vector health/config verbs.

## maw-js CLI and serve commands

Local plugin install during development:

```bash
ln -s "$PWD/maw-plugin" ~/.maw/plugins/arra
maw plugin enable arra
maw arra health
```

Representative `maw arra` verbs:

```bash
maw arra search "query" --mode fts --limit 5
maw arra learn "new project fact" --project my-repo
maw arra vector-config list --json
maw arra health
maw arra frontend --no-open
maw arra canvas-plugins --json
maw arra export --format markdown --out vault.md
```

Server controls:

```bash
maw arra serve                  # start bun run server in background
maw arra serve --port 47779
maw arra serve --status         # PID + health + tracked port/root
maw arra serve --stop
```

Standalone canvas server:

```bash
bun run src/cli/index.ts canvas-serve --port 47779 --api-base http://localhost:47778
bun run src/cli/index.ts canvas-plugins --json
```

## Canvas subdomain

Canvas is available as both a Cloudflare Worker shape and local standalone app.
It serves:

- Three plugins: `cube`, `galaxy`, `torus`, `graph3d`, `solar`, `wave`, `map3d`.
- React plugins: `map`, `planets`.
- Registry endpoints: `/api/canvas/plugins` and `/api/canvas/registry`.
- Worker-first proxying for other `/api/*` calls with no-store cache headers.
- Browser cache hooks through localStorage and IndexedDB.

## Project structure

```text
src/                  Elysia API, MCP tools, plugin runtime, vector, federation
src/routes/           HTTP route clusters
src/plugins/          Unified plugin manifests and loader
src/workers/          Cloudflare canvas/MCP/federation worker adapters
maw-plugin/           maw-js `arra` plugin surface
cli/                  Published operator CLI package
frontend/             React Studio + Tauri desktop shell
tests/http/           Fetch/Elysia contract tests by route cluster
docs/                 Deep-dive docs and runbooks
catalog/              Docker MCP Toolkit catalog entry
```

## Testing and contribution gates

```bash
bunx tsc --noEmit                  # required build gate
bun test tests/http/<cluster>/     # scoped HTTP tests
bun test tests/http/canvas/        # canvas close-out flow
cd frontend && bun run build       # frontend build when UI changes
```

Work targets `alpha`; never push or merge directly to `main`. Keep source, test,
and docs files at or below 250 lines. Prefer scoped tests over bare `bun test`
because worktree copies under `agents/` can pollute broad discovery.

## Docs navigation

- [docs/README.md](docs/README.md) — docs index and feature knobs.
- [docs/INSTALL.md](docs/INSTALL.md) — Bun, Docker, and MCP Toolkit install.
- [docs/API.md](docs/API.md) — HTTP API reference.
- [docs/FEDERATION.md](docs/FEDERATION.md) — opt-in federation mesh provider.
- [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) — local development workflow.
- [CHANGELOG.md](CHANGELOG.md) — alpha wave release notes.

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex Newman — process manager patterns, worker service architecture, and hook system concepts.
