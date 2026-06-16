# Arra Oracle - MCP Memory Layer

[![CI](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE) [![CalVer](https://img.shields.io/badge/calver-v26.4.20--alpha.7-blue)](https://calver.org) [![Bun](https://img.shields.io/badge/runtime-Bun%201.2%2B-f9f1e1)](https://bun.sh)

> "The Oracle Keeps the Human Human" — now queryable via MCP.

Arra Oracle is the MCP memory and search layer for the Oracle family: semantic
search over local knowledge, vector indexing, federation plumbing, and an Elysia
HTTP API for tools, dashboard, and desktop clients.

See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for local development and
[docs/README.md](docs/README.md) for the full docs index.

## Docs navigation

| Guide | What it covers |
| --- | --- |
| [docs/README.md](docs/README.md) | Docs index and feature-knob map. |
| [docs/INSTALL.md](docs/INSTALL.md) | Fresh install with Bun, Docker GHCR, and Docker MCP Toolkit. |
| [docs/DEPLOY-DIGITALOCEAN.md](docs/DEPLOY-DIGITALOCEAN.md) | DigitalOcean runbook. |
| [docs/FEDERATION.md](docs/FEDERATION.md) | Pairing, Scout discovery, TOFU pins, peer feed/search, and peer auth. |
| [docs/HUGINN-MUNINN.md](docs/HUGINN-MUNINN.md) | Capture/recall naming taxonomy. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Two-repo rule and PR target rules. |
| [CHANGELOG.md](CHANGELOG.md) | Alpha wave release notes and source PR links. |
| [docs/API.md](docs/API.md) | HTTP API reference. |

## Desktop App

The desktop app is a Tauri 2 shell around the Arra Oracle dashboard. It gives
operators a native window for the React UI while controlling the local Bun API
backend on `http://localhost:47778`. The desktop side exposes small Rust commands
for backend status, launch/stop controls, and app metadata such as About info.

### Install

Build a distributable desktop bundle from the frontend workspace:

```bash
bun install
cd frontend
cargo tauri build
```

The Tauri config lives in `frontend/src-tauri/tauri.conf.json`; generated bundles
land under `frontend/src-tauri/target/release/bundle/`.

### Development

Run the desktop shell in dev mode:

```bash
bun install
cd frontend
cargo tauri dev
```

`cargo tauri dev` starts Vite through the Tauri `beforeDevCommand`. The desktop
shell can start/stop the Bun backend, or you can run it separately from the repo
root with `bun run server`.

### Architecture

- **Tauri shell** (`frontend/src-tauri/`) owns the native window, permissions,
  shell plugin, backend process control, and `get_about_info` command.
- **React frontend** (`frontend/src/`) renders the dashboard and calls Tauri
  commands when running inside the desktop shell.
- **Bun backend** (`src/server.ts`) serves the Elysia HTTP API, MCP-adjacent
  memory/search routes, vector endpoints, and federation surfaces on `:47778`.

## Install

### Bun package entry points

```bash
# HTTP API / server launcher
bunx --bun arra-oracle@github:Soul-Brews-Studio/arra-oracle-v3

# MCP server
bunx --bun arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v3

# Operator CLI
bunx --bun arra-cli@github:Soul-Brews-Studio/arra-oracle-v3 --help
bunx --bun arra@github:Soul-Brews-Studio/arra-oracle-v3 health
```

### From source

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bun run server       # HTTP API on :47778
bun run dev          # MCP server
```

### Docker

The `alpha` branch publishes GHCR images for HTTP and MCP stdio modes:

```bash
docker run --rm -p 47778:47778 -v arra-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
curl -sf http://localhost:47778/api/health
```

For Docker MCP Toolkit, use `catalog/arra-oracle.yaml`.

## Operator CLI targets

`arra` and `arra-cli` resolve HTTP API targets from `ORACLE_API`, `arra --at`,
project config, global config, legacy `NEO_ARRA_API`, then localhost.

```bash
arra config          # show resolved target and sources
arra use m5          # set global default target
arra --at m5 health  # one-off target override
arra doctor --json   # machine-readable diagnostics
arra plugins         # list MCP tool plugins
```

## MCP Tools

Core tools include `oracle_search`, `oracle_read`, `oracle_list`,
`oracle_stats`, `oracle_learn`, `oracle_handoff`, `oracle_inbox`,
`oracle_trace*`, `oracle_thread*`, `oracle_supersede`, and `oracle_verify`.

## API and data

- HTTP API: `bun run server` on `:47778`; see [docs/API.md](docs/API.md).
- Database: Drizzle + SQLite (`bun db:push`, `bun db:migrate`, `bun db:studio`).
- Vector/search: LanceDB/Qdrant/sqlite-vec surfaces under `src/vector/` and
  `src/routes/vector/`.
- Optional HTTP auth: set `ARRA_API_TOKEN` for protected `/api/*` routes.

## Project structure

```text
arra-oracle-v3/
├── src/                 # Elysia API, MCP tools, indexer, vector, federation
├── frontend/            # React dashboard and Tauri desktop app
├── cli/                 # arra / arra-cli operator CLI
├── tests/               # HTTP, frontend, integration, and behavior tests
├── docs/                # Detailed operator and architecture docs
└── catalog/             # Docker MCP Toolkit catalog entry
```

## Testing

```bash
bun run build                       # Type-check backend/package
bun test tests/http/<cluster>/      # Scoped HTTP tests
cd frontend && bun run build        # Frontend type-check + Vite build
cd frontend/src-tauri && cargo check
```

## Federation

Arra exposes MAW-compatible peer endpoints for Oracle federation. See
[docs/FEDERATION.md](docs/FEDERATION.md) for pairing, Scout discovery, TOFU
pinning, bearer-token protection, and Arra↔mawjs examples.

## New awakenings welcome

Awakening a new Oracle? Post the birth announcement and experience report to
[Discussions](https://github.com/Soul-Brews-Studio/arra-oracle-v3/discussions),
not Issues. See [docs/CONTRIBUTING-AWAKENING.md](docs/CONTRIBUTING-AWAKENING.md).

## References

- [TIMELINE.md](TIMELINE.md) — evolution history.
- [docs/architecture.md](docs/architecture.md) — architecture details.
- [Drizzle ORM](https://orm.drizzle.team/)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Tauri](https://tauri.app/)

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex
Newman — process manager pattern, worker service architecture, and hook system
concepts.
