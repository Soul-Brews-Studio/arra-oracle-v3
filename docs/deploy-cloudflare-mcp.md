# Deploy Arra Oracle remote MCP on Cloudflare Workers

This guide covers the #2167 implementation path for one-click Cloudflare deploy,
the `McpAgent` Worker entry, and MCP client connection. The canonical deployable Worker lives in
`workers/mcp/` and `workers/mcp/wrangler.jsonc` points at `src/index.ts`.

## What this deploy gives you

- A Cloudflare Worker that exposes Arra Oracle MCP tools at `/mcp`.
- Streamable HTTP transport handled by Cloudflare's Agents SDK.
- A `workers.dev` URL that Claude, MCP Inspector, Cursor, Windsurf, or another
  remote-capable MCP client can connect to.
- Edge-safe tools are generated from `src/tools/mcp-rest-map.ts` entries marked `remoteable: true`.

The Worker proxies remoteable MCP tools to an existing Oracle HTTP API. Local
SQLite, filesystem vaults, and vector indexing stay in the backend/vector-server
planes instead of running in the Worker isolate.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Soul-Brews-Studio/arra-oracle-v3)

Use `workers/mcp/wrangler.jsonc` for the deploy target; it provisions the
`MCP_OBJECT` Durable Object binding and deploys the Worker. The root
`wrangler.jsonc` is a legacy teardown config for `arra-oracle-remote-mcp`. The deployed MCP URL
will be:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

## Worker shape

The entry uses Cloudflare `McpAgent` and Durable Object session state. At init,
`workers/mcp/src/tools.ts` loops over the pure `remoteableMcpRestMap` table and
registers only REST-proxyable tools. The Worker must not import the Bun-side
`src/tools/mcp-manifest.ts`, DB modules, or vector adapters.

`/health` is a normal HTTP readiness endpoint. `/mcp` expects MCP protocol
messages, so use MCP Inspector, `mcp-remote`, or a remote-capable client instead
of browser navigation. See `docs/architecture/mcp-remote-transport.md` for the
transport contract.

## Required configuration

| Setting | Purpose |
| --- | --- |
| `main` | `workers/mcp/src/index.ts` via `workers/mcp/wrangler.jsonc`. |
| `compatibility_flags` | Includes `nodejs_compat` for Agents SDK/runtime compatibility. |
| `MCP_OBJECT` | Durable Object binding required by `McpAgent` session state. |
| `ORACLE_URL` | Backend URL for proxying remoteable tools to a full Arra Oracle server. |
| `ORACLE_API_TOKEN` | Optional Bearer token for protected backend calls. |
| D1/Vectorize/R2 | Future edge-native persistence/search replacements. |

Without `ORACLE_ORIGIN_URL` or fallback `ORACLE_URL`, proxy tools return a clear
MCP tool error that explains how to configure the backend.

## Manual Wrangler deploy fallback

Use this when the button is not ready or you need to test a branch preview:

```bash
cd workers/mcp
bun install
bunx tsc --noEmit
bunx wrangler deploy --config wrangler.jsonc
```

For local Workers testing:

```bash
bun run cloudflare:mcp:dev
curl -sf http://localhost:8787/health
```

Store secrets with Wrangler or the Cloudflare dashboard, not in git:

```bash
cd workers/mcp
bunx wrangler secret put ORACLE_API_TOKEN --config wrangler.jsonc
```

## Smoke test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

In the inspector UI, connect to:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

Then select **List Tools**. You should see remoteable REST tools from
`src/tools/mcp-rest-map.ts`, such as `oracle_search`, `oracle_stats`, and
`oracle_learn`.

## Client connection: Claude Desktop + mcp-remote

Claude Desktop can connect through the `mcp-remote` local proxy. Open Claude
Desktop settings, edit the Developer MCP config, and add:

```json
{
  "mcpServers": {
    "arra-oracle-cloudflare": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<worker-name>.<account>.workers.dev/mcp"
      ]
    }
  }
}
```

If your Claude client supports remote MCP URLs directly, use the same `/mcp` URL
as the server URL.

## Multi-tenant setup for teams and schools

For shared deployments, run one Worker endpoint for the organization and map each
authenticated user to exactly one trusted tenant before proxying tools to Arra
Oracle. Example models:

| Model | Tenant example | Mapping source |
| --- | --- | --- |
| School | `grade-8`, `science-dept`, `library` | Google Workspace group, Access group, or D1 roster row |
| Team | `platform`, `design`, `support` | GitHub org/team, WorkOS org, or Auth0 organization |
| SaaS | `customer-acme`, `customer-river` | Billing/customer table or D1 tenant registry |

Do not treat caller-supplied `tenantId` as authorization. Put OAuth or
Cloudflare Access in front of `/mcp`, resolve the signed-in identity to a tenant,
and forward only that trusted tenant to `ORACLE_HTTP_URL`. Backend routes already
scope by tenant ID from #1650.

Recommended rollout:

1. Keep the Phase 1 proxy private or token-protected until OAuth is wired.
2. Choose a tenant registry: static `wrangler.jsonc` vars for small teams, or D1
   for self-serve tenants and roster changes.
3. Store a tenant claim in `McpAgent` props.
4. Reject users without a tenant mapping instead of falling back to a shared
   default tenant.
5. Forward backend-compatible tenant headers to `ORACLE_HTTP_URL` when the proxy
   adds authenticated tenant support.

## Storage roadmap

This Worker intentionally avoids importing local SQLite, Drizzle, LanceDB, or
embedding runtimes. Follow-up slices should add Cloudflare-native storage:

- D1 for metadata and FTS-style document lookup.
- Vectorize for embedding search.
- Workers AI or a remote embedding service for indexing.
- OAuth/Cloudflare Access before exposing write tools.

## Troubleshooting

- **Deploy button fails early:** confirm the repo is public and points to the
  the `workers/mcp` package and `workers/mcp/wrangler.jsonc`.
- **Build cannot find bindings:** confirm `MCP_OBJECT` exists in
  `durable_objects.bindings` and migrations list `OracleMCP`.
- **`/mcp` returns a browser error:** use MCP Inspector or `mcp-remote`; direct
  browser navigation is not a valid MCP request.
- **Claude shows no tools:** verify the deployed URL ends in `/mcp`, restart the
  client, and run MCP Inspector to separate client config from server issues.
- **Search fails:** set `ORACLE_URL` or `ORACLE_HTTP_URL`; if protected, also
  set `ORACLE_API_TOKEN`.

## References

- Cloudflare Deploy buttons: <https://developers.cloudflare.com/workers/platform/deploy-buttons/>
- Cloudflare remote MCP guide: <https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/>
- Cloudflare authless remote MCP template: <https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless>
- Testing remote MCP clients: <https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/>
