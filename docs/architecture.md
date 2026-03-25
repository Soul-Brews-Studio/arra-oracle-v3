# Arra Oracle v3 Architecture

> Knowledge system MCP server with hybrid search, consultation logging, and learning capabilities.

## Overview

Arra Oracle v3 indexes philosophy from markdown files and provides:
- **Semantic + keyword search** (ChromaDB + FTS5)
- **Decision guidance** via principles and patterns
- **Learning capture** from sessions
- **HTTP API** for web interfaces

```
┌─────────────────────────────────────────────────────────────┐
│                      ORACLE v2 SYSTEM                       │
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
│  │   SQLite    │   │   ChromaDB    │  │   Markdown    │    │
│  │  (FTS5)     │   │   (vectors)   │  │   (source)    │    │
│  └─────────────┘   └───────────────┘  └───────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Components

### MCP Server (`src/index.ts`)

Exposes tools to Claude via Model Context Protocol:

| Tool | Purpose | Logs To |
|------|---------|---------|
| `oracle_search` | Hybrid keyword + semantic search | (none yet) |
| `oracle_consult` | Get guidance on decisions | `consult_log` |
| `oracle_reflect` | Random principle/learning | - |
| `oracle_learn` | Add new pattern | writes file + indexes |
| `oracle_list` | Browse documents | - |
| `oracle_stats` | Database statistics | - |
| `oracle_concepts` | List concept tags | - |

### HTTP Server (`src/server.ts`)

REST API on port 47778:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/search` | GET | Keyword search |
| `/list` | GET | Browse documents |
| `/consult` | GET | Get guidance |
| `/reflect` | GET | Random wisdom |
| `/stats` | GET | Database stats |
| `/graph` | GET | Knowledge graph |
| `/learn` | POST | Add pattern |
| `/file` | GET | Fetch file content |

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
3. **Run vector search** - semantic similarity via ChromaDB
4. **Normalize scores:**
   - FTS5: `e^(-0.3 * |rank|)` (exponential decay)
   - Vector: `1 - distance` (convert to similarity)
5. **Merge results** - deduplicate by document ID
6. **Hybrid scoring** - 50% FTS + 50% vector, 10% boost if in both
7. **Return** with metadata (search time, source breakdown)

### Graceful Degradation

- If ChromaDB unavailable → FTS5-only with warning
- If query sanitization empties query → return original (will error)

## Logging

### Current Logging

| Event | Destination | Data |
|-------|-------------|------|
| Consultations | `consult_log` table | decision, context, counts, guidance |
| ChromaDB status | stderr | connection state |
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
| `PORT` | `47778` | HTTP server port |

### MCP Configuration

```json
{
  "mcpServers": {
    "arra-oracle-v2": {
      "command": "node",
      "args": ["/path/to/arra-oracle-v2/dist/index.js"],
      "env": {
        "ORACLE_REPO_ROOT": "/path/to/knowledge-base"
      }
    }
  }
}
```

## Security

### Path Traversal Protection

`/file` endpoint uses `fs.realpathSync()` to resolve symlinks and verify paths stay within `REPO_ROOT`.

### Query Sanitization

FTS5 special characters are stripped to prevent SQL injection via FTS5 syntax errors.

## Version History

| Version | Changes |
|---------|---------|
| 0.1.0 | Initial MCP server with FTS5 |
| 0.2.0 | ChromaDB hybrid search, oracle_stats, oracle_concepts, FTS5 bug fix |

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
