# Oracle Dashboard Proposal

> A web interface for monitoring Oracle usage, viewing analytics, and exploring the knowledge graph.

## Goals

1. **Visibility** - See what's in the knowledge base
2. **Analytics** - Track usage patterns and trends
3. **Learning** - Monitor knowledge growth over time
4. **Health** - System status at a glance

## Dashboard Mockup

```
┌─────────────────────────────────────────────────────────────────────┐
│  ORACLE DASHBOARD                                          v0.3.0  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │    500     │  │     45     │  │     87     │  │  Connected │    │
│  │ Documents  │  │  Concepts  │  │  Consults  │  │  LanceDB   │    │
│  │            │  │            │  │  (7 days)  │  │            │    │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │
│                                                                     │
├─────────────────────────────────┬───────────────────────────────────┤
│  Recent Consultations           │  Top Concepts                     │
│  ┌─────────────────────────────┐│  ┌───────────────────────────┐   │
│  │ "should I force push?"      ││  │ trust        ████████ 23  │   │
│  │ 3 principles, 2 patterns    ││  │ safety       ██████   18  │   │
│  │ 2 min ago                   ││  │ pattern      █████    15  │   │
│  ├─────────────────────────────┤│  │ context      ████     12  │   │
│  │ "how to handle errors"      ││  │ append-only  ███       9  │   │
│  │ 2 principles, 1 pattern     ││  │ history      ██        6  │   │
│  │ 15 min ago                  ││  └───────────────────────────┘   │
│  └─────────────────────────────┘│                                   │
│                                 │                                   │
├─────────────────────────────────┼───────────────────────────────────┤
│  Document Types                 │  Learnings This Week              │
│  ┌─────────────────────────────┐│  ┌───────────────────────────┐   │
│  │     ┌───────┐               ││  │ Mon  ██                   │   │
│  │    /         \              ││  │ Tue  ████                 │   │
│  │   │ Principle │ 163 (33%)   ││  │ Wed  █                    │   │
│  │    \         /              ││  │ Thu  ███                  │   │
│  │     └───────┘               ││  │ Fri  ██████               │   │
│  │    Learning: 200 (40%)      ││  │ Sat  █                    │   │
│  │    Retro: 87 (17%)          ││  │ Sun  ██                   │   │
│  │    Pattern: 50 (10%)        ││  └───────────────────────────┘   │
│  └─────────────────────────────┘│                                   │
│                                 │                                   │
├─────────────────────────────────┴───────────────────────────────────┤
│  Knowledge Graph                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │           ○ trust                                           │   │
│  │          /|\                                                │   │
│  │         / | \                                               │   │
│  │        ○──○──○ safety                                       │   │
│  │       /   |   \                                             │   │
│  │      ○    ○    ○ pattern                                    │   │
│  │     context  history                                        │   │
│  │                                                             │   │
│  │  [Filter: principle ▼]  [Concept: all ▼]  [Zoom: + -]       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  System Health                                                      │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐     │
│  │ FTS5: ✓      │ LanceDB: ✓  │ Indexed: 2h  │ Version: 0.2 │     │
│  │ healthy      │ connected    │ ago          │              │     │
│  └──────────────┴──────────────┴──────────────┴──────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

## New Database Tables

### `search_log` - Track Searches

```sql
CREATE TABLE search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  type TEXT,                    -- filter type used
  mode TEXT,                    -- hybrid/fts/vector
  results_count INTEGER,
  search_time_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_search_created ON search_log(created_at);
```

### `learn_log` - Track Learnings

```sql
CREATE TABLE learn_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  pattern_preview TEXT,         -- first 100 chars
  source TEXT,
  concepts TEXT,                -- JSON array
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_learn_created ON learn_log(created_at);
```

### `document_access` - Track Access

```sql
CREATE TABLE document_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  access_type TEXT,             -- search/consult/reflect/view
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_access_doc ON document_access(document_id);
CREATE INDEX idx_access_created ON document_access(created_at);
```

## New API Endpoints

### Dashboard Stats

```
GET /dashboard/summary
```

Response:
```json
{
  "documents": {
    "total": 500,
    "by_type": {
      "principle": 163,
      "learning": 200,
      "pattern": 50,
      "retro": 87
    }
  },
  "concepts": {
    "total": 45,
    "top": [
      {"name": "trust", "count": 23},
      {"name": "safety", "count": 18}
    ]
  },
  "activity": {
    "consultations_7d": 87,
    "searches_7d": 234,
    "learnings_7d": 12
  },
  "health": {
    "fts_status": "healthy",
    "chroma_status": "connected",
    "last_indexed": "2025-01-03T10:00:00Z"
  }
}
```

### Recent Activity

```
GET /dashboard/activity?days=7
```

Response:
```json
{
  "consultations": [
    {
      "decision": "should I force push?",
      "principles_found": 3,
      "patterns_found": 2,
      "created_at": "2025-01-03T12:30:00Z"
    }
  ],
  "searches": [
    {
      "query": "git safety",
      "results_count": 5,
      "search_time_ms": 45,
      "created_at": "2025-01-03T12:25:00Z"
    }
  ],
  "learnings": [
    {
      "document_id": "learning_2025-01-03_oracle-loop",
      "pattern_preview": "Oracle can improve itself...",
      "created_at": "2025-01-03T11:00:00Z"
    }
  ]
}
```

### Growth Metrics

```
GET /dashboard/growth?period=week
```

Response:
```json
{
  "period": "week",
  "data": [
    {"date": "2025-01-01", "documents": 2, "consultations": 12},
    {"date": "2025-01-02", "documents": 5, "consultations": 23},
    {"date": "2025-01-03", "documents": 1, "consultations": 8}
  ]
}
```

## Implementation Phases

### Phase 1: Logging Infrastructure (1-2 hours)

1. Add `search_log` table
2. Add `learn_log` table
3. Add `document_access` table
4. Instrument `handleSearch()` to log queries
5. Instrument `handleLearn()` to log additions
6. Add access tracking to search/consult results

### Phase 2: Dashboard API (1-2 hours)

1. Add `/dashboard/summary` endpoint
2. Add `/dashboard/activity` endpoint
3. Add `/dashboard/growth` endpoint
4. Add date range filtering

### Phase 3: Dashboard UI (2-3 hours)

1. Create `dashboard.html` with stats cards
2. Add consultation history table
3. Add top concepts bar chart
4. Add document type pie chart
5. Add learning timeline
6. Integrate knowledge graph visualization

## Tech Stack

- **Backend**: Existing Elysia server (`src/server.ts`)
- **Frontend**: Vanilla HTML/CSS/JS (keep it simple)
- **Charts**: Chart.js or simple CSS bars
- **Graph**: D3.js or vis.js for knowledge graph

## Success Metrics

Show last-24h activity, top concepts, knowledge growth, health status, and load in under 1 second.
