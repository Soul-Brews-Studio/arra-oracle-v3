# Arra Oracle CLI and usage guide

Use this guide when installing Arra Oracle from GitHub, wiring Claude MCP,
running local surfaces, or choosing between CLI, MCP, HTTP, and Workers deploys.
For architecture details, start from [architecture.md](./architecture.md).

## 1. Install

Use a pinned release tag for repeatable operator installs; use `#alpha` only for
moving trunk testing.

```bash
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#vX.Y.Z-alpha.N
# development/head install:
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#alpha

arra-oracle-v3 --help
arra --version
```

The package bin is `arra-oracle-v3` for the HTTP/MCP server wrapper and `arra`
for the operator CLI. Some older examples say `arra-oracle`; substitute
`arra-oracle-v3` unless your shell has that alias.

Source checkout for development:

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bunx tsc --noEmit
```

## 2. Three local surfaces

```bash
# HTTP API + Swagger, default http://localhost:47778
export ORACLE_DATA_DIR="$HOME/.oracle"
bun run server
# or, after global install: arra-oracle-v3 serve --port 47778

# Stdio MCP server for Claude/agents
arra-oracle-v3 mcp
arra-oracle-v3 mcp --read-only
# source equivalent: bun bin/arra.ts mcp [--read-only]

# React Studio frontend; proxies /api/* to the Bun backend
cd frontend
bun install
bun run dev
```

Common operator CLI calls:

```bash
arra config add local http://localhost:47778
arra config use local
arra health
arra search "confidence ranking" --limit 5
arra learn "New project fact" --source cli-guide
arra vector-config list --json
arra export --url http://localhost:47778 --collection oracle_documents \
  --format markdown --output oracle.md
```

## 3. Claude MCP add

From a source checkout, point Claude at the launcher that resolves `src/index.ts`
from the repo root:

```bash
claude mcp add arra-oracle --cwd "$PWD" -- bun bin/mcp.ts
claude mcp add arra-oracle-ro --cwd "$PWD" -- bun bin/mcp.ts --read-only
claude mcp list
```

From a global install:

```bash
claude mcp add arra-oracle -- arra-oracle-v3 mcp
claude mcp add arra-oracle-ro -- arra-oracle-v3 mcp --read-only
```

For stdio safety, set `ORACLE_LOG_TARGET=stderr` if your client supports MCP env
configuration. For proxy mode, set `ORACLE_HTTP_URL=http://localhost:47778` so
MCP calls reuse an already running HTTP backend.

## 4. MCP tools: 27 advertised tools

`bin/arra.ts mcp` loads `src/index.ts`, which registers the manifest in
`src/tools/mcp-manifest.ts`. In Claude or MCP Inspector, `tools/list` should
show 27 core tools before plugin tools.

### Search and read

| Tool | Mode | Use |
| --- | --- | --- |
| `____IMPORTANT` | read | Workflow guide shown in tool lists. |
| `oracle_search` | read | Hybrid FTS/vector search over memories. |
| `oracle_read` | read | Read one document by id/path. |
| `oracle_list` | read | Browse documents with filters. |
| `oracle_stats` | read | Knowledge-base and vector health stats. |
| `oracle_concepts` | read | List concept tags with counts. |
| `oracle_profile` | read | Read code-backed Oracle profiles. |
| `oracle_reflect` | read | Return a random principle/learning. |
| `oracle_inbox` | read | Preview handoff files. |

### Write, verify, and bridge

| Tool | Mode | Use |
| --- | --- | --- |
| `oracle_learn` | write | Add a learning and index it. |
| `oracle_supersede` | write | Mark an older doc superseded, never deleted. |
| `oracle_research_note` | write | Store a Thor/Stormforge research note. |
| `oracle_handoff` | write | Write a session handoff to `ψ/inbox`. |
| `oracle_verify` | write | Verify disk-vs-DB integrity; can mark orphans when not in check mode. |
| `oracle_mcp_list_tools` | read | List tools from another stdio MCP server. |
| `oracle_mcp_call` | write | Call one external MCP tool. |

### Threads

| Tool | Mode | Use |
| --- | --- | --- |
| `oracle_thread` | write | Create or continue an Oracle discussion thread. |
| `oracle_threads` | read | List threads by status. |
| `oracle_thread_read` | read | Read a thread history. |
| `oracle_thread_update` | write | Close, reopen, or mark a thread. |

### Traces and dig chains

| Tool | Mode | Use |
| --- | --- | --- |
| `oracle_trace` | write | Log a trace session and findings. |
| `oracle_trace_list` | read | List trace summaries. |
| `oracle_trace_get` | read | Read full trace details. |
| `oracle_trace_link` | write | Link traces into a chain. |
| `oracle_trace_unlink` | write | Remove one trace-chain link. |
| `oracle_trace_chain` | read | Read a linked trace chain. |
| `oracle_trace_distill` | write | Distill a trace into memory. |

`--read-only` or `ORACLE_READ_ONLY=true` hides write tools for safer browsing.

## 5. HTTP API quick calls

Canonical API paths are `/api/v1/*`; legacy `/api/*` paths usually redirect.
Infrastructure endpoints `/api/health` and `/api/docs` stay unversioned.

```bash
curl -sf http://localhost:47778/api/health
curl -s 'http://localhost:47778/api/v1/search?q=oracle&limit=5'
curl -s 'http://localhost:47778/api/v1/vector/export?collection=bge-m3&format=jsonl'
curl -s -X POST http://localhost:47778/api/ask \
  -H 'content-type: application/json' \
  -d '{"q":"What changed in the memory pipeline?","limit":5}'
open http://localhost:47778/api/docs
```

When `ARRA_API_TOKEN` is set, protected `/api/*` calls need
`Authorization: Bearer <token>`.

## 6. Useful scripts

| Script | Purpose |
| --- | --- |
| `bun run server` | Start the Elysia HTTP API. |
| `bun run vector` | Start read-only vector server. |
| `bun run vector:proxy` | Start vector proxy mode with `ORACLE_VECTOR_DB=lancedb`. |
| `bun run index` | Run the indexer CLI. |
| `bun run db:push` | Push Drizzle schema changes. |
| `bunx tsc --noEmit` | Required build/type gate. |
| `bun test tests/docs` | Scoped docs contract tests. |

## 7. Deploy Workers: MCP, Studio, federation

Production shape: keep the Bun backend and data on a trusted origin, then deploy
thin Cloudflare Workers for remote MCP, Studio, and federation relay.

```bash
# prove configs before deploy
bun run cloudflare:mcp:dry-run
bun run cloudflare:studio:dry-run
bun run cloudflare:federation:dry-run

# deploy when secrets are set
bun run cloudflare:mcp:deploy
bun run cloudflare:studio:deploy
bun run cloudflare:federation:deploy
```

Set `ORACLE_ORIGIN_URL` and `ARRA_API_TOKEN` as Worker secrets for MCP/Studio.
Set `TUNNEL_URL` and `FEDERATION_TOKEN` for federation. See
[deploy-production.md](./deploy-production.md),
[deploy-cloudflare-mcp.md](./deploy-cloudflare-mcp.md), and
[workers-deploy-configs.md](./workers-deploy-configs.md).

## 8. Environment variables

| Variable | Surface | Purpose |
| --- | --- | --- |
| `ORACLE_DATA_DIR` | all | Shared data root; set explicitly so CLI, HTTP, and MCP see the same DB. |
| `ORACLE_DB_PATH` | local | Override SQLite DB path. |
| `ORACLE_REPO_ROOT` | MCP/CLI | Force repo root discovery. |
| `ORACLE_PORT` / `PORT` | HTTP | API port; default `47778`. |
| `ORACLE_API` | CLI | Operator CLI target base URL. |
| `ORACLE_HTTP_URL` | MCP | Proxy stdio MCP calls to an HTTP backend. |
| `ORACLE_LOG_TARGET` | MCP | Use `stderr` to keep stdout valid JSON-RPC. |
| `ORACLE_READ_ONLY` | MCP | Disable write tools when `true`. |
| `ARRA_API_TOKEN` | HTTP/Workers | Bearer token for protected API calls. |
| `ORACLE_TENANT_TOKENS` | HTTP | Tenant token map for shared deployments. |
| `VECTOR_URL` | HTTP | Remote vector server/proxy base URL. |
| `ORACLE_VECTOR_DB` | vector | Select vector adapter such as `lancedb`, `qdrant`, `proxy`. |
| `QDRANT_URL` / `QDRANT_API_KEY` | vector | Qdrant backend config. |
| `ORACLE_EMBEDDER` | embeddings | `none`, `ollama`, `openai`, `gemini`, `cloudflare-ai`, etc. |
| `ORACLE_EMBEDDING_MODEL` | embeddings | Active embedding model, default commonly `bge-m3`. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL` | embeddings | Provider credentials/endpoints. |
| `ORACLE_ORIGIN_URL` / `ORACLE_URL` | Workers | Backend origin for MCP and Studio Workers. |
| `ORACLE_MCP_URL` | Studio Worker | Split remote MCP URL for Studio `/mcp/*`. |
| `TUNNEL_URL`, `FEDERATION_TOKEN` | federation | Signed federation relay origin and HMAC secret. |
| `ARRA_CORS_ORIGINS` | HTTP | Allowed browser origins. |

## 9. Traps and fixes

- **MCP JSON parse errors:** logs went to stdout. Use `ORACLE_LOG_TARGET=stderr`.
- **CLI cannot reach server:** start `bun run server` or set `ORACLE_API` / `arra --at`.
- **MCP proxy fails:** `ORACLE_HTTP_URL` must point at a healthy backend; match `ARRA_API_TOKEN`.
- **Different data per surface:** set the same `ORACLE_DATA_DIR` for HTTP, MCP, CLI, and Docker.
- **Versioned route surprise:** use `/api/v1/*` except `/api/health` and `/api/docs`.
- **Workers cannot open SQLite/LanceDB:** Workers are edge proxies; keep DB/vector files on the origin.
- **Vector unavailable:** FTS search still works; configure vector later with `arra vector-config`.
- **Secrets in git:** never commit real tokens, origin URLs, or Cloudflare credentials.
