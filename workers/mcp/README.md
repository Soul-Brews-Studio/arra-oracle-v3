# Arra Oracle Cloudflare MCP Worker

This Worker exposes the canonical remote MCP endpoint at `/mcp` using
Cloudflare `McpAgent` + Streamable HTTP. It proxies remote-safe Oracle MCP tools
to a running Arra Oracle HTTP backend; it does **not** host the local database or
vector index itself.

## Current contract

- Source of truth for tool exposure: `src/tools/mcp-rest-map.ts`.
- The Worker registers every entry where `remoteable: true`.
- Local-only entries such as `____IMPORTANT`, `oracle_recap`,
  `oracle_mcp_list_tools`, and `oracle_mcp_call` must not be exposed remotely.
- Backend origin resolution order: `ORACLE_ORIGIN_URL`, `ORACLE_URL`,
  `ORACLE_HTTP_URL`, then `ORACLE_API`.
- `workers/mcp/wrangler.jsonc` keeps `ORACLE_URL` as a placeholder fallback;
  production origin/token values belong in Worker secrets and are set by Nat.

Examples of proxied tools:

- `oracle_search` -> `GET /api/search`
- `oracle_stats` -> `GET /api/stats`
- `oracle_learn` -> `POST /api/learn`

## Local deploy-readiness check

Start a real backend first:

```bash
maw arra serve --port 47778
```

Install and typecheck the Worker package:

```bash
cd workers/mcp
bun install --frozen-lockfile
bunx tsc --noEmit
```

Run Wrangler locally against the backend without secrets or deploy:

```bash
bunx wrangler dev --config wrangler.jsonc \
  --ip 127.0.0.1 --port 8788 --local \
  --var ORACLE_URL:http://127.0.0.1:47778 \
  --show-interactive-dev-session=false
```

In another shell, initialize a session:

```bash
curl -i -sS http://127.0.0.1:8788/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}'
```

Copy the `mcp-session-id` response header, then mark initialized and list tools:

```bash
SESSION='<mcp-session-id>'
curl -sS http://127.0.0.1:8788/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -sS http://127.0.0.1:8788/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Call a backend-proxied tool:

```bash
curl -sS http://127.0.0.1:8788/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"oracle_search","arguments":{"query":"calver","limit":1,"retrieval":"compact-summary"}}}'
```

Expected results:

- `initialize` returns `serverInfo.name = "arra-oracle"`.
- `tools/list` includes every `remoteable: true` map entry and no local-only
  entries.
- `tools/call` for `oracle_search` returns backend search JSON in a text MCP
  result.

To audit the exact tool-map parity from repo root:

```bash
bun -e "import {remoteableMcpRestMap,mcpRestMap} from './src/tools/mcp-rest-map.ts'; import {workerMcpToolEntries} from './workers/mcp/src/tools.ts'; const r=remoteableMcpRestMap.map(t=>t.name).sort(); const w=workerMcpToolEntries.map(t=>t.name).sort(); console.log({remoteable:r.length, worker:w.length, missing:r.filter(x=>!w.includes(x)), extra:w.filter(x=>!r.includes(x)), localOnly:mcpRestMap.filter(t=>!t.remoteable).map(t=>t.name).sort()});"
```

## Production deploy handoff

Do **not** deploy from verification PRs and do not touch secrets. Nat owns these
steps after the backend origin is approved:

```bash
cd workers/mcp
bunx wrangler login
bunx wrangler secret put ORACLE_ORIGIN_URL
bunx wrangler secret put ARRA_API_TOKEN   # only if backend requires it
bunx wrangler deploy --config wrangler.jsonc
```

After deploy, the MCP URL is:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

## Connect Claude

Claude Desktop can connect through `mcp-remote`:

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

If your Claude client supports remote MCP URLs directly, use the same `/mcp`
URL. For stdio-only clients, use the bridge contract in
`docs/architecture/mcp-remote-transport.md`.

## Config reference

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `ORACLE_ORIGIN_URL` | secret | Yes for production | HTTPS base URL for the Arra Oracle HTTP backend, usually a cloudflared tunnel. |
| `ORACLE_URL` | `wrangler.jsonc` var/secret | Fallback | Legacy backend URL alias when `ORACLE_ORIGIN_URL` is unset. |
| `ORACLE_HTTP_URL` | env/secret | No | Legacy fallback backend URL after `ORACLE_ORIGIN_URL` / `ORACLE_URL`. |
| `ORACLE_API` | env/secret | No | Legacy fallback backend URL after `ORACLE_HTTP_URL`. |
| `ARRA_API_TOKEN` | secret | No | Bearer token sent to the backend as `Authorization`. |
| `ARRA_API_KEY` | secret | No | Legacy token fallback when `ARRA_API_TOKEN` is unset. |
| `ORACLE_TENANT_ID` | var/secret | No | Default tenant for unauthenticated single-tenant deploys. |
| `MCP_OBJECT` | Durable Object binding | Yes | Session state binding required by `McpAgent`. |

`ORACLE_ORIGIN_URL` should point to the backend HTTP origin, for example
`https://oracle.example.com`, not directly to `/mcp` or `/api/*`. See
`docs/architecture/cloudflared-origin-contract.md` for the #2227 origin contract.

## Tenant claims

For team or school deployments, wrap the Worker with Cloudflare Access or an
OAuth provider so authenticated users receive a tenant claim. The proxy resolves
tenants from these keys, including under `claims`: `tenantId`, `tenant_id`,
`tenant`, `orgId`, `org_id`, `organizationId`, `organization_id`.

When a tenant is resolved, the Worker forwards all backend-compatible headers:

```text
X-Tenant-ID: <tenant>
X-Oracle-Tenant: <tenant>
X-Oracle-Tenant-ID: <tenant>
```

Use `ORACLE_TENANT_ID` only for single-tenant or smoke-test deploys. In shared
production deploys, prefer auth claims so users cannot select another tenant by
changing tool arguments.

## Troubleshooting

- **No tools in Claude:** verify the URL ends with `/mcp`, restart Claude, then
  try MCP Inspector to separate client config from Worker issues.
- **Backend calls fail:** check the origin URL, token secrets, and that the
  backend exposes `/api/search`, `/api/stats`, and `/api/learn`.
- **Tenant isolation looks wrong:** verify the auth token includes a supported
  tenant claim, or set `ORACLE_TENANT_ID` for a single-tenant smoke test.
- **Direct browser visit fails:** `/mcp` expects MCP protocol messages; use
  Claude, `mcp-remote`, MCP Inspector, or the curl smoke flow above.
