# MCP remote transport contract (#2227 Slice 2b)

This contract covers the Cloudflare Worker in `workers/mcp`. It is the edge MCP
transport surface; it does not run local SQLite, LanceDB, filesystem indexing, or
Bun-only tool handlers.

## Runtime boundary

```text
MCP client -> workers/mcp /mcp -> ORACLE_ORIGIN_URL /api/* -> maw arra backend
```

- The Worker hosts a Streamable HTTP MCP endpoint at `/mcp` through `McpAgent`.
- Tool execution is REST proxying only. The Worker generates its tool list from
  the pure `src/tools/mcp-rest-map.ts` table and registers entries with
  `remoteable: true`.
- Backend calls use `ORACLE_ORIGIN_URL` first, then `ORACLE_URL`, then
  `ORACLE_HTTP_URL`, then `ORACLE_API`.
- Tenant forwarding is shipped: authenticated `McpAgent` props/claims win before
  deploy fallback `ORACLE_TENANT_ID` and tool `tenantId`; the Worker forwards
  `X-Tenant-ID`, `X-Oracle-Tenant`, and `X-Oracle-Tenant-ID`.
- `ARRA_API_TOKEN` / `ARRA_API_KEY` are forwarded as Bearer auth when present.

## mcp-remote client bridge

Clients that only support local stdio MCP should use `mcp-remote` as a bridge.
The bridge owns local stdio; the Worker remains the remote Streamable HTTP
server.

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

Transport rules:

1. The URL must end in `/mcp`.
2. Browser navigation to `/mcp` is not a valid smoke test; use MCP Inspector,
   `mcp-remote`, or a remote-capable MCP client.
3. The Worker has no plain `/health` endpoint; probe `/mcp` with MCP Inspector,
   `mcp-remote`, or a remote-capable MCP client.
4. The Worker must not import `src/tools/mcp-manifest.ts`, `src/db/*`, or
   `src/vector/*`; only the pure REST map is edge-safe.

## Tool list source

`workers/mcp/src/tools.ts` loops over `remoteableMcpRestMap`, so a tool becomes
available at the edge only when the map marks it as REST-proxyable. Local-only
entries remain backend/stdio concerns until a later slice defines a safe remote
contract.

Tool-group filtering at the edge is intentionally deferred. Until a later slice
chooses origin-fetched config or deploy-time vars, plug-out enforcement at the
Worker layer is not claimed by this contract.
