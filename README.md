# Arra Oracle - MCP Memory Layer

> "The Oracle Keeps the Human Human" - now queryable via MCP

| | |
|---|---|
| **Status** | Always Nightly |
| **Version** | 0.4.0-nightly |
| **Created** | 2025-12-29 |
| **Updated** | 2026-04-04 |

TypeScript MCP server for semantic search over Oracle philosophy — SQLite FTS5 + vector hybrid search, HTTP API, vault CLI, and remote MCP access via Streamable HTTP with OAuth 2.1 + PKCE.

## Architecture

```
arra-oracle-v3 (one package, two bins)
├── bunx arra-oracle-v3                          → MCP server (src/index.ts)
├── bunx --package arra-oracle-v3 oracle-vault   → Vault CLI (src/vault/cli.ts)
├── bun run server                          → HTTP API + MCP transport (src/server.ts)
└── bun run index                           → Indexer (src/indexer.ts)

oracle-studio (separate repo)
└── bunx oracle-studio                      → React dashboard
```

**Stack:**
- **Bun** runtime (>=1.2.0)
- **SQLite** + FTS5 for full-text search
- **Pluggable vector DB** — Qdrant Cloud (production), LanceDB (local), ChromaDB (legacy)
- **Drizzle ORM** for type-safe queries
- **Hono** for HTTP API and MCP transport
- **MCP** protocol for Claude integration (stdio + Streamable HTTP)

## Install

### bunx (recommended)

Distributed via GitHub — no npm publish needed:

```bash
# MCP server (stdio, for Claude Code)
bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3#main

# Vault CLI (secondary bin — use --package)
bunx --bun --package arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3#main oracle-vault --help
```

### Add to Claude Code

```bash
claude mcp add arra-oracle-v3 -- bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3#main
```

Or in `~/.claude.json`:
```json
{
  "mcpServers": {
    "arra-oracle-v3": {
      "command": "bunx",
      "args": ["--bun", "arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3#main"]
    }
  }
}
```

### Remote MCP (Streamable HTTP) — Bearer Token

For Claude Desktop, ChatGPT, or other remote MCP clients that support custom headers:

```json
{
  "mcpServers": {
    "oracle-v3": {
      "type": "streamable-http",
      "url": "https://oracle.goko.digital/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

### Remote MCP — OAuth 2.1 (Claude Desktop)

Claude Desktop's MCP UI doesn't support custom headers. Use OAuth 2.1 instead — Claude Desktop handles the auth flow automatically when you provide only the server URL. See [docs/INSTALL.md](docs/INSTALL.md#oauth-21-for-claude-desktop-without-custom-headers) for setup.

See [docs/INSTALL.md](docs/INSTALL.md#remote-mcp-access-streamable-http) for full setup, curl examples, and troubleshooting.

### From source

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3 && bun install
bun run dev          # MCP server (stdio)
bun run server       # HTTP API + MCP on :47778
```

<details>
<summary>Troubleshooting</summary>

| Problem | Fix |
|---------|-----|
| `bun: command not found` | `export PATH="$HOME/.bun/bin:$PATH"` |
| Vector search unavailable | Oracle falls back to FTS5-only — still works |
| Server crashes on empty DB | Run `bun run index` first to index knowledge base |

</details>

## MCP Tools

20 tools available via Claude Code and Streamable HTTP:

| Tool | Description |
|------|-------------|
| `arra_search` | Hybrid search (FTS5 + vector) |
| `arra_read` | Read full document content |
| `arra_learn` | Add new patterns/learnings |
| `arra_list` | Browse documents |
| `arra_stats` | Database statistics |
| `arra_concepts` | List concept tags |
| `arra_supersede` | Mark documents as superseded |
| `arra_handoff` | Save session context |
| `arra_inbox` | List pending handoffs |
| `arra_thread` | Start a multi-turn discussion thread |
| `arra_threads` | List threads |
| `arra_thread_read` | Read thread content |
| `arra_thread_update` | Update thread |
| `arra_trace` | Log a discovery session |
| `arra_trace_list` | List past traces |
| `arra_trace_get` | Explore trace dig points |
| `arra_trace_link` | Link related traces |
| `arra_trace_unlink` | Unlink traces |
| `arra_trace_chain` | View full linked trace chain |
| `arra_______IMPORTANT` | Workflow guide (auto-injected) |

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

HTTP API on port 47778 (`bun run server`):

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/search?q=...` | Full-text search |
| `GET /api/consult?q=...` | Get guidance |
| `GET /api/reflect` | Random wisdom |
| `GET /api/list` | Browse documents |
| `GET /api/stats` | Database statistics |
| `GET /api/graph` | Knowledge graph data |
| `GET /api/context` | Project context |
| `POST /api/learn` | Add new pattern |
| `GET /api/threads` | List threads |
| `GET /api/decisions` | List decisions |

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
│   ├── index.ts          # MCP server entry (stdio)
│   ├── server.ts         # HTTP API + MCP transport (Hono)
│   ├── mcp-transport.ts  # Streamable HTTP MCP handler
│   ├── config.ts         # Configuration + env var resolution
│   ├── indexer.ts        # Knowledge indexer
│   ├── oauth/            # OAuth 2.1 + PKCE implementation
│   │   ├── provider.ts   # Token store, PKCE validation
│   │   ├── routes.ts     # OAuth endpoints
│   │   └── types.ts      # OAuth types
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
| `MCP_AUTH_TOKEN` | — | Bearer token for `/mcp` endpoint (required for remote MCP) |
| `MCP_OAUTH_PIN` | — | PIN for OAuth 2.1 login page — enables OAuth when set |
| `MCP_EXTERNAL_URL` | `http://localhost:PORT` | Public HTTPS URL for OAuth metadata |

## Testing

```bash
bun test              # All tests
bun test:unit         # Unit tests
bun test:integration  # Integration tests
bun test:e2e          # Playwright E2E tests
bun test:coverage     # With coverage
```

## References

- [TIMELINE.md](./TIMELINE.md) - Full evolution history
- [docs/INSTALL.md](./docs/INSTALL.md) - Installation and OAuth setup
- [docs/API.md](./docs/API.md) - API documentation
- [docs/architecture.md](./docs/architecture.md) - Architecture details
- [Drizzle ORM](https://orm.drizzle.team/)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex Newman — process manager pattern, worker service architecture, and hook system concepts.
