# Arra Oracle - MCP Memory Layer

> "The Oracle Keeps the Human Human" - now queryable via MCP

| | |
|---|---|
| **Status** | Always Nightly |
| **Version** | 0.4.0-nightly |
| **Created** | 2025-12-29 |
| **Updated** | 2026-03-02 |

TypeScript MCP server for semantic search over Oracle philosophy — SQLite FTS5 + ChromaDB hybrid search, HTTP API, and vault CLI.

## Architecture

```
arra-oracle-v2 (one package, two bins)
├── bunx arra-oracle-v2                          → MCP server (src/index.ts)
├── bunx --package arra-oracle-v2 oracle-vault   → Vault CLI (src/vault/cli.ts)
├── bun run server                          → HTTP API (src/server.ts)
└── bun run index                           → Indexer (src/indexer.ts)

oracle-studio (separate repo)
└── bunx oracle-studio                      → React dashboard
```

**Stack:**
- **Bun** runtime (>=1.2.0)
- **SQLite** + FTS5 for full-text search
- **ChromaDB** for vector/semantic search
- **Drizzle ORM** for type-safe queries
- **Hono** for HTTP API
- **MCP** protocol for Claude integration

## Install

### bunx (recommended)

Distributed via GitHub — no npm publish needed:

```bash
# MCP server (stdio, for Claude Code)
bunx --bun arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v2#main

# Vault CLI (secondary bin — use --package)
bunx --bun --package arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v2#main oracle-vault --help
```

### Add to Claude Code

```bash
claude mcp add arra-oracle-v2 -- bunx --bun arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v2#main
```

Or in `~/.claude.json`:
```json
{
  "mcpServers": {
    "arra-oracle-v2": {
      "command": "bunx",
      "args": ["--bun", "arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v2#main"]
    }
  }
}
```

### Remote MCP (Streamable HTTP)

For Claude Desktop, ChatGPT, or other remote MCP clients:

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

See [docs/INSTALL.md](docs/INSTALL.md#remote-mcp-access-streamable-http) for setup details.

### From source

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v2.git
cd arra-oracle-v2 && bun install
bun run dev          # MCP server (stdio)
bun run server       # HTTP API + MCP on :47778
```

<details>
<summary>Install script (legacy)</summary>

```bash
curl -sSL https://raw.githubusercontent.com/Soul-Brews-Studio/arra-oracle-v2/main/scripts/install.sh | bash
```
</details>

<details>
<summary>Troubleshooting</summary>

| Problem | Fix |
|---------|-----|
| `bun: command not found` | `export PATH="$HOME/.bun/bin:$PATH"` |
| ChromaDB hangs/timeout | Skip it — SQLite FTS5 works fine without vectors |
| Server crashes on empty DB | Run `bun run index` first to index knowledge base |

</details>

## MCP Tools

22 tools available via Claude Code:

| Tool | Description |
|------|-------------|
| `oracle_search` | Hybrid search (FTS5 + ChromaDB) |
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
arra-oracle-v2/
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

## References

- [TIMELINE.md](./TIMELINE.md) - Full evolution history
- [docs/API.md](./docs/API.md) - API documentation
- [docs/architecture.md](./docs/architecture.md) - Architecture details
- [Drizzle ORM](https://orm.drizzle.team/)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex Newman — process manager pattern, worker service architecture, and hook system concepts.
