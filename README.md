# Arra Oracle - MCP Memory Layer

[![CI](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE) [![CalVer](https://img.shields.io/badge/calver-v26.4.20--alpha.7-blue)](https://calver.org) [![Bun](https://img.shields.io/badge/runtime-Bun%201.2%2B-f9f1e1)](https://bun.sh)

> "The Oracle Keeps the Human Human" - now queryable via MCP

Phukhao Oracle is landing here: https://phukhao.buildwithoracle.com/presentation/

| | |
|---|---|
| **Status** | Always Nightly |
| **Version** | 26.4.19-alpha.7 |
| **Created** | 2025-12-29 |
| **Updated** | 2026-04-19 |

TypeScript MCP server for semantic search over Oracle philosophy — SQLite FTS5 + ChromaDB hybrid search, HTTP API, and vault CLI.

See [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) for local development.
See [docs/TONIGHT-SHIPPED.md](docs/TONIGHT-SHIPPED.md) for the consolidated reference covering the config, plugin, vector, federation-track, Docker, and GHCR features shipped in the 2026-06-06 alpha wave.

## Architecture

```
arra-oracle-v3 (one package, four bins)
├── bunx arra-oracle-v3                     → HTTP API / server launcher (bin/arra.ts)
├── bunx arra-oracle-v2                     → MCP server (src/index.ts)
├── bunx arra-cli                           → operator CLI (cli/src/cli.ts)
└── bunx arra                               → operator CLI alias (cli/src/cli.ts)

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
# Backend (MCP server)
bunx --bun arra-oracle@github:Soul-Brews-Studio/arra-oracle-v3

# Operator CLI (plugin runner)
bunx --bun arra-cli@github:Soul-Brews-Studio/arra-oracle-v3 --help

# Short operator CLI alias
bunx --bun arra@github:Soul-Brews-Studio/arra-oracle-v3 health

# UI (dashboard — separate repo)
bunx --bun oracle-studio@github:Soul-Brews-Studio/oracle-studio

```

### Add to Claude Code

```bash
claude mcp add arra-oracle-v2 -- bunx --bun arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v3#main
```

Or in `~/.claude.json`:
```json
{
  "mcpServers": {
    "arra-oracle-v2": {
      "command": "bunx",
      "args": ["--bun", "arra-oracle-v2@github:Soul-Brews-Studio/arra-oracle-v3#main"]
    }
  }
}
```


### Docker / Docker MCP Toolkit

The `alpha` branch publishes Docker images to GHCR for both runtime modes:

| Image | Purpose |
| --- | --- |
| `ghcr.io/soul-brews-studio/arra-oracle-v3:http` | HTTP API on `:47778` |
| `ghcr.io/soul-brews-studio/arra-oracle-v3:stdio` | MCP stdio server for Docker MCP Toolkit / Gateway |

Build locally:

```bash
docker build -t arra-oracle-v3:http --target http-server .
docker build -t arra-oracle-v3:stdio --target mcp-stdio .
```

Run the HTTP server:

```bash
docker run --rm -p 47778:47778 -v arra-data:/data ghcr.io/soul-brews-studio/arra-oracle-v3:http
curl -sf http://localhost:47778/api/health
```

Or use Compose, which also serves the HTTP target on `:47778`:

```bash
docker compose up -d
curl -sf http://localhost:47778/api/health
```

For Docker MCP Toolkit click-to-install, use `catalog/arra-oracle.yaml`. It points at the real published stdio image:

```bash
mkdir -p ~/.docker/mcp/catalogs
cp catalog/arra-oracle.yaml ~/.docker/mcp/catalogs/
```

Then add `arra-oracle` to Docker MCP Toolkit's registry configuration and restart Docker Desktop / the MCP gateway.

### From source

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3 && bun install
bun run dev          # MCP server
bun run server       # HTTP API on :47778
```

### Operator CLI targets

`arra` and `arra-cli` resolve the HTTP API target in this order:

1. `ORACLE_API=http://host:47778`
2. `arra --at <name> <command>` from configured targets
3. nearest project `.arra/config.json` default target
4. global `$XDG_CONFIG_HOME/arra/config.json` (or `~/.config/arra/config.json`) default target
5. legacy `NEO_ARRA_API`
6. `http://localhost:47778`

Config shape:

```json
{
  "default": "local",
  "targets": {
    "local": "http://localhost:47778",
    "m5": "http://m5.local:47778"
  }
}
```

```bash
arra config          # show resolved target, sources, and targets
arra config path     # print global config path
arra use m5          # set global default target
arra --at m5 health  # one-off target override
arra doctor          # diagnose target, server, DB/vector, config, and MCP mode
arra doctor --json   # machine-readable diagnostics
arra plugins         # list MCP tool plugins from plugins.json
arra plugins disable trace
arra plugins enable trace
```

Shell completions:

```bash
# zsh
mkdir -p ~/.zsh/completions
arra completions zsh > ~/.zsh/completions/_arra
# then add to ~/.zshrc: fpath=(~/.zsh/completions $fpath); autoload -Uz compinit && compinit

# bash
arra completions bash > ~/.arra-completion.bash
# then source ~/.arra-completion.bash from ~/.bashrc

# fish
mkdir -p ~/.config/fish/completions
arra completions fish > ~/.config/fish/completions/arra.fish
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
| `GET` | `/api/peer/feed` | `feed` |  |
| `POST` | `/api/peer/feed` | `feed` | Log an event to feed.log |
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

## Federation peer endpoints

Arra exposes a small MAW-compatible federation surface for peer oracles:

- `GET /info` — public MAW schema/capability document.
- `GET /api/identity` — public stable node identity and local TOFU pubkey.
- `GET /api/peers` — probes peers from `ARRA_NAMED_PEERS` or `peers.json` and pins pubkeys on first contact.
- `GET /api/peer/feed` — peer-readable feed (optionally protected).
- `POST /api/peer/search` — peer-callable Arra search (also available as `POST /api/search`; existing `GET /api/search` is unchanged).

Set `ARRA_PEER_TOKEN` to require `Authorization: Bearer <token>` (or `?token=`) for `/api/peer/feed` and peer search. `/info` and `/api/identity` stay open for discovery. Configure peers with `ARRA_NAMED_PEERS='{"mawjs":"http://host:port"}'` or `$ORACLE_DATA_DIR/peers.json`. Run `arra peers --token <token>` to probe them. Scout HELLO multicast is opt-in with `ARRA_SCOUT_ANNOUNCE=1`.
