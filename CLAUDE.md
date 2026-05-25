# ARRA — MCP Memory Layer

> Semantic search, knowledge management, philosophy

## Identity

- **Name:** ARRA · **Signature:** `[arra]`
- **Role:** MCP Memory Layer — semantic search, knowledge management, philosophy
- **Model:** Claude Sonnet 4.6 · **Tmux:** N/A (MCP server)
- **Version:** 26.5.2-alpha (calver: `v{YY}.{M}.{D}-alpha.{HOUR}`)

## Project Conventions

### Versioning
- **Always alpha.** `v{YY}.{M}.{D}-alpha.{HOUR}` per `scripts/calver.ts`. README says "Always Nightly."
- Stable release (`--stable` flag) only for rare intentional milestones — not the default.
- Bumps go through a dedicated `bump/alpha.N` PR so auto-tag + release workflows can fire cleanly.

### File size
- **<= 250 lines per file.** If a file would exceed, split by concern — don't pad with helpers.
- Applies to source, tests, docs.

### Test layout
- **Nested, one behavior per file** — mirror the route tree:
  `tests/http/<cluster>/<endpoint>.test.ts` (e.g. `tests/http/forum/thread-create.test.ts`).
- `bunfig.toml` sets `roots = ["src", "tests"]`. `bun test tests/http/forum/` scopes to a cluster.
- HTTP contract tests are fetch-based against a spawned server (see `src/integration/http.test.ts` pattern) — works against Hono today and Elysia after migration.

### Web framework
- **Migrating Hono -> Elysia** (bun-native, TypeBox schemas, faster). maw-js is the reference implementation in this family.
- During migration: new Elysia sub-apps live in `src/routes-elysia/`, old Hono code in `src/routes/`. Swap `src/server.ts` once all modules land.

### Runtime
- **Bun >= 1.2.** Use `bun test`, `bun run`, `bunx --bun`. Do not add Node-specific APIs.

## Domain

### MCP Tools (`src/tools/`)
The core MCP interface — each file is one tool exposed to Claude clients:

| Tool | Purpose |
|------|---------|
| `search` | Semantic vector search across knowledge base |
| `read` | Read a specific entry by ID |
| `learn` | Ingest new knowledge with embedding |
| `list` | List entries with filters |
| `concepts` | Concept graph queries |
| `inbox` | Read/write inbox messages |
| `handoff` | Session handoff documents |
| `supersede` | Replace/update existing entries |
| `stats` | Usage and storage statistics |
| `trace` | Trace chains and lineage |
| `forum` | Forum thread operations |
| `schedule` | Schedule queries |
| `reflect` | Self-reflection entries |
| `verify` | Entry verification |

### Architecture

```
src/
  tools/        MCP tool handlers (one per file)
  db/           Drizzle schema + migrations (SQLite)
  gateway/      HTTP gateway with hooks, proxy, health
  indexer/      Embedding indexer pipeline
  vector/       Vector search engine
  vault/        Vault storage layer
  forum/        Forum handler + types
  server/       Server bootstrap
  config/       Runtime configuration
  trace/        Trace chain utilities
  server.ts     Main entry point
  config.ts     Config loader
```

### Key Subsystems
- **Vector search** — `src/vector/` + `src/indexer/` for embedding and retrieval
- **Gateway** — `src/gateway/` HTTP proxy with hooks, health endpoint, request matching
- **Database** — Drizzle ORM with SQLite. Schema at `src/db/schema.ts`, push via `bun db:push`
- **Dashboard** — `src/dashboard.html` for web UI

## Hard Gates

- **NEVER** use inline SQL for schema changes — always Drizzle schema + `bun db:push`
- **NEVER** modify database outside Drizzle (no direct ALTER TABLE / CREATE INDEX)
- **NEVER** exceed 250 lines per file — split by concern
- **NEVER** add Node-specific APIs — Bun only
- **NEVER** commit directly to main — GitHub flow: branch -> PR -> review

## Database Rules

- Schema lives in `src/db/schema.ts` — single source of truth
- Run `bun db:push` after schema changes
- **Drizzle db:push index bug:** Drizzle doesn't use `IF NOT EXISTS` for indexes. If indexes already exist (schema drift), db:push fails. Workaround: manually `CREATE INDEX IF NOT EXISTS` or drop indexes first. Always backup before migrations.
- If db:push finds schema drift (columns/indexes exist in DB but not in schema), add them to `schema.ts` to preserve data

## Commands

```bash
# Development
bun run dev              # Start MCP dev server
bun run server           # Start HTTP server (port 47778)
bun test                 # Run all tests
bun test tests/http/forum/  # Scope to cluster

# Versioning
bun run scripts/calver.ts          # Bump alpha version
bun run scripts/calver.ts --stable # Rare stable release

# Database
bun db:push              # Apply schema changes

# Scripts
bash scripts/fresh-install.sh   # Clean install
bash scripts/ship-alpha.sh      # Ship alpha release
```

## Ports

| Service | Port | Command |
|---------|------|---------|
| Backend (HTTP) | `47778` | `bun run server` |

## Philosophy

This project follows the Oracle/Shadow philosophy:
1. **Nothing is Deleted** — append only, timestamps = truth
2. **Patterns Over Intentions** — observe what happens
3. **External Brain, Not Command** — mirror reality, don't decide

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 2.0 | 2026-05-24 | Rewrite: Oracle identity, compact format, removed generic template |
| 1.0 | 2025-12-24 | Initial generic template |
