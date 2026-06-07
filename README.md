# Arra Oracle - MCP Memory Layer

[![CI](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE) [![CalVer](https://img.shields.io/badge/calver-v26.6.1--alpha.1428-blue)](https://calver.org) [![Bun](https://img.shields.io/badge/runtime-Bun%201.2%2B-f9f1e1)](https://bun.sh)

> "The Oracle Keeps the Human Human" - now queryable via MCP

Phukhao Oracle is landing here: https://phukhao.buildwithoracle.com/presentation/

| | |
|---|---|
| **Status** | Always Nightly |
| **Version** | 26.6.1-alpha.1428 |
| **Created** | 2025-12-29 |
| **Updated** | 2026-06-01 |

TypeScript MCP server for semantic search over Oracle philosophy — SQLite FTS5 + LanceDB hybrid search, HTTP API, and vault CLI.

See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for local development.
For Docker MCP Toolkit / Gateway / n8n installs, see [docs/DOCKER-MCP-TOOLKIT.md](docs/DOCKER-MCP-TOOLKIT.md).
For the progressive first-run path from zero-config FTS to MCP, indexing, vectors, and audit logs, see [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Architecture

```
arra-oracle-v3 (one package, two primary bins + legacy aliases)
├── bunx --package github:Soul-Brews-Studio/arra-oracle-v3 arra-oracle  → HTTP API (bin/arra.ts)
├── bunx --package github:Soul-Brews-Studio/arra-oracle-v3 arra-cli     → operator CLI (cli/src/cli.ts)
├── bunx --package github:Soul-Brews-Studio/arra-oracle-v3 arra-oracle-v2 → legacy MCP alias (src/index.ts)
├── bun run server                                                       → HTTP API (src/server.ts)
└── bun run index                                                        → Indexer (src/indexer.ts)

oracle-studio (separate repo)
└── bunx oracle-studio                      → React dashboard
```

**Stack:**
- **Bun** runtime (>=1.2.0)
- **SQLite** + FTS5 for full-text search
- **LanceDB** for vector/semantic search
- **Drizzle ORM** for type-safe queries
- **Hono** for HTTP API
- **MCP** protocol for Claude integration

## Progressive onboarding

Arra now starts with a low-friction floor and lets you opt into heavier pieces only when ready:

1. **Install and search immediately** — start the HTTP server and use SQLite FTS5 via `GET /api/search?mode=fts&q=...`. A fresh install works without vector indexes; hybrid/vector requests degrade to FTS until vectors are ready (#1370).
2. **Connect MCP with a small tool surface** — add the stdio MCP server, then trim exposed tools through config (`.arra/config.json`, `ORACLE_ENABLED_TOOLS`, `ORACLE_DISABLED_TOOLS`) or the `/tools/config` page backed by `GET/PUT /api/settings/tools` (#1372/#1373).
3. **Save deploy credentials in the browser** — `/connect` stores `ORACLE_API` plus optional `ARRA_API_TOKEN`, can generate a token for your server env, and renders `claude mcp add` / JSON snippets (#1374).
4. **Index your ψ vault** — when a repo has `ψ/`, scan with `POST /api/indexer/scan` and populate SQLite/FTS with `POST /api/indexer/reindex` (#1375).
5. **Enable vectors when ready** — choose local engine/model with `GET/PATCH /api/vector/config`, index vectors with `POST /api/vector/index/start`, or move vector work behind `VECTOR_URL`; `GET /api/health` reports `vectorMode` (`embedded`, `proxied`, `disabled`) once #1390 lands (#1377/#1390).
6. **Review what the AI searched** — `/traces` reads `GET /api/logs` plus `GET /api/traces` / `GET /api/traces/:id`, including AI-search audit details so searches are inspectable (#1384).

Detailed walkthrough: [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Install

### bunx (recommended)

Distributed via GitHub — no npm publish needed:

```bash
# HTTP server
bunx --bun --package github:Soul-Brews-Studio/arra-oracle-v3 arra-oracle

# CLI (operator client)
bunx --bun --package github:Soul-Brews-Studio/arra-oracle-v3 arra-cli --help

# UI (dashboard — separate repo)
bunx --bun oracle-studio@github:Soul-Brews-Studio/oracle-studio

# Vault CLI (secondary bin — use --package)
bunx --bun --package arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v3#main oracle-vault --help
```

Canonical bins are `arra-oracle` (server) and `arra-cli` (client).
Legacy aliases `arra-oracle-v3` and `arra-oracle-v2` stay available for
existing installs, Docker commands, and MCP configs. See [docs/BINS.md](docs/BINS.md).

### Add to Claude Code

```bash
claude mcp add arra-oracle-v2 -- bunx --bun --package github:Soul-Brews-Studio/arra-oracle-v3 arra-oracle-v2
```

Or in `~/.claude.json`:
```json
{
  "mcpServers": {
    "arra-oracle-v2": {
      "command": "bunx",
      "args": ["--bun", "--package", "github:Soul-Brews-Studio/arra-oracle-v3", "arra-oracle-v2"]
    }
  }
}
```

> For a canonical install that shares `ORACLE_DATA_DIR` with Codex / the HTTP API
> (and gives pinned-commit control + offline starts), see
> [Oracle 101 — ch03 "ติดตั้งจาก 0"](https://oracle101.vercel.app/ch03.html).
> §3.11 note: if both Claude Code and Codex are installed, they MUST point at
> the same `ORACLE_DATA_DIR`.

### From source

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3 && bun install
bun run dev          # MCP server
bun run server       # HTTP API on :47778
```

<details>
<summary>Install script (legacy)</summary>

```bash
curl -sSL https://raw.githubusercontent.com/Soul-Brews-Studio/arra-oracle-v3/main/scripts/install.sh | bash
```
</details>

<details>
<summary>Troubleshooting</summary>

| Problem | Fix |
|---------|-----|
| `bun: command not found` | `export PATH="$HOME/.bun/bin:$PATH"` |
| LanceDB missing/hangs/timeout | Skip it — SQLite FTS5 works fine without vectors |
| Fresh install has no index yet | Start the server anyway; FTS search returns empty results and vector/hybrid modes degrade to FTS until vectors are indexed |

</details>

## MCP Tools

23 tools available via Claude Code:

| Tool | Description |
|------|-------------|
| `oracle_search` | Hybrid search (FTS5 + LanceDB) |
| `oracle_reflect` | Random wisdom |
| `oracle_learn` | Add new patterns |
| `oracle_list` | Browse documents |
| `oracle_stats` | Database statistics |
| `oracle_concepts` | List concept tags |
| `oracle_supersede` | Mark documents as superseded |
| `oracle_handoff` | Session handoff |
| `oracle_inbox` | Inbox messages |
| `oracle_verify` | Verify documents |
| `oracle_thread` | Create thread |
| `oracle_threads` | List threads |
| `oracle_thread_read` | Read thread |
| `oracle_thread_update` | Update thread |
| `oracle_trace` | Create trace |
| `oracle_trace_list` | List traces |
| `oracle_trace_get` | Get trace |
| `oracle_trace_link` | Link traces |
| `oracle_trace_unlink` | Unlink traces |
| `oracle_trace_chain` | Trace chain |
| `oracle_schedule_add` | Add schedule entry |
| `oracle_schedule_list` | List schedule |

## Vault CLI

Global CLI for managing the Oracle knowledge vault:

```bash
oracle-vault init <owner/repo>    # Initialize vault with GitHub repo
oracle-vault status               # Show config and pending changes
oracle-vault sync                 # Commit + push to GitHub
oracle-vault pull                 # Pull vault files into local ψ/
oracle-vault migrate              # Seed vault from ghq repos
```

## API Endpoints

HTTP API on port 47778 (`bun run server`).

<!-- endpoints:start -->

> Auto-generated by `bun run scripts/gen-endpoints.ts`. 55 endpoints across 14 modules.

| Method | Path | Module | Description |
|--------|------|--------|-------------|
| `GET` | `/api/auth/status` | `auth` | Auth status - public |
| `POST` | `/api/auth/login` | `auth` | Login |
| `POST` | `/api/auth/logout` | `auth` | Logout |
| `GET` | `/api/dashboard` | `dashboard` |  |
| `GET` | `/api/dashboard/summary` | `dashboard` |  |
| `GET` | `/api/dashboard/activity` | `dashboard` |  |
| `GET` | `/api/dashboard/growth` | `dashboard` |  |
| `GET` | `/api/session/stats` | `dashboard` | Session stats endpoint - tracks activity from DB (includes MCP usage) |
| `GET` | `/api/feed` | `feed` |  |
| `POST` | `/api/feed` | `feed` | Log an event to feed.log |
| `GET` | `/api/graph` | `files` | Graph |
| `GET` | `/api/context` | `files` | Context |
| `GET` | `/api/file` | `files` | File - supports cross-repo access via ghq project paths |
| `GET` | `/api/read` | `files` |  |
| `GET` | `/api/doc/:id` | `files` |  |
| `GET` | `/api/logs` | `files` |  |
| `GET` | `/api/plugins` | `files` |  |
| `GET` | `/api/plugins/:name` | `files` |  |
| `GET` | `/api/threads` | `forum` | List threads |
| `POST` | `/api/thread` | `forum` | Create thread / send message |
| `GET` | `/api/thread/:id` | `forum` | Get thread by ID |
| `PATCH` | `/api/thread/:id/status` | `forum` | Update thread status |
| `GET` | `/api/health` | `health` | Health check |
| `GET` | `/api/stats` | `health` | Stats (extended with vector metrics) |
| `GET` | `/api/oracles` | `health` | Active Oracles — detected from existing activity across all log tables |
| `POST` | `/api/learn` | `knowledge` | Learn |
| `POST` | `/api/handoff` | `knowledge` | Handoff |
| `GET` | `/api/inbox` | `knowledge` | Inbox |
| `GET` | `/api/oraclenet/feed` | `oraclenet` | Feed — recent posts |
| `GET` | `/api/oraclenet/oracles` | `oraclenet` | Oracles directory |
| `GET` | `/api/oraclenet/presence` | `oraclenet` | Presence — recent heartbeats |
| `GET` | `/api/oraclenet/status` | `oraclenet` | Health check — is OracleNet reachable? |
| `GET` | `/api/plugins` | `plugins` |  |
| `GET` | `/api/plugins/:name` | `plugins` |  |
| `GET` | `/api/schedule/md` | `schedule` | Serve raw schedule.md for frontend rendering |
| `GET` | `/api/schedule` | `schedule` |  |
| `POST` | `/api/schedule` | `schedule` |  |
| `PATCH` | `/api/schedule/:id` | `schedule` | Update schedule event status |
| `GET` | `/api/search` | `search` | Search |
| `GET` | `/api/reflect` | `search` | Reflect |
| `GET` | `/api/similar` | `search` | Similar documents (vector nearest neighbors) |
| `GET` | `/api/map` | `search` | Knowledge map (2D projection of all embeddings) |
| `GET` | `/api/map3d` | `search` | Knowledge map 3D (real PCA from LanceDB bge-m3 embeddings) |
| `GET` | `/api/list` | `search` | List documents |
| `GET` | `/api/settings` | `settings` | Get settings (no password hash exposed) |
| `POST` | `/api/settings` | `settings` | Update settings |
| `GET` | `/api/supersede` | `supersede` | List supersessions from oracle_documents.superseded_by |
| `GET` | `/api/supersede/chain/:path` | `supersede` | Get supersede chain for a document (by source_file path) |
| `POST` | `/api/supersede` | `supersede` | Log a new supersession |
| `GET` | `/api/traces` | `traces` |  |
| `GET` | `/api/traces/:id` | `traces` |  |
| `GET` | `/api/traces/:id/chain` | `traces` |  |
| `POST` | `/api/traces/:prevId/link` | `traces` | Link traces: POST /api/traces/:prevId/link { nextId: "..." } |
| `DELETE` | `/api/traces/:id/link` | `traces` | Unlink trace: DELETE /api/traces/:id/link?direction=prev\|next |
| `GET` | `/api/traces/:id/linked-chain` | `traces` | Get trace linked chain: GET /api/traces/:id/linked-chain |

<!-- endpoints:end -->

## Database

Drizzle ORM with SQLite:

```bash
bun db:push       # Push schema to DB
bun db:generate   # Generate migrations
bun db:migrate    # Apply migrations
bun db:studio     # Open Drizzle Studio GUI
```

## Project Structure

```
arra-oracle-v3/
├── src/
│   ├── index.ts          # MCP server entry
│   ├── server.ts         # HTTP API (Hono)
│   ├── indexer.ts        # Knowledge indexer
│   ├── vault/
│   │   └── cli.ts        # Vault CLI entry
│   ├── tools/            # MCP tool handlers
│   ├── trace/            # Trace system
│   ├── db/
│   │   ├── schema.ts     # Drizzle schema
│   │   └── index.ts      # DB client
│   └── server/           # HTTP server modules
├── scripts/              # Setup & utility scripts
├── docs/                 # Documentation
└── drizzle.config.ts     # Drizzle configuration
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ORACLE_PORT` | `47778` | HTTP server port |
| `ORACLE_REPO_ROOT` | `process.cwd()` | Knowledge base root |

## Testing

```bash
bun test              # All tests
bun test:unit         # Unit tests
bun test:integration  # Integration tests
bun test:e2e          # Playwright E2E tests
bun test:coverage     # With coverage
```

## New awakenings welcome

Awakening a new Oracle? Post the birth announcement and experience report
to **[Discussions](https://github.com/Soul-Brews-Studio/arra-oracle-v3/discussions)**,
not Issues. See [docs/CONTRIBUTING-AWAKENING.md](./docs/CONTRIBUTING-AWAKENING.md)
for categories and signature convention.

## References

- [TIMELINE.md](./TIMELINE.md) - Full evolution history
- [docs/API.md](./docs/API.md) - API documentation
- [docs/architecture.md](./docs/architecture.md) - Architecture details
- [docs/CONTRIBUTING-AWAKENING.md](./docs/CONTRIBUTING-AWAKENING.md) - Where to post awakening announcements
- [Drizzle ORM](https://orm.drizzle.team/)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex Newman — process manager pattern, worker service architecture, and hook system concepts.
