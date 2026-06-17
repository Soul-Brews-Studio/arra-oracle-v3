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

## Quick start

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bunx tsc --noEmit
bun run server                 # HTTP API on http://localhost:47778
```

Useful checks:

```bash
curl -sf http://localhost:47778/api/health
bun test tests/http/health/
bun run src/cli/index.ts health
```

Run the React Studio UI:

```bash
cd frontend
bun install
bun run dev                    # Vite UI, proxying /api to :47778
```

Desktop app:

```bash
cd frontend
cargo tauri dev                # native shell around the React dashboard
```

Docker HTTP mode:

```bash
docker run --rm -p 47778:47778 -v arra-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
```

## Major features

| Area | What ships |
| --- | --- |
| MCP memory tools | `oracle_search`, `oracle_read`, `oracle_list`, `oracle_learn`, `oracle_handoff`, `oracle_inbox`, trace/thread/supersede/verify tools. |
| HTTP API | Elysia route clusters under `/api/*`, with health, search, knowledge, vector, menu, plugins, canvas, federation, tenants, and settings surfaces. |
| Vector search | Configurable vector providers, LanceDB/local stores, proxy services, export formats, status/config APIs, and graceful fallback to keyword/FTS paths. |
| Unified plugin system | One manifest can declare CLI, menu/API, MCP, proxy, server, export-format, and lifecycle surfaces. |
| maw-js `arra` plugin | `maw arra ...` gives CLI/API/menu access to ARRA verbs, local maintenance commands, vector config/health, and server controls. |
| Multi-tenant HTTP isolation | Tenant headers and optional tenant tokens scope reads/writes by `tenant_id` for shared HTTP deployments. |
| Canvas subdomain | `canvas.buildwithoracle.com` worker/standalone app renders Three + React canvas plugins, registry endpoints, proxying, and cache hooks. |
| Federation | Peer identity, TOFU pins, Scout discovery, OracleNet feed/search, and bearer-protected peer endpoints. |
| Studio UI | React dashboard pages for search, vectors, plugins, canvas plugins, settings, MCP tools, learn, and metrics; Tauri shell for desktop use. |

## Architecture overview

```text
Clients / agents / maw-js / Studio
        │
        ├── CLI: cli/ + maw-plugin/
        ├── MCP stdio: src/index.ts + src/tools/
        ├── HTTP: src/server.ts + src/routes/*
        └── Canvas worker: src/workers/canvas/*
                  │
        Unified surfaces and services
        ├── src/plugins/      # manifest loader, routes, MCP, proxy, server surfaces
        ├── src/vector/       # vector providers, export, registry, proxy adapters
        ├── src/storage/      # Drizzle/SQLite backend interface
        ├── src/indexer/      # collection/index jobs and workers
        ├── src/peer/         # federation identity, registry, TOFU, search/feed
        └── src/middleware/   # auth, tenant scope, logging, content negotiation
                  │
        Data: SQLite/Drizzle + FTS + vector stores + local vault files
```

The design goal is one capability core with thin adapters: CLI, menu/API, MCP,
canvas, and web/desktop surfaces reuse shared registries instead of duplicating
business logic.

## HTTP API and auth

Start the API with `bun run server`. The default port is `47778`.

Common endpoints:

```text
GET  /api/health
GET  /api/search?q=oracle&mode=fts
POST /api/learn
GET  /api/vector/config
GET  /api/v1/vector/status
GET  /api/plugins
GET  /api/menu
GET  /api/canvas/plugins
```

Optional auth/tenant controls:

```bash
export ARRA_API_TOKEN=secret                 # bearer token for protected writes
export ARRA_TENANT_TOKENS='acme=secret,*=dev'
curl -H 'x-arra-tenant: acme' -H 'x-arra-tenant-token: secret' \
  http://localhost:47778/api/search?q=team
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
src/workers/canvas/   Canvas subdomain worker renderer
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
- [docs/FEDERATION.md](docs/FEDERATION.md) — peer pairing, Scout, TOFU, auth.
- [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) — local development workflow.
- [CHANGELOG.md](CHANGELOG.md) — alpha wave release notes.

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex
Newman — process manager patterns, worker service architecture, and hook system
concepts.
