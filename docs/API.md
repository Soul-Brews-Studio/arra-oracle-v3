# Oracle Nightly API Documentation

Oracle Nightly is a knowledge base system with HTTP API and React dashboard.

> **Note**: All API endpoints use `/api/` prefix (e.g., `/api/health`, `/api/search`).

## Quick Start

```bash
# Start backend server
bun run server

# Start frontend dev server
cd frontend && bun dev
```

## Ports

| Service | Port | Command |
|---------|------|---------|
| Backend (HTTP) | `47778` | `bun run server` |
| Frontend (Vite) | `3000` | `cd frontend && bun dev` |

---

## Web UIs

| Page | URL | Description |
|------|-----|-------------|
| Arthur Chat | http://localhost:47778/ | Chat interface |
| Oracle Knowledge | http://localhost:47778/oracle | Legacy knowledge browser |
| Dashboard (legacy) | http://localhost:47778/dashboard/ui | Old HTML dashboard |
| **React Dashboard** | http://localhost:3000 | Modern React UI |

---

## React Frontend Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | http://localhost:3000/ | Dashboard overview |
| Search | http://localhost:3000/search | Full-text search |
| Feed | http://localhost:3000/feed | Document feed/browse |
| Graph | http://localhost:3000/graph | Knowledge graph visualization |
| Activity | http://localhost:3000/activity | Search logs & knowledge gaps |

---

## API Endpoints

### Core Endpoints

#### Health Check
```
GET /health
```
Returns server status.

**Response:**
```json
{
  "status": "ok",
  "server": "arra-oracle-v2",
  "port": 47778
}
```

---

#### Project Context
```
GET /context?cwd={path}
```
Get project context from ghq-format directory path.

**Parameters:**
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `cwd` | No | `process.cwd()` | Directory path to parse |

**Example:**
```bash
curl "http://localhost:47778/context"
curl "http://localhost:47778/context?cwd=$HOME/Code/github.com/owner/repo/src"
```

**Response:**
```json
{
  "github": "https://github.com/owner/repo",
  "owner": "owner",
  "repo": "repo",
  "ghqPath": "github.com/owner/repo",
  "root": "/home/user/Code/github.com/owner/repo",
  "cwd": "/home/user/Code/github.com/owner/repo/src",
  "branch": "main",
  "worktree": "/home/user/Code/github.com/owner/repo"
}
```

**Note:** Path must contain `github.com/owner/repo` pattern (ghq format).

---

#### Search
```
GET /search?q={query}&type={type}&limit={n}&offset={n}
```
Full-text search across the knowledge base.

**Parameters:**
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | Yes | - | Search query |
| `type` | No | `all` | Filter: `all`, `principle`, `learning`, `retro` |
| `limit` | No | `10` | Results per page (max 100) |
| `offset` | No | `0` | Pagination offset |

**Example:**
```bash
curl "http://localhost:47778/search?q=nothing+deleted&type=principle&limit=5"
```

**Response:**
```json
{
  "results": [
    {
      "id": "principle_nothing-deleted",
      "type": "principle",
      "content": "Nothing is ever deleted...",
      "source_file": "ψ/memory/principles/nothing-deleted.md",
      "concepts": ["safety", "preservation"],
      "source": "fts",
      "score": -12.5
    }
  ],
  "total": 78,
  "offset": 0,
  "limit": 5,
  "query": "nothing deleted"
}
```

---

#### List Documents
```
GET /list?type={type}&limit={n}&offset={n}&group={bool}
```
Browse documents without searching.

**Parameters:**
| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `type` | No | `all` | Filter by type |
| `limit` | No | `10` | Results per page |
| `offset` | No | `0` | Pagination offset |
| `group` | No | `true` | Group by source file |

**Example:**
```bash
curl "http://localhost:47778/list?type=learning&limit=5"
```

---

#### Consult (Get Guidance)
```
GET /consult?q={decision}&context={context}
```
Get Oracle guidance on a decision.

**Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `q` | Yes | The decision or question |
| `context` | No | Additional context |

**Example:**
```bash
curl "http://localhost:47778/consult?q=force+push+safety"
```

**Response:**
```json
{
  "decision": "force push safety",
  "principles": [],
  "patterns": [
    {
      "id": "learning_rebase-conflict",
      "content": "Never force push...",
      "source": "ψ/memory/learnings/rebase.md",
      "score": -8.2
    }
  ],
  "guidance": "Based on Oracle philosophy:\n\nRelevant Patterns:\n1. Never force push..."
}
```

---

#### Reflect (Random Wisdom)
```
GET /reflect
```
Get a random principle or learning for reflection.

**Example:**
```bash
curl "http://localhost:47778/reflect"
```

**Response:**
```json
{
  "id": "principle_nothing-deleted",
  "type": "principle",
  "content": "Nothing is ever deleted. Timestamps are truth.",
  "source_file": "ψ/memory/principles/nothing-deleted.md",
  "concepts": ["safety", "preservation"]
}
```

---

#### Stats
```
GET /stats
```
Get database statistics.

**Example:**
```bash
curl "http://localhost:47778/stats"
```

**Response:**
```json
{
  "total": 5583,
  "by_type": {
    "learning": 2473,
    "principle": 163,
    "retro": 2947
  },
  "last_indexed": "2026-01-03T09:48:14.563Z",
  "index_age_hours": 1.5,
  "is_stale": false,
  "is_indexing": false,
  "database": "/path/to/oracle.db"
}
```

---

#### Graph
```
GET /graph
```
Get knowledge graph data for visualization.

**Response:**
```json
{
  "nodes": [
    {
      "id": "principle_001",
      "type": "principle",
      "source_file": "ψ/memory/principles/safety.md",
      "concepts": ["safety", "git"]
    }
  ],
  "links": [
    {
      "source": "principle_001",
      "target": "learning_002",
      "weight": 2
    }
  ]
}
```

---

#### Learn (Add Knowledge)
```
POST /learn
Content-Type: application/json
```
Add a new learning to the knowledge base.

**Body:**
```json
{
  "pattern": "Always verify before destructive operations",
  "source": "Session retrospective",
  "concepts": ["safety", "git"]
}
```

**Example:**
```bash
curl -X POST http://localhost:47778/learn \
  -H "Content-Type: application/json" \
  -d '{"pattern":"New learning","concepts":["test"]}'
```

**Response:**
```json
{
  "success": true,
  "file": "ψ/memory/learnings/2026-01-03_new-learning.md",
  "id": "learning_2026-01-03_new-learning"
}
```

---

#### File (Read Content)
```
GET /file?path={path}
```
Read full file content.

**Note:** Unicode paths like `ψ` must be URL-encoded (`%CF%88`).

**Example:**
```bash
curl "http://localhost:47778/file?path=%CF%88/memory/principles/safety.md"
```

**Response:**
```json
{
  "path": "ψ/memory/principles/safety.md",
  "content": "---\ntitle: Safety First\n---\n\n# Safety First\n..."
}
```

---

### Dashboard API

#### Summary
```
GET /dashboard/summary
```
Aggregated dashboard statistics.

**Response:**
```json
{
  "documents": {
    "total": 5583,
    "by_type": { "learning": 2473, "principle": 163, "retro": 2947 }
  },
  "concepts": {
    "total": 329,
    "top": [{ "name": "git", "count": 245 }]
  },
  "activity": {
    "consultations_7d": 13,
    "searches_7d": 218,
    "learnings_7d": 0
  },
  "health": {
    "fts_status": "healthy",
    "last_indexed": "2026-01-03T09:48:14.563Z"
  }
}
```

---

#### Activity
```
GET /dashboard/activity?days={n}
```
Recent activity logs.

**Parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `days` | `7` | Number of days to include |

**Response:**
```json
{
  "consultations": [
    {
      "decision": "force push safety",
      "principles_found": 0,
      "patterns_found": 3,
      "created_at": "2026-01-03T09:46:29.000Z"
    }
  ],
  "searches": [
    {
      "query": "nothing deleted",
      "type": "all",
      "results_count": 78,
      "search_time_ms": 25,
      "created_at": "2026-01-03T11:19:55.000Z"
    }
  ],
  "learnings": [],
  "days": 7
}
```

---

#### Growth
```
GET /dashboard/growth?period={period}
```
Activity over time.

**Parameters:**
| Param | Default | Options |
|-------|---------|---------|
| `period` | `week` | `week`, `month`, `quarter` |

**Response:**
```json
{
  "period": "week",
  "days": 7,
  "data": [
    {
      "date": "2026-01-03",
      "documents": 5,
      "consultations": 3,
      "searches": 45
    }
  ]
}
```

---

## Error Handling

All errors return JSON:
```json
{
  "error": "Error message here"
}
```

Common errors:
- `400` - Missing required parameters
- `404` - Endpoint not found (includes available endpoints list)
- `500` - Server error

---

## Testing

### Unit Tests
```bash
bun test              # Run all unit tests (45 tests)
bun test:watch        # Watch mode
bun test:coverage     # With coverage
```

### E2E Tests (Browser Automation)

E2E tests use the `dev-browser` skill for browser automation.

```bash
# 1. Start the dev-browser server
cd ~/.claude/skills/dev-browser && ./server.sh &

# 2. Ensure backend and frontend are running
bun run server &                  # Backend on :47778
cd frontend && bun dev &          # Frontend on :3000

# 3. Run E2E tests
cd ~/.claude/skills/dev-browser && npx tsx /path/to/arra-oracle-v2/e2e/run-e2e.ts
```

**E2E Test Coverage (14 tests):**
- Homepage loads
- Header navigation
- QuickLearn FAB visible
- Navigate to Feed
- Feed shows documents
- Navigate to Search
- Search works
- Navigate to Activity
- Activity has tabs
- Navigate to Graph (canvas)
- Navigate to Consult
- QuickLearn modal opens
- QuickLearn has form fields
- Modal closes on X button

### API Integration Tests
```bash
# Health check
curl -s http://localhost:47778/health

# Search test
curl -s "http://localhost:47778/search?q=nothing+deleted"

# Dashboard summary
curl -s http://localhost:47778/dashboard/summary
```

---

## Architecture

```
src/
├── server.ts          # HTTP server & routing (305 lines)
└── server/
    ├── types.ts       # TypeScript interfaces
    ├── db.ts          # Database config & connection
    ├── logging.ts     # Search/consult logging
    ├── handlers.ts    # Core request handlers
    └── dashboard.ts   # Dashboard API handlers

frontend/
├── src/
│   ├── api/oracle.ts  # API client
│   ├── pages/         # React pages
│   └── components/    # Shared components
└── dist/              # Production build
```
