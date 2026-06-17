# Deploy Arra Oracle on Cloudflare Workers

> Status: **retired root skeleton for #2227 Slice 0.** The canonical remote MCP
> Worker now lives under `workers/mcp/`; the root `wrangler.jsonc` only carries
> a `deleted_classes` migration for the previously deployed `OracleMcpAgent`.

## Goal

Make Arra Oracle installable as a Cloudflare Workers deployment. The active
remote MCP Worker is `workers/mcp` (`arra-oracle-mcp`); the older root
`arra-oracle-remote-mcp` worker is retained only long enough to apply its
Durable Object delete migration.

## Coordination guardrails

- Do not edit `src/workers/canvas/**` or `workers/canvas/wrangler.toml`; that
  Cloudflare Worker already serves the canvas subdomain.
- Do not move `src/vector/**` adapters in this docs slice. The edge vector lane
  should decide how local adapters map to Cloudflare Vectorize/Workers AI.
- Use `workers/mcp/wrangler.jsonc` for active remote MCP deploys.
- Do not reintroduce root `src/workers/*` MCP skeletons after the DO teardown.

## Deploy button target

The root `README.md` includes this button so users can start the Cloudflare
fork-and-deploy flow from the project front page:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Soul-Brews-Studio/arra-oracle-v3)
```

Cloudflare's deploy button flow clones the repository, lets the user customize
resource names, builds the Worker, and can provision/bind required resources.

## Runtime shape

Recommended first deployable milestone:

1. `GET /health` returns worker-native readiness.
2. `/mcp` exposes 1-2 safe Oracle MCP tools over Streamable HTTP.
3. Full semantic search is feature-gated until D1/Vectorize import is complete.

Cloudflare's MCP guide supports three server shapes:

- `createMcpHandler()` for stateless tools.
- `McpAgent` for stateful per-session tools backed by Durable Objects.
- Raw `@modelcontextprotocol/sdk` transport for full control.

Start stateless unless a tool needs session state. Add `McpAgent` and Durable
Object bindings only when the entrypoint exports that class.

## Wrangler config notes

Cloudflare recommends `wrangler.jsonc` for new Workers projects. Minimum deploy
config needs `name`, `main`, and `compatibility_date`; `main` can be omitted only
for assets-only Workers.

The active MCP Worker uses `workers/mcp/wrangler.jsonc`. The root Wrangler file is a teardown-only config:

```jsonc
{
  "name": "arra-oracle-remote-mcp",
  "main": "src/workers/remote-mcp-teardown.ts",
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["OracleMcpAgent"] },
    { "tag": "v2", "deleted_classes": ["OracleMcpAgent"] }
  ]
}
```

`nodejs_compat` is included because current server/tool code imports Node-shaped
APIs. It does not make native addons or filesystem SQLite safe on Workers.

## Bindings plan

| Need | Cloudflare binding | Notes |
| --- | --- | --- |
| Relational state | D1 (`ORACLE_DB`) | Replace local `better-sqlite3` / file DB access in Worker code. |
| Embeddings | Workers AI (`AI`) | Use for edge embedding models when not proxying to another service. |
| Vector search | Vectorize (`ORACLE_VECTORIZE`) | Bind the index in Wrangler after the vector lane chooses dimensions/model. |
| Small state/cache | KV (`ORACLE_STATE`) | Optional for deploy metadata, OAuth state, or lightweight caches. |
| Secrets | Wrangler secrets | Do not commit tokens; declare required names only after auth is implemented. |

The canonical `workers/mcp/wrangler.jsonc` owns the active `MCP_OBJECT` Durable
Object binding for `OracleMCP`.

## Manual deploy fallback

After binding names are finalized:

```bash
bun install
cd workers/mcp
bunx wrangler@latest types --config wrangler.jsonc
bunx wrangler@latest dev --config wrangler.jsonc
bunx wrangler@latest deploy --config wrangler.jsonc
```

For local tests that must hit real Cloudflare bindings, use Wrangler remote
binding mode for the specific binding/resource rather than mocking production
state in the repo.

## Client connection sketch

If the MCP client supports remote Streamable HTTP, point it at:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

For clients that need a local bridge, use `mcp-remote`:

```json
{
  "mcpServers": {
    "arra-oracle-cloudflare": {
      "command": "npx",
      "args": ["mcp-remote", "https://<worker-name>.<account>.workers.dev/mcp"]
    }
  }
}
```

## Known gaps before full production deploy

- Decide whether the first MCP tools call D1/Vectorize directly or proxy a
  trusted Arra HTTP backend.
- Port or gate local-only modules that depend on native SQLite, filesystem
  persistence, or Bun-only APIs.
- Run a real Cloudflare deploy and post the deploy-flow screenshot in #2167.

## References

- Cloudflare Workers configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Remote MCP on Workers: https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- McpAgent API: https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/
- Deploy to Cloudflare buttons: https://developers.cloudflare.com/workers/platform/deploy-buttons/
- D1 bindings: https://developers.cloudflare.com/d1/get-started/
- Vectorize bindings: https://developers.cloudflare.com/vectorize/get-started/intro/
- Workers AI binding: https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
