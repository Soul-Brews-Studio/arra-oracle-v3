# Arra Oracle v3 Architecture

> Knowledge system MCP server with hybrid search, consultation logging, and learning capabilities.

## Overview

Arra Oracle v3 indexes philosophy from markdown files and provides:
- **Semantic + keyword search** (Vector DB + FTS5 hybrid)
- **Decision guidance** via principles and patterns
- **Learning capture** from sessions
- **HTTP API** for web interfaces

```
┌─────────────────────────────────────────────────────────────┐
│                      ORACLE v3 SYSTEM                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Claude    │    │  HTTP API   │    │  Dashboard  │     │
│  │  (via MCP)  │    │  (REST)     │    │  (Web UI)   │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│                    ┌───────▼───────┐                        │
│                    │  Oracle Core  │                        │
│                    │   (index.ts)  │                        │
│                    └───────┬───────┘                        │
│                            │                                │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│  ┌──────▼──────┐   ┌───────▼───────┐  ┌───────▼───────┐    │
│  │   SQLite    │   │  Vector DB   │  │   Markdown    │    │
│  │  (FTS5)     │   │  (pluggable) │  │   (source)    │    │
│  └─────────────┘   └───────────────┘  └───────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Vector Search Backend (Pluggable)

The vector backend is configured via environment variables. Multiple adapters are supported:

| Backend | Env: `ORACLE_VECTOR_DB` | Embedding Provider | Use Case |
|---------|------------------------|--------------------|----------|
| **Qdrant Cloud** | `qdrant` | OpenAI `text-embedding-3-small` | Production (recommended) |
| LanceDB | `lancedb` (default) | Ollama (local models) | Local development |
| ChromaDB | `chroma` | ChromaDB internal | Legacy |
| SQLite-vec | `sqlite-vec` | Ollama | Embedded |
| Cloudflare Vectorize | `cloudflare-vectorize` | Cloudflare AI | Edge deployment |

### Production Configuration (OpenClaw Server)

```bash
# systemd env vars (oracle-v2.service)
ORACLE_VECTOR_DB=qdrant
ORACLE_EMBEDDING_PROVIDER=openai
# + EnvironmentFile for QDRANT_URL, QDRANT_API_KEY, OPENAI_API_KEY
```

Shares Qdrant Cloud instance with `my-ai-soul-mcp` (PSak Soul MCP). OpenAI `text-embedding-3-small` provides 1536-dimension embeddings.

### Re-indexing Vectors

```bash
# Index all documents to vector DB (respects ORACLE_VECTOR_DB env var)
source ~/.secrets/qdrant.env && source ~/.secrets/openai.env
export ORACLE_VECTOR_DB=qdrant ORACLE_EMBEDDING_PROVIDER=openai
bun src/scripts/index-model.ts bge-m3    # ~8s for 164 docs
```

## Components

### MCP Server (`src/index.ts`)

Exposes tools to Claude via Model Context Protocol (stdio transport):

| Tool | Purpose |
|------|---------|
| `arra_search` | Hybrid keyword + semantic search |
| `arra_read` | Read full document content |
| `arra_learn` | Add new pattern (writes file + indexes) |
| `arra_list` | Browse documents |
| `arra_stats` | Database statistics |
| `arra_concepts` | List concept tags |
| `arra_supersede` | Mark document as superseded |
| `arra_handoff` | Save session context |
| `arra_inbox` | List pending handoffs |
| `arra_thread` / `arra_threads` / `arra_thread_read` / `arra_thread_update` | Thread management |
| `arra_trace` / `arra_trace_list` / `arra_trace_get` / `arra_trace_link` / `arra_trace_unlink` / `arra_trace_chain` | Trace system |

The same 20 tools are also available via the Streamable HTTP transport at `/mcp` (`src/mcp-transport.ts`).

### HTTP Server (`src/server.ts`)

REST API on port 47778:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/search` | GET | Keyword search |
| `/api/list` | GET | Browse documents |
| `/api/reflect` | GET | Random wisdom |
| `/api/stats` | GET | Database stats |
| `/api/graph` | GET | Knowledge graph |
| `/api/learn` | POST | Add pattern |
| `/mcp` | POST | Streamable HTTP MCP transport |
| `/.well-known/oauth-authorization-server` | GET | OAuth 2.1 metadata (when OAuth enabled) |
| `/register` | POST | OAuth dynamic client registration |
| `/authorize` | GET | OAuth authorization endpoint |
| `/token` | POST | OAuth token exchange (PKCE) |
| `/oauth/login` | GET/POST | PIN entry page |

### Indexer (`src/indexer.ts`)

Populates database from markdown files:

```
ψ/memory/resonance/*.md    → principles (split by ### + bullets)
ψ/memory/learnings/*.md    → learnings (split by ## headers)
ψ/memory/retrospectives/   → retrospectives (split by ## headers)
```

## Database Schema

### `oracle_documents` - Metadata Index

```sql
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- principle, learning, pattern, retro
  source_file TEXT NOT NULL,
  concepts TEXT DEFAULT '[]',   -- JSON array
  created_at INTEGER,
  updated_at INTEGER,
  indexed_at INTEGER
);
```

### `oracle_fts` - Full-Text Search

```sql
CREATE VIRTUAL TABLE oracle_fts USING fts5(
  id UNINDEXED,
  content,
  concepts
);
```

### `consult_log` - Consultation History

```sql
CREATE TABLE consult_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision TEXT NOT NULL,
  context TEXT,
  principles_found INTEGER NOT NULL,
  patterns_found INTEGER NOT NULL,
  guidance TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

### `indexing_status` - Progress Tracking

```sql
CREATE TABLE indexing_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_indexing INTEGER NOT NULL DEFAULT 0,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT
);
```

## Hybrid Search Algorithm

1. **Sanitize query** - remove FTS5 special chars (`? * + - ( ) ^ ~ " ' : .`)
2. **Run FTS5 search** - keyword matching on SQLite
3. **Run vector search** - semantic similarity via configured vector backend
4. **Normalize scores:**
   - FTS5: `e^(-0.3 * |rank|)` (exponential decay)
   - Vector: `1 - distance` (convert to similarity)
5. **Merge results** - deduplicate by document ID
6. **Hybrid scoring** - 50% FTS + 50% vector, 10% boost if in both
7. **Return** with metadata (search time, source breakdown)

### Graceful Degradation

- If vector backend unavailable → FTS5-only with warning
- If query sanitization empties query → return original (will error)

## Logging

### Current Logging

| Event | Destination | Data |
|-------|-------------|------|
| Consultations | `consult_log` table | decision, context, counts, guidance |
| Vector store status | stderr | connection state |
| Indexing progress | `indexing_status` table | progress, errors |
| FTS5 errors | stderr | query, error message |

### Logging Gaps

- No search query tracking (`oracle_search` calls)
- No learning history (when/what was learned)
- No document access tracking (which docs referenced)
- No HTTP endpoint access logs

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORACLE_REPO_ROOT` | `process.cwd()` | Knowledge base location (your ψ/ repo) |
| `ORACLE_PORT` | `47778` | HTTP server port |
| `ORACLE_DATA_DIR` | `~/.oracle` | Data directory for DB and files |
| `ORACLE_VECTOR_DB` | `lancedb` | Vector backend: `qdrant`, `lancedb`, `chroma`, `sqlite-vec`, `cloudflare-vectorize` |
| `ORACLE_EMBEDDING_PROVIDER` | `ollama` | Embedding provider: `openai`, `ollama` |
| `MCP_AUTH_TOKEN` | — | Bearer token for `/mcp` endpoint — required for remote MCP access |
| `MCP_OAUTH_PIN` | — | PIN for OAuth 2.1 login page — enables OAuth when set |
| `MCP_EXTERNAL_URL` | `http://localhost:PORT` | Public HTTPS URL for OAuth metadata endpoints |

### MCP Configuration (stdio — local Claude Code)

```json
{
  "mcpServers": {
    "arra-oracle-v3": {
      "command": "bunx",
      "args": ["--bun", "arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3#main"],
      "env": {
        "ORACLE_REPO_ROOT": "/path/to/knowledge-base"
      }
    }
  }
}
```

### MCP Configuration (Streamable HTTP — remote clients)

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

See [INSTALL.md](./INSTALL.md#remote-mcp-access-streamable-http) for OAuth 2.1 setup (Claude Desktop without custom headers).

## Security

### Path Traversal Protection

`/file` endpoint uses `fs.realpathSync()` to resolve symlinks and verify paths stay within `REPO_ROOT`.

### Query Sanitization

FTS5 special characters are stripped to prevent SQL injection via FTS5 syntax errors.

### MCP Transport Auth

The `/mcp` endpoint requires a valid Bearer token on every request. Two auth modes:

- **Bearer-only** (`MCP_AUTH_TOKEN` set, `MCP_OAUTH_PIN` not set): Static token, HMAC timing-safe comparison.
- **Dual auth** (`MCP_OAUTH_PIN` set): OAuth-issued tokens are checked first; static Bearer token accepted as fallback for existing configs.

### OAuth 2.1 + PKCE

When `MCP_OAUTH_PIN` is set, full OAuth 2.1 spec-compliant flow is activated:
- S256 code challenge (SHA-256 PKCE)
- Dynamic client registration (`/register`)
- PIN-based authorization page (`/oauth/login`)
- 30-day access tokens, no refresh tokens
- Atomic token persistence (temp file + `renameSync`)
- `WWW-Authenticate` header on 401 for OAuth discovery by clients

## Version History

| Version | Changes |
|---------|---------|
| 0.1.0 | Initial MCP server with FTS5 |
| 0.2.0 | ChromaDB hybrid search, stats, concepts, FTS5 bug fix |
| 0.3.x | Pluggable vector backends (Qdrant, LanceDB, sqlite-vec, Cloudflare Vectorize), tool rename to `arra_*` |
| 0.4.0 | Streamable HTTP MCP transport at `/mcp`, OAuth 2.1 + PKCE, dual auth, 20 tools via HTTP |

## Graph API Performance

The `/api/graph` endpoint intentionally excludes retrospectives to prevent O(n²) explosion:

| Scenario | Nodes | Link Comparisons |
|----------|-------|-----------------|
| Current (no retros) | 459 | ~210k |
| With all retros | 4443 | ~20M |

**Current design:**
- All principles (~359)
- Random 100 learnings
- NO retros (3984 would kill performance)

**If retros needed:** Sample top 50 by recency, never include all.

See: `src/server/handlers.ts:handleGraph()`
