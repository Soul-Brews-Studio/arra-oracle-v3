# MCP Tools Reference

arra-oracle-v3 exposes 24 MCP tools across 5 configurable groups + 4 standalone tools.

## Tool Groups

Groups can be enabled/disabled via `arra.config.json` (repo-local) or `~/.arra-oracle-v2/config.json` (global).

```json
{
  "tools": {
    "search": true,
    "knowledge": true,
    "session": true,
    "forum": true,
    "trace": true
  }
}
```

## Search (4 tools)

| Tool | Description |
|------|-------------|
| `oracle_search` | Hybrid search (FTS5 keywords + vector similarity). Finds principles, patterns, learnings, retros. |
| `oracle_read` | Read full content of a document by file path or document ID. |
| `oracle_list` | Browse all documents without searching. Supports type/date filters and pagination. |
| `oracle_concepts` | List all concept tags with document counts. Discover topic coverage. |

## Knowledge (3 tools)

| Tool | Description |
|------|-------------|
| `oracle_learn` | Add a new pattern/learning. Creates markdown in `ψ/memory/learnings/` and indexes to SQLite + vectors. |
| `oracle_stats` | Knowledge base statistics: doc counts by type, indexing status, vector DB health. |
| `oracle_supersede` | Mark old doc as superseded by newer one. "Nothing is Deleted" — old preserved, just marked. |

## Session (2 tools)

| Tool | Description |
|------|-------------|
| `oracle_handoff` | Write session context to `ψ/inbox/` for future sessions. |
| `oracle_inbox` | List pending handoff files, sorted newest-first with previews. |

## Forum (4 tools)

| Tool | Description |
|------|-------------|
| `oracle_thread` | Send message to a discussion thread. Creates new or continues existing. Oracle auto-responds. |
| `oracle_threads` | List threads. Filter by status (pending/active/closed). |
| `oracle_thread_read` | Read full message history from a thread. |
| `oracle_thread_update` | Update thread status (close, reopen, mark answered). |

## Trace (6 tools)

| Tool | Description |
|------|-------------|
| `oracle_trace` | Log a trace session with dig points (files, commits, issues). |
| `oracle_trace_list` | List recent traces with optional filters. |
| `oracle_trace_get` | Get full trace details including all dig points. |
| `oracle_trace_link` | Link two traces as a chain (prev → next). Bidirectional. |
| `oracle_trace_unlink` | Remove a link between traces in specified direction. |
| `oracle_trace_chain` | Get full linked chain for a trace. |

## Standalone (5 tools)

| Tool | Description |
|------|-------------|
| `oracle_reflect` | Get a random principle or learning for reflection. |
| `oracle_verify` | Verify integrity: compare `ψ/` files on disk vs DB index. Detect missing/orphaned docs. |
| `oracle_schedule_add` | Add appointment to shared schedule (per-human, cross-project). |
| `oracle_schedule_list` | List upcoming schedule entries. |
| `____IMPORTANT` | Meta-documentation tool — workflow guide shown in tool list. |

## Read-Only Mode

When `ORACLE_READ_ONLY=true` or `--read-only`, write tools are disabled:
- `oracle_learn`, `oracle_thread`, `oracle_thread_update`, `oracle_trace`, `oracle_supersede`, `oracle_handoff`

## Installation

```bash
# Install globally
bun install -g arra-oracle-v3

# Or run from source
bun install
bun src/index.ts
```

### Claude Code MCP config (`~/.claude.json`)

```json
{
  "mcpServers": {
    "arra-oracle": {
      "command": "bun",
      "args": ["~/.bun/install/global/node_modules/arra-oracle-v3/src/index.ts"],
      "env": {}
    }
  }
}
```

### Minimal (MCP only, no indexer)

The MCP server works without the indexer. Indexing is a separate concern:
- MCP server: `bun src/index.ts` (reads from SQLite + vectors)
- HTTP server: `bun src/server.ts` (REST API + dashboard)
- Indexer: `bun src/scripts/index-model.ts <model>` (populates DB, run separately)

The MCP server only needs the SQLite database and vector store files. It does not need Ollama running unless you trigger a write tool (`oracle_learn`) that embeds new content.
