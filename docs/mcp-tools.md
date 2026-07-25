# MCP Tools Reference

arra-oracle-v3 exposes 30 MCP tools across configurable groups, Oracle profiles, bridge tools, and standalone tools.

## Tool Groups

Groups can be enabled/disabled via `arra.config.json` (repo-local) or `~/.arra-oracle-v2/config.json` (global).

**Precedence — FIRST MATCH WINS, tiers are never merged.** The loader takes the
first file below that carries a tool-config key (`tools`, `plugins`,
`disabled_tools`, `enabled_tools` or `mcp`) and ignores the rest entirely:

1. `<repo root>/arra.config.json`
2. `<repo root>/plugins.json` (plugin manifest only)
3. `$ORACLE_DATA_DIR/config.json` (default `~/.arra-oracle-v2/config.json`)
4. `$ORACLE_DATA_DIR/plugins.json` (plugin manifest only)

A repo-root file therefore shadows your global config completely — it does not
add to it. `GET /api/v1/settings/tools` reports the winning file as
`config_path`, which is also the file `PUT` writes.

Environment variables are applied on top of whichever file wins:
`ORACLE_ENABLED_TOOLS` is a strict allow-list, `ORACLE_DISABLED_TOOLS` is
subtractive, and the block list wins where both name the same tool.

> **Known inert:** the top-level `mcp` boolean is parsed and counts toward
> whether a file is treated as tool config, but nothing reads it — it does not
> disable the MCP surface. Tracked separately from #2822; use `disabled_tools`
> for the bridge tools instead.

```json
{
  "tools": {
    "search": true,
    "knowledge": true,
    "session": true,
    "forum": true,
    "oracle": true,
    "trace": true,
    "standalone": true
  }
}
```

## Search (6 tools)

| Tool | Description |
|------|-------------|
| `oracle_ask` | Grounded ask over Oracle memory/search. Returns `answer`, `citations`, `citationIndexes`, `warnings`, `noEvidence`, `sources`, and optional `asOf`. |
| `oracle_search` | Hybrid search (FTS5 keywords + vector similarity). Supports `asOf` valid-time lookup. |
| `oracle_search_chain` | Multi-hop search that follows citations across documents. |
| `oracle_read` | Read full content of a document by file path or document ID. |
| `oracle_list` | Browse all documents without searching. Supports type/date/asOf filters and pagination. |
| `oracle_concepts` | List all concept tags with document counts. Discover topic coverage. |

## Knowledge (4 tools)

| Tool | Description |
|------|-------------|
| `oracle_learn` | Add a new pattern/learning. Creates markdown in `ψ/memory/learnings/` and indexes to SQLite + vectors. |
| `oracle_stats` | Knowledge base statistics: doc counts by type, indexing status, vector DB health. |
| `oracle_supersede` | Mark old doc as superseded by newer one. "Nothing is Deleted" — old preserved, just marked. |
| `oracle_research_note` | Store a Thor Stormforge research/dev artifact as searchable learning memory. |

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

## Oracle (2 tools)

| Tool | Description |
|------|-------------|
| `oracle_recap` | Cheap recap of identity, projects, and recent top memories for session warmup. |
| `oracle_profile` | List/read code-backed Oracle profiles such as Thor Oracle / Stormforge. |

## Trace (7 tools)

| Tool | Description |
|------|-------------|
| `oracle_trace` | Log a trace session with dig points (files, commits, issues). |
| `oracle_trace_list` | List recent traces with optional filters. |
| `oracle_trace_get` | Get full trace details including all dig points. |
| `oracle_trace_link` | Link two traces as a chain (prev → next). Bidirectional. |
| `oracle_trace_unlink` | Remove a link between traces in specified direction. |
| `oracle_trace_chain` | Get full linked chain for a trace. |
| `oracle_trace_distill` | Distill a trace into a Thor/Stormforge awakening and optionally promote it to learning memory. |

## Standalone (2 tools)

| Tool | Description |
|------|-------------|
| `oracle_reflect` | Get a random principle or learning for reflection. |
| `oracle_verify` | Verify integrity: compare `ψ/` files on disk vs DB index. Detect missing/orphaned docs. |

## Guide + bridge (3 tools)

| Tool | Description |
|------|-------------|
| `____IMPORTANT` | Meta-documentation tool — workflow guide shown in tool list. |
| `oracle_mcp_list_tools` | List tools exposed by configured external MCP servers. |
| `oracle_mcp_call` | Call a tool exposed by a configured external MCP server. |

The two bridge tools belong to no group **on purpose** (`ALWAYS_ON_TOOLS` in
`src/config/tool-groups-core.ts`): a config that turns every group off must still
be able to reach a remote Oracle. This is a default, not a lock — name them in
`disabled_tools` or `ORACLE_DISABLED_TOOLS` to switch them off.

## Consolidation governance decision

Memory consolidation review stays HTTP-first for now: use
`GET /api/v1/memory/consolidation/pending` or `/suggestions`, then approve or
reject via the HTTP endpoints only after an explicit human decision. MCP does
not expose approve/reject tools yet because those actions must carry an audited
actor (`x-oracle-actor`, `x-actor`, `x-user`, or `x-user-id`) plus a reason.
Any future MCP consolidation approval tool must require `actor` in its schema;
background or anonymous auto-approval is not allowed.

## Read-Only Mode

When `ORACLE_READ_ONLY=true` or `--read-only`, write tools are disabled:
- `oracle_learn`, `oracle_research_note`, `oracle_thread`, `oracle_thread_update`, `oracle_trace`, `oracle_trace_distill`, `oracle_supersede`, `oracle_handoff`, `oracle_mcp_call`

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
